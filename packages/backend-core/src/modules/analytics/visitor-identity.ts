import { schema, type Tx, type Db } from '@getmunin/db';
import { sql } from 'drizzle-orm';

const BACKFILL_WINDOW = sql`NOW() - INTERVAL '30 days'`;

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

  await tx.execute(sql`
    UPDATE analytics_view_events
       SET end_user_id = ${endUserId}
     WHERE org_id = ${orgId}
       AND visitor_id = ${trimmed}
       AND end_user_id IS NULL
       AND created_at > ${BACKFILL_WINDOW}
  `);
  await tx.execute(sql`
    UPDATE analytics_search_events
       SET end_user_id = ${endUserId}
     WHERE org_id = ${orgId}
       AND visitor_id = ${trimmed}
       AND end_user_id IS NULL
       AND created_at > ${BACKFILL_WINDOW}
  `);
}
