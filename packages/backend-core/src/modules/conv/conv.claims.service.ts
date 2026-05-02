import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { schema } from '@getmunin/db';
import { and, eq, gt, sql } from 'drizzle-orm';
import { getCurrentContext, WebhookDispatcher } from '@getmunin/core';

const ENTITY_TYPE = 'conversation';
const DEFAULT_TTL_MS = 30 * 60 * 1000;

export class ClaimedByOtherError extends Error {
  readonly code = 'claim_held_by_other';
  constructor(public readonly holderId: string) {
    super(`claim_held_by_other: conversation already claimed by ${holderId}`);
  }
}

export type ClaimHolderType = 'user' | 'agent';

export interface ConversationClaim {
  conversationId: string;
  holderType: ClaimHolderType;
  holderId: string;
  expiresAt: string;
  createdAt: string;
}

@Injectable()
export class ConversationClaimsService {
  constructor(@Inject(WebhookDispatcher) private readonly webhooks: WebhookDispatcher) {}

  async claim(input: {
    conversationId: string;
    ttlMs?: number;
  }): Promise<ConversationClaim> {
    const ctx = getCurrentContext();
    const actor = ctx.actor!;
    const claimer = resolveClaimer(actor);
    if (!claimer) {
      throw new Error('claim_requires_user_or_agent_actor');
    }

    const convRows = await ctx.db
      .select({ id: schema.convConversations.id })
      .from(schema.convConversations)
      .where(eq(schema.convConversations.id, input.conversationId))
      .limit(1);
    if (!convRows[0]) {
      throw new NotFoundException(`conv_not_found: conversation ${input.conversationId}`);
    }

    const ttlMs = input.ttlMs ?? DEFAULT_TTL_MS;
    const expiresAt = new Date(Date.now() + ttlMs);

    const existing = await this.findActiveClaim(input.conversationId);
    if (existing && holderIdOf(existing) !== claimer.id) {
      throw new ClaimedByOtherError(holderIdOf(existing));
    }

    if (existing) {
      const [refreshed] = await ctx.db
        .update(schema.claims)
        .set({ expiresAt })
        .where(eq(schema.claims.id, existing.id))
        .returning();
      return toConversationClaim(refreshed!);
    }

    const [row] = await ctx.db
      .insert(schema.claims)
      .values({
        orgId: actor.orgId,
        entityType: ENTITY_TYPE,
        entityId: input.conversationId,
        userId: claimer.type === 'user' ? claimer.id : null,
        agentId: claimer.type === 'agent' ? claimer.id : null,
        expiresAt,
      })
      .returning();

    await this.webhooks.emit({
      type: 'conversation.taken_over',
      payload: {
        conversationId: input.conversationId,
        holderType: claimer.type,
        holderId: claimer.id,
        expiresAt: expiresAt.toISOString(),
      },
    });

    return toConversationClaim(row!);
  }

  async release(input: { conversationId: string; force?: boolean }): Promise<void> {
    const ctx = getCurrentContext();
    const actor = ctx.actor!;
    const existing = await this.findActiveClaim(input.conversationId);
    if (!existing) return;
    const heldBy = holderIdOf(existing);
    const claimer = resolveClaimer(actor);
    if (!input.force && (!claimer || heldBy !== claimer.id)) {
      throw new ClaimedByOtherError(heldBy);
    }
    await ctx.db.delete(schema.claims).where(eq(schema.claims.id, existing.id));
    await this.webhooks.emit({
      type: 'conversation.released',
      payload: {
        conversationId: input.conversationId,
        holderType: existing.userId ? 'user' : 'agent',
        holderId: heldBy,
      },
    });
  }

  async isClaimed(conversationId: string): Promise<boolean> {
    const claim = await this.findActiveClaim(conversationId);
    return claim !== null;
  }

  async getActiveClaim(conversationId: string): Promise<ConversationClaim | null> {
    const claim = await this.findActiveClaim(conversationId);
    return claim ? toConversationClaim(claim) : null;
  }

  private async findActiveClaim(
    conversationId: string,
  ): Promise<typeof schema.claims.$inferSelect | null> {
    const ctx = getCurrentContext();
    const rows = await ctx.db
      .select()
      .from(schema.claims)
      .where(
        and(
          eq(schema.claims.entityType, ENTITY_TYPE),
          eq(schema.claims.entityId, conversationId),
          gt(schema.claims.expiresAt, sql`now()`),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }
}

function holderIdOf(row: typeof schema.claims.$inferSelect): string {
  return (row.userId ?? row.agentId)!;
}

interface ResolvedClaimer {
  type: 'user' | 'agent';
  id: string;
}

/**
 * Map an actor to a (user_id | agent_id) tuple suitable for the claims
 * table. Prefers user_id when the actor has an associated human (cookie
 * sessions, oauth tokens minted on behalf of a user, api keys with
 * createdByUserId). Falls back to agent_id only for OAuth-issued agent
 * tokens whose `actor.id` is itself the agent row's id. Plain api keys
 * with no associated user (CI / automation that never recorded an
 * owner) cannot claim and the caller should report a clear error.
 */
function resolveClaimer(actor: NonNullable<ReturnType<typeof getCurrentContext>['actor']>): ResolvedClaimer | null {
  if (actor.type === 'user') return { type: 'user', id: actor.id };
  if (actor.userId) return { type: 'user', id: actor.userId };
  if (actor.type === 'admin_agent' && actor.id.startsWith('agt_')) {
    return { type: 'agent', id: actor.id };
  }
  return null;
}

function toConversationClaim(row: typeof schema.claims.$inferSelect): ConversationClaim {
  return {
    conversationId: row.entityId,
    holderType: row.userId ? 'user' : 'agent',
    holderId: holderIdOf(row),
    expiresAt: row.expiresAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}
