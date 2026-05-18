import { schema } from '@getmunin/db';
import { and, eq, gt, isNotNull, lt, sql } from 'drizzle-orm';
import { getCurrentContext } from './context.js';

export interface ClaimResult {
  acquired: boolean;
  /** When acquired === false: who currently holds the claim and until when. */
  holder?: { agentId: string; expiresAt: Date };
  /** When acquired === true: the claim row id and expiry. */
  claim?: { id: string; expiresAt: Date };
}

/**
 * Soft locks: "agent X is working on entity Y for the next N minutes."
 *
 * Lease-based, auto-expiring. Other agents see the holder and back off;
 * nobody waits, nobody deadlocks.
 */
export class ClaimManager {
  /**
   * Try to acquire a claim. Returns acquired:false if a non-expired claim
   * exists held by a different agent.
   */
  async acquire(
    entityType: string,
    entityId: string,
    agentId: string,
    ttlSeconds: number,
  ): Promise<ClaimResult> {
    const ctx = getCurrentContext();
    if (!ctx.actor) throw new Error('claims.acquire requires an authenticated actor');
    const orgId = ctx.actor.orgId;
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000);

    // First, sweep expired claims for this entity to keep the table tidy.
    await ctx.db
      .delete(schema.claims)
      .where(
        and(
          eq(schema.claims.orgId, orgId),
          eq(schema.claims.entityType, entityType),
          eq(schema.claims.entityId, entityId),
          lt(schema.claims.expiresAt, new Date()),
        ),
      );

    // Existing live claim? Only agent-held rows participate here; rows
    // held by a user (the human take-over flow) live in the same table
    // but have a different lifecycle and shouldn't block agent claims.
    const existing = await ctx.db
      .select()
      .from(schema.claims)
      .where(
        and(
          eq(schema.claims.orgId, orgId),
          eq(schema.claims.entityType, entityType),
          eq(schema.claims.entityId, entityId),
          gt(schema.claims.expiresAt, new Date()),
          isNotNull(schema.claims.agentId),
        ),
      )
      .limit(1);

    const live = existing[0];
    if (live && live.agentId !== agentId) {
      return {
        acquired: false,
        holder: { agentId: live.agentId!, expiresAt: live.expiresAt },
      };
    }

    // Same agent re-acquiring? Extend instead of insert.
    if (live && live.agentId === agentId) {
      await ctx.db
        .update(schema.claims)
        .set({ expiresAt })
        .where(eq(schema.claims.id, live.id));
      return { acquired: true, claim: { id: live.id, expiresAt } };
    }

    // Insert new claim.
    const [row] = await ctx.db
      .insert(schema.claims)
      .values({ orgId, entityType, entityId, agentId, expiresAt })
      .returning({ id: schema.claims.id, expiresAt: schema.claims.expiresAt });

    return { acquired: true, claim: { id: row!.id, expiresAt: row!.expiresAt } };
  }

  /** Release a claim by id (only if you hold it). No-op if not yours / already gone. */
  async release(claimId: string, agentId: string): Promise<void> {
    const ctx = getCurrentContext();
    await ctx.db
      .delete(schema.claims)
      .where(and(eq(schema.claims.id, claimId), eq(schema.claims.agentId, agentId)));
  }

  /** Extend an active claim. Returns null if not held by this agent. */
  async extend(claimId: string, agentId: string, ttlSeconds: number): Promise<Date | null> {
    const ctx = getCurrentContext();
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
    const result = await ctx.db
      .update(schema.claims)
      .set({ expiresAt })
      .where(and(eq(schema.claims.id, claimId), eq(schema.claims.agentId, agentId)))
      .returning({ expiresAt: schema.claims.expiresAt });
    return result[0]?.expiresAt ?? null;
  }

  /** Background sweeper — call periodically (e.g. every minute) to drop expired rows globally. */
  async sweepExpired(): Promise<number> {
    const ctx = getCurrentContext();
    const result = await ctx.db.execute(
      sql`DELETE FROM ${schema.claims} WHERE expires_at < NOW()`,
    );
    return result.length ?? 0;
  }
}
