import { schema, type Db, type Tx } from '@getmunin/db';
import { and, eq, sql } from 'drizzle-orm';
import {
  SMTP_UNVERIFIED_EMAIL_SOURCE,
  SMTP_VERIFIED_EMAIL_SOURCE,
} from '../connectors/identity-provenance.ts';
import type { EmailAuthVerdict } from './email/authentication-results.ts';

export function provisionalEmailExternalId(email: string): string {
  return `email:${email}`;
}

export function emailSourceForVerdict(verdict: EmailAuthVerdict): string {
  return verdict === 'pass' ? SMTP_VERIFIED_EMAIL_SOURCE : SMTP_UNVERIFIED_EMAIL_SOURCE;
}

export async function findOrCreateEndUserByEmail(
  tx: Db | Tx,
  orgId: string,
  email: string,
  name: string | null,
  source: string,
  emailAuth?: EmailAuthVerdict,
): Promise<string> {
  const normalized = email.trim().toLowerCase();
  const emailSource = emailAuth ? emailSourceForVerdict(emailAuth) : null;

  const stamp = async (endUserId: string): Promise<string> => {
    if (!emailSource) return endUserId;
    await tx
      .update(schema.endUsers)
      .set({
        metadata: sql`COALESCE(${schema.endUsers.metadata}, '{}'::jsonb) || ${JSON.stringify({ emailSource })}::jsonb`,
        updatedAt: new Date(),
      })
      .where(eq(schema.endUsers.id, endUserId));
    return endUserId;
  };

  const byEmail = await tx
    .select({ id: schema.endUsers.id })
    .from(schema.endUsers)
    .where(
      and(eq(schema.endUsers.orgId, orgId), sql`lower(${schema.endUsers.email}) = ${normalized}`),
    )
    .limit(1);
  if (byEmail[0]) return stamp(byEmail[0].id);

  const externalId = provisionalEmailExternalId(normalized);
  const byExternalId = await tx
    .select({ id: schema.endUsers.id })
    .from(schema.endUsers)
    .where(and(eq(schema.endUsers.orgId, orgId), eq(schema.endUsers.externalId, externalId)))
    .limit(1);
  if (byExternalId[0]) return stamp(byExternalId[0].id);

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
  return stamp(created!.id);
}
