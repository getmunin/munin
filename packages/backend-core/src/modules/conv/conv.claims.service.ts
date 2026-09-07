import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { schema } from '@getmunin/db';
import { and, eq, gt, inArray, sql } from 'drizzle-orm';
import { getCurrentContext, WebhookDispatcher } from '@getmunin/core';

const ENTITY_TYPE = 'conversation';
const DEFAULT_TTL_MS = 30 * 60 * 1000;

export class ClaimedByOtherError extends Error {
  readonly code = 'claim_held_by_other';
  constructor(public readonly holderId: string) {
    super(`claim_held_by_other: conversation already claimed by ${holderId}`);
  }
}

export type ClaimHolderType = 'user';

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
    force?: boolean;
  }): Promise<ConversationClaim> {
    const ctx = getCurrentContext();
    const actor = ctx.actor!;
    const claimer = resolveClaimer(actor);
    if (!claimer) {
      throw new Error('claim_requires_user_actor');
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
    const displacing = existing && holderIdOf(existing) !== claimer.id;
    if (displacing && !input.force) {
      throw new ClaimedByOtherError(holderIdOf(existing));
    }

    if (existing) {
      const previousHolderId = holderIdOf(existing);
      const [refreshed] = await ctx.db
        .update(schema.claims)
        .set({ expiresAt, userId: claimer.id })
        .where(eq(schema.claims.id, existing.id))
        .returning();
      if (displacing) {
        await this.noteTakeOver({
          conversationId: input.conversationId,
          orgId: actor.orgId,
          fromUserId: previousHolderId,
          toUserId: claimer.id,
        });
        await this.emitClaimed(input.conversationId, claimer.id, expiresAt);
      }
      return toConversationClaim(refreshed!);
    }

    const [row] = await ctx.db
      .insert(schema.claims)
      .values({
        orgId: actor.orgId,
        entityType: ENTITY_TYPE,
        entityId: input.conversationId,
        userId: claimer.id,
        expiresAt,
      })
      .returning();

    await this.emitClaimed(input.conversationId, claimer.id, expiresAt);

    return toConversationClaim(row!);
  }

  private async emitClaimed(
    conversationId: string,
    holderId: string,
    expiresAt: Date,
  ): Promise<void> {
    await this.webhooks.emit({
      type: 'conversation.taken_over',
      payload: {
        conversationId,
        holderType: 'user',
        holderId,
        expiresAt: expiresAt.toISOString(),
      },
    });
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
        holderType: 'user',
        holderId: heldBy,
      },
    });
  }

  async isClaimed(conversationId: string): Promise<boolean> {
    const claim = await this.findActiveClaim(conversationId);
    return claim !== null;
  }

  async isHeldByOther(conversationId: string): Promise<boolean> {
    const ctx = getCurrentContext();
    const actor = ctx.actor!;
    const claim = await this.findActiveClaim(conversationId);
    if (!claim) return false;
    const claimer = resolveClaimer(actor);
    if (!claimer) return true;
    return holderIdOf(claim) !== claimer.id;
  }

  async getActiveClaim(conversationId: string): Promise<ConversationClaim | null> {
    const claim = await this.findActiveClaim(conversationId);
    return claim ? toConversationClaim(claim) : null;
  }

  private async noteTakeOver(input: {
    conversationId: string;
    orgId: string;
    fromUserId: string;
    toUserId: string;
  }): Promise<void> {
    const ctx = getCurrentContext();
    const rows = await ctx.db
      .select({ id: schema.users.id, name: schema.users.name, email: schema.users.email })
      .from(schema.users)
      .where(inArray(schema.users.id, [input.fromUserId, input.toUserId]));
    const labelOf = (userId: string): string => {
      const row = rows.find((r) => r.id === userId);
      return row?.name ?? row?.email ?? 'A teammate';
    };
    await ctx.db.insert(schema.convMessages).values({
      orgId: input.orgId,
      conversationId: input.conversationId,
      authorType: 'system',
      authorId: 'conversation-claims',
      body: `${labelOf(input.toUserId)} took over this conversation from ${labelOf(input.fromUserId)}.`,
      internal: true,
      metadata: {
        kind: 'claim_taken_over',
        fromUserId: input.fromUserId,
        toUserId: input.toUserId,
      },
    });
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
  return row.userId!;
}

interface ResolvedClaimer {
  id: string;
}

function resolveClaimer(actor: NonNullable<ReturnType<typeof getCurrentContext>['actor']>): ResolvedClaimer | null {
  if (actor.type === 'user') return { id: actor.id };
  if (actor.userId) return { id: actor.userId };
  return null;
}

function toConversationClaim(row: typeof schema.claims.$inferSelect): ConversationClaim {
  return {
    conversationId: row.entityId,
    holderType: 'user',
    holderId: holderIdOf(row),
    expiresAt: row.expiresAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}
