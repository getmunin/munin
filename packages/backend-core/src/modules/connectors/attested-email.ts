import { schema, type Db, type Tx } from '@getmunin/db';
import { and, eq, ne, sql } from 'drizzle-orm';
import { isSelfReportedIdentity } from './identity-provenance.ts';

export async function freeEmailForAttestation(
  db: Db | Tx,
  orgId: string,
  email: string,
  endUserId: string | null,
): Promise<boolean> {
  const [holder] = await db
    .select({ id: schema.endUsers.id, metadata: schema.endUsers.metadata })
    .from(schema.endUsers)
    .where(
      and(
        eq(schema.endUsers.orgId, orgId),
        sql`lower(${schema.endUsers.email}) = ${email}`,
        ...(endUserId ? [ne(schema.endUsers.id, endUserId)] : []),
      ),
    )
    .limit(1);
  if (!holder) return true;
  if (!isSelfReportedIdentity({ email, metadata: holder.metadata })) return false;
  await db
    .update(schema.endUsers)
    .set({
      email: null,
      metadata: sql`COALESCE(${schema.endUsers.metadata}, '{}'::jsonb) - 'emailSource'`,
      updatedAt: new Date(),
    })
    .where(eq(schema.endUsers.id, holder.id));
  return true;
}
