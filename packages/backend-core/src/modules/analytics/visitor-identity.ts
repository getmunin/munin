import { schema, type Tx, type Db } from '@getmunin/db';
import { sql } from 'drizzle-orm';

export async function linkVisitorToEndUser(
  tx: Tx | Db,
  orgId: string,
  visitorId: string,
  endUserId: string,
): Promise<void> {
  const trimmed = visitorId.trim().slice(0, 64);
  if (!trimmed) return;
  await tx
    .insert(schema.analyticsVisitorIdentities)
    .values({ orgId, visitorId: trimmed, endUserId })
    .onConflictDoUpdate({
      target: [
        schema.analyticsVisitorIdentities.orgId,
        schema.analyticsVisitorIdentities.visitorId,
      ],
      set: { endUserId, updatedAt: sql`now()` },
    });
}
