import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { schema } from '@getmunin/db';
import { and, eq, gt, sql } from 'drizzle-orm';
import { getCurrentContext, WebhookDispatcher } from '@getmunin/core';

const ENTITY_TYPE = 'conversation';
const DEFAULT_TTL_MS = 30 * 60 * 1000;

export class ClaimedByOtherError extends Error {
  readonly code = 'claim_held_by_other';
  constructor(public readonly userId: string) {
    super(`claim_held_by_other: conversation already claimed by ${userId}`);
  }
}

export interface ConversationClaim {
  conversationId: string;
  userId: string;
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
    if (actor.type !== 'user') {
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
    if (existing && existing.userId !== actor.id) {
      throw new ClaimedByOtherError(existing.userId!);
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
        userId: actor.id,
        expiresAt,
      })
      .returning();

    await this.webhooks.emit({
      type: 'conversation.taken_over',
      payload: {
        conversationId: input.conversationId,
        userId: actor.id,
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
    if (!input.force && existing.userId !== actor.id) {
      throw new ClaimedByOtherError(existing.userId!);
    }
    await ctx.db.delete(schema.claims).where(eq(schema.claims.id, existing.id));
    await this.webhooks.emit({
      type: 'conversation.released',
      payload: {
        conversationId: input.conversationId,
        userId: existing.userId,
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

function toConversationClaim(row: typeof schema.claims.$inferSelect): ConversationClaim {
  return {
    conversationId: row.entityId,
    userId: row.userId!,
    expiresAt: row.expiresAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}
