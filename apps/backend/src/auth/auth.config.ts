import { APIError } from 'better-auth/api';
import {
  createMuninAuthCore,
  type MuninAuthInstance,
  type SignupBeforeUser,
  type SignupHookUser,
} from '@getmunin/backend-core';
import { schema, type Db } from '@getmunin/db';
import type { Mailer } from '@getmunin/core';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { resetPasswordEmail, verifyEmailEmail } from './email-templates.js';

export type MuninAuth = MuninAuthInstance;

export interface MuninAuthOptions {
  db: Db;
  baseUrl: string;
  authSecret: string;
  trustedOrigins?: string[];
  mailer?: Mailer;
  webBaseUrl?: string;
  allowedEmailDomains?: string[];
}

export function createMuninAuth({
  db,
  baseUrl,
  authSecret,
  trustedOrigins,
  mailer,
  webBaseUrl,
  allowedEmailDomains = [],
}: MuninAuthOptions): MuninAuthInstance {
  return createMuninAuthCore({
    db,
    baseUrl,
    authSecret,
    trustedOrigins,
    webBaseUrl,
    sendResetPassword: mailer
      ? async ({ user, url }) => {
          const tpl = resetPasswordEmail(url);
          await mailer.send({ to: user.email, subject: tpl.subject, text: tpl.text });
        }
      : undefined,
    sendVerificationEmail: mailer
      ? async ({ user, url }) => {
          const tpl = verifyEmailEmail(url);
          await mailer.send({ to: user.email, subject: tpl.subject, text: tpl.text });
        }
      : undefined,
    signupBefore: (user: SignupBeforeUser) =>
      assertSignupAllowed(db, user.email, allowedEmailDomains),
    signupAfter: (user: SignupHookUser) => ensureSingletonOrgMembershipFor(db, user),
  });
}

async function assertSignupAllowed(
  db: Db,
  rawEmail: string,
  allowedEmailDomains: string[],
): Promise<void> {
  const email = rawEmail.trim().toLowerCase();

  const userCount = await db.select({ c: sql<number>`count(*)::int` }).from(schema.users);
  if ((userCount[0]?.c ?? 0) === 0) return;

  const domain = email.split('@')[1] ?? '';
  if (domain && allowedEmailDomains.includes(domain)) return;

  const invite = await db
    .select({ id: schema.orgInvitations.id })
    .from(schema.orgInvitations)
    .where(
      and(
        eq(schema.orgInvitations.email, email),
        isNull(schema.orgInvitations.acceptedAt),
        isNull(schema.orgInvitations.revokedAt),
        sql`${schema.orgInvitations.expiresAt} > now()`,
      ),
    )
    .limit(1);
  if (invite[0]) return;

  if (allowedEmailDomains.length > 0) {
    throw new APIError('FORBIDDEN', {
      code: 'SIGNUP_DOMAIN_NOT_ALLOWED',
      message: `Signup is restricted. Your email domain (${domain || 'unknown'}) isn't on the allowlist, and there's no pending invitation for ${email}. Ask an admin to invite you.`,
      details: { email, domain },
    });
  }
  throw new APIError('FORBIDDEN', {
    code: 'SIGNUP_INVITE_ONLY',
    message: `Signup is invite-only on this Munin instance. Ask an admin to send you an invitation for ${email}.`,
    details: { email },
  });
}

async function ensureSingletonOrgMembershipFor(
  db: Db,
  user: { id: string; email: string; name?: string | null },
): Promise<void> {
  const existing = await db
    .select({ orgId: schema.orgMembers.orgId })
    .from(schema.orgMembers)
    .where(eq(schema.orgMembers.userId, user.id))
    .limit(1);
  if (existing[0]) return;

  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.bypass_rls', 'on', true)`);

    let orgRow = (
      await tx
        .select({ id: schema.orgs.id })
        .from(schema.orgs)
        .orderBy(asc(schema.orgs.createdAt))
        .limit(1)
    )[0];
    if (!orgRow) {
      [orgRow] = await tx
        .insert(schema.orgs)
        .values({ name: '' })
        .returning({ id: schema.orgs.id });
      await tx
        .insert(schema.assistants)
        .values({ orgId: orgRow!.id })
        .onConflictDoNothing({ target: schema.assistants.orgId });
    }
    const memberCount = await tx
      .select({ c: sql<number>`count(*)::int` })
      .from(schema.orgMembers)
      .where(eq(schema.orgMembers.orgId, orgRow!.id));
    const role = (memberCount[0]?.c ?? 0) === 0 ? 'owner' : 'member';
    await tx
      .insert(schema.orgMembers)
      .values({ orgId: orgRow!.id, userId: user.id, role, isDefault: true });
  });
}

export function readAllowedEmailDomainsFromEnv(): string[] {
  const env = process.env.MUNIN_ALLOWED_EMAIL_DOMAINS;
  if (!env) return [];
  return env
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}
