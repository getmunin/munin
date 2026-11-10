import { schema, type Db, type Tx } from '@getmunin/db';
import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';
import { isSelfReportedIdentity } from '../connectors/identity-provenance.ts';
import { normalizeIdentityEmail } from '../analytics/visitor-identity.ts';

const MERGED_AWAY_LAST = sql`(${schema.crmContacts.customFields} ? 'mergedInto') asc`;
const CONTACT_EMAIL_KEY = sql`lower(trim(${schema.crmContacts.email}))`;

export async function linkEndUserContact(
  db: Db | Tx,
  orgId: string,
  endUserId: string,
  attestedEmail?: string | null,
): Promise<string | null> {
  const c = schema.crmContacts;
  const [linked] = await db
    .select({ id: c.id })
    .from(c)
    .where(and(eq(c.orgId, orgId), eq(c.endUserId, endUserId)))
    .orderBy(MERGED_AWAY_LAST, asc(c.createdAt))
    .limit(1);
  if (linked) return linked.id;

  const email = normalizeIdentityEmail(attestedEmail) ?? (await trustedEndUserEmail(db, orgId, endUserId));
  if (!email) return null;
  const [byEmail] = await db
    .select({ id: c.id })
    .from(c)
    .where(and(eq(c.orgId, orgId), isNull(c.endUserId), sql`${CONTACT_EMAIL_KEY} = ${email}`))
    .orderBy(MERGED_AWAY_LAST, desc(c.updatedAt))
    .limit(1);
  if (!byEmail) return null;
  const [claimed] = await db
    .update(c)
    .set({ endUserId, updatedAt: new Date() })
    .where(and(eq(c.id, byEmail.id), isNull(c.endUserId)))
    .returning({ id: c.id });
  return claimed?.id ?? null;
}

export async function contactEmailHeld(db: Db | Tx, orgId: string, email: string): Promise<boolean> {
  const c = schema.crmContacts;
  const [row] = await db
    .select({ id: c.id })
    .from(c)
    .where(and(eq(c.orgId, orgId), sql`${CONTACT_EMAIL_KEY} = ${email}`))
    .limit(1);
  return Boolean(row);
}

export async function trustedEndUserEmail(
  db: Db | Tx,
  orgId: string,
  endUserId: string,
): Promise<string | null> {
  const [row] = await db
    .select({ email: schema.endUsers.email, metadata: schema.endUsers.metadata })
    .from(schema.endUsers)
    .where(and(eq(schema.endUsers.orgId, orgId), eq(schema.endUsers.id, endUserId)))
    .limit(1);
  if (!row || isSelfReportedIdentity(row)) return null;
  return normalizeIdentityEmail(row.email);
}
