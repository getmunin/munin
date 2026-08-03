import { and, eq } from 'drizzle-orm';
import { schema, type Db, type Tx } from '@getmunin/db';

export async function findOrCreateContactByHandle(
  tx: Db | Tx,
  orgId: string,
  handle: string | undefined,
  vendor: string,
  name: string | undefined,
  source: string,
): Promise<typeof schema.convContacts.$inferSelect | null> {
  if (!handle) return null;
  const existing = await tx
    .select()
    .from(schema.convContacts)
    .where(and(eq(schema.convContacts.orgId, orgId), eq(schema.convContacts.handle, handle)))
    .limit(1);
  if (existing[0]) return existing[0];

  const externalId = `${vendor}:${handle}`;
  const eu = await tx
    .select()
    .from(schema.endUsers)
    .where(and(eq(schema.endUsers.orgId, orgId), eq(schema.endUsers.externalId, externalId)))
    .limit(1);
  let endUserId: string | null = eu[0]?.id ?? null;
  if (!endUserId) {
    try {
      const [createdEu] = await tx
        .insert(schema.endUsers)
        .values({
          orgId,
          externalId,
          name: name ?? null,
          metadata: { source },
        })
        .returning();
      endUserId = createdEu?.id ?? null;
    } catch {
      const reread = await tx
        .select()
        .from(schema.endUsers)
        .where(and(eq(schema.endUsers.orgId, orgId), eq(schema.endUsers.externalId, externalId)))
        .limit(1);
      endUserId = reread[0]?.id ?? null;
    }
  }
  const [contact] = await tx
    .insert(schema.convContacts)
    .values({
      orgId,
      handle,
      name: name ?? null,
      endUserId,
      metadata: {},
    })
    .returning();
  return contact ?? null;
}
