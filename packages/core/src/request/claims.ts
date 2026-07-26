import { schema } from '@getmunin/db';
import { and, eq, gt, isNotNull, lt, sql } from 'drizzle-orm';
import { getCurrentContext } from './context.ts';

export interface ClaimResult {
  acquired: boolean;
  holder?: { agentId: string; expiresAt: Date };
  claim?: { id: string; expiresAt: Date };
}

export class ClaimManager {
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

    if (live && live.agentId === agentId) {
      await ctx.db
        .update(schema.claims)
        .set({ expiresAt })
        .where(eq(schema.claims.id, live.id));
      return { acquired: true, claim: { id: live.id, expiresAt } };
    }

    const [row] = await ctx.db
      .insert(schema.claims)
      .values({ orgId, entityType, entityId, agentId, expiresAt })
      .returning({ id: schema.claims.id, expiresAt: schema.claims.expiresAt });

    return { acquired: true, claim: { id: row!.id, expiresAt: row!.expiresAt } };
  }

  async release(claimId: string, agentId: string): Promise<void> {
    const ctx = getCurrentContext();
    await ctx.db
      .delete(schema.claims)
      .where(and(eq(schema.claims.id, claimId), eq(schema.claims.agentId, agentId)));
  }

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

  async sweepExpired(): Promise<number> {
    const ctx = getCurrentContext();
    const result = await ctx.db.execute(
      sql`DELETE FROM ${schema.claims} WHERE expires_at < NOW()`,
    );
    return result.length ?? 0;
  }
}
