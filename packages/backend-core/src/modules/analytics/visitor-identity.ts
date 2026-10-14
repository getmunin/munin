import { schema, type Tx, type Db } from '@getmunin/db';
import { and, eq, sql } from 'drizzle-orm';
import { freeEmailForAttestation } from '../connectors/attested-email.ts';
import {
  ORG_ATTESTED_EMAIL_SOURCE,
  isSelfReportedIdentity,
} from '../connectors/identity-provenance.ts';

const BACKFILL_WINDOW = sql`NOW() - INTERVAL '30 days'`;

export type IdentityOutcome =
  | 'matched-external-id'
  | 'adopted-provisional-email-identity'
  | 'created'
  | 'email-held-by-another-identity';

export type IdentityResolution = {
  endUserId: string;
  outcome: IdentityOutcome;
};

export function normalizeIdentityEmail(email: string | null | undefined): string | null {
  const trimmed = email?.trim().toLowerCase();
  return trimmed ? trimmed : null;
}

const SYNTHETIC_ID_PREFIXES = ['email:', 'phone:', 'anon:'];

function isProvisionalIdentity(externalId: string | null): boolean {
  return externalId === null || SYNTHETIC_ID_PREFIXES.some((p) => externalId.startsWith(p));
}

async function findByExternalId(tx: Tx | Db, orgId: string, externalId: string) {
  const rows = await tx
    .select({ id: schema.endUsers.id, email: schema.endUsers.email })
    .from(schema.endUsers)
    .where(and(eq(schema.endUsers.orgId, orgId), eq(schema.endUsers.externalId, externalId)))
    .limit(1);
  return rows[0] ?? null;
}

async function findByEmail(tx: Tx | Db, orgId: string, email: string) {
  const rows = await tx
    .select({
      id: schema.endUsers.id,
      externalId: schema.endUsers.externalId,
      metadata: schema.endUsers.metadata,
    })
    .from(schema.endUsers)
    .where(
      and(eq(schema.endUsers.orgId, orgId), sql`lower(${schema.endUsers.email}) = ${email}`),
    )
    .limit(1);
  return rows[0] ?? null;
}

function attestedEmailMetadata() {
  return sql`COALESCE(${schema.endUsers.metadata}, '{}'::jsonb) || ${JSON.stringify({ emailSource: ORG_ATTESTED_EMAIL_SOURCE })}::jsonb`;
}

export async function resolveIdentifiedEndUser(
  tx: Tx,
  orgId: string,
  externalId: string,
  email: string | null,
): Promise<IdentityResolution> {
  const byExternalId = await findByExternalId(tx, orgId, externalId);
  if (byExternalId) {
    if (!email || byExternalId.email) {
      return { endUserId: byExternalId.id, outcome: 'matched-external-id' };
    }
    if (!(await freeEmailForAttestation(tx, orgId, email, byExternalId.id))) {
      return { endUserId: byExternalId.id, outcome: 'email-held-by-another-identity' };
    }
    await tx
      .update(schema.endUsers)
      .set({ email, metadata: attestedEmailMetadata(), updatedAt: new Date() })
      .where(eq(schema.endUsers.id, byExternalId.id));
    return { endUserId: byExternalId.id, outcome: 'matched-external-id' };
  }

  if (email) {
    const byEmail = await findByEmail(tx, orgId, email);
    if (byEmail && !isSelfReportedIdentity({ email, metadata: byEmail.metadata })) {
      if (!isProvisionalIdentity(byEmail.externalId)) {
        const created = await insertEndUser(tx, orgId, externalId, null);
        return { endUserId: created, outcome: 'email-held-by-another-identity' };
      }
      await tx
        .update(schema.endUsers)
        .set({ externalId, metadata: attestedEmailMetadata(), updatedAt: new Date() })
        .where(eq(schema.endUsers.id, byEmail.id));
      return { endUserId: byEmail.id, outcome: 'adopted-provisional-email-identity' };
    }
    if (byEmail) await freeEmailForAttestation(tx, orgId, email, null);
  }

  const created = await insertEndUser(tx, orgId, externalId, email);
  return { endUserId: created, outcome: 'created' };
}

async function insertEndUser(
  tx: Tx,
  orgId: string,
  externalId: string,
  email: string | null,
): Promise<string> {
  const [row] = await tx
    .insert(schema.endUsers)
    .values({
      orgId,
      externalId,
      email,
      metadata: email ? { emailSource: ORG_ATTESTED_EMAIL_SOURCE } : {},
    })
    .onConflictDoUpdate({
      target: [schema.endUsers.orgId, schema.endUsers.externalId],
      set: { updatedAt: new Date() },
    })
    .returning({ id: schema.endUsers.id });
  return row!.id;
}

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
