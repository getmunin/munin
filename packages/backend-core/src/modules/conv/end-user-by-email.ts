import { schema, type Db, type Tx } from '@getmunin/db';
import { and, eq, sql } from 'drizzle-orm';

export function provisionalEmailExternalId(email: string): string {
  return `email:${email}`;
}

export async function findOrCreateEndUserByEmail(
  tx: Db | Tx,
  orgId: string,
  email: string,
  name: string | null,
  source: string,
): Promise<string> {
  const normalized = email.trim().toLowerCase();

  const byEmail = await tx
    .select({ id: schema.endUsers.id })
    .from(schema.endUsers)
    .where(
      and(eq(schema.endUsers.orgId, orgId), sql`lower(${schema.endUsers.email}) = ${normalized}`),
    )
    .limit(1);
  if (byEmail[0]) return byEmail[0].id;

  const externalId = provisionalEmailExternalId(normalized);
  const byExternalId = await tx
    .select({ id: schema.endUsers.id })
    .from(schema.endUsers)
    .where(and(eq(schema.endUsers.orgId, orgId), eq(schema.endUsers.externalId, externalId)))
    .limit(1);
  if (byExternalId[0]) return byExternalId[0].id;

  const [created] = await tx
    .insert(schema.endUsers)
    .values({
      orgId,
      externalId,
      email: normalized,
      name,
      metadata: { source },
    })
    .onConflictDoUpdate({
      target: [schema.endUsers.orgId, schema.endUsers.externalId],
      set: { updatedAt: new Date() },
    })
    .returning({ id: schema.endUsers.id });
  return created!.id;
}
