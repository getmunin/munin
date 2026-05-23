import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { jwt } from 'better-auth/plugins';
import { oauthProvider } from '@better-auth/oauth-provider';
import { APIError } from 'better-auth/api';
import { SUPPORTED_SCOPES as BACKEND_SUPPORTED_SCOPES } from '@getmunin/backend-core';

type BetterAuthInstance = ReturnType<typeof betterAuth>;

const SUPPORTED_SCOPES = [
  'openid',
  'profile',
  'email',
  'offline_access',
  ...BACKEND_SUPPORTED_SCOPES,
] as const;

const asMuninAuth = (instance: unknown): BetterAuthInstance => instance as BetterAuthInstance;
import { schema, type Db } from '@getmunin/db';
import type { Mailer } from '@getmunin/core';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { resetPasswordEmail, verifyEmailEmail } from './email-templates.js';

export type MuninAuth = BetterAuthInstance;

export interface MuninAuthOptions {
  db: Db;
  baseUrl: string;
  authSecret: string;
  trustedOrigins?: string[];
  mailer?: Mailer;
  /** URL of the dashboard, used to build verification + reset links. */
  webBaseUrl?: string;
  /**
   * Lowercase email domains permitted to self-register without an invite.
   * Empty = invite-only. The first user to sign up bootstraps the singleton
   * org regardless of this allowlist.
   */
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
}: MuninAuthOptions): BetterAuthInstance {
  const origins = uniqueOrigins([baseUrl, ...(trustedOrigins ?? [])]);
  const dashboardUrl = (webBaseUrl ?? trustedOrigins?.[0] ?? baseUrl).replace(/\/+$/, '');
  const validAudiences = computeValidAudiences(baseUrl);

  return asMuninAuth(betterAuth({
    baseURL: baseUrl,
    basePath: '/auth',
    secret: authSecret,
    database: drizzleAdapter(db, {
      provider: 'pg',
      schema: {
        user: schema.users,
        session: schema.sessions,
        account: schema.accounts,
        verification: schema.verifications,
        oauthClient: schema.oauthClient,
        oauthAccessToken: schema.oauthAccessToken,
        oauthRefreshToken: schema.oauthRefreshToken,
        oauthConsent: schema.oauthConsent,
        jwks: schema.jwks,
      },
    }),
    plugins: [
      jwt({ jwt: { issuer: baseUrl.replace(/\/+$/, '') } }),
      oauthProvider({
        loginPage: `${dashboardUrl}/login`,
        consentPage: `${dashboardUrl}/dashboard/oauth/consent`,
        allowDynamicClientRegistration: true,
        allowUnauthenticatedClientRegistration: true,
        scopes: [...SUPPORTED_SCOPES],
        validAudiences,
        silenceWarnings: { oauthAuthServerConfig: true, openidConfig: true },
      }),
    ],
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: false,
      autoSignIn: true,
      sendResetPassword: mailer
        ? async ({ user, url }: { user: { email: string }; url: string }) => {
            const tpl = resetPasswordEmail(url);
            await mailer.send({
              to: user.email,
              subject: tpl.subject,
              text: tpl.text,
            });
          }
        : undefined,
    },
    emailVerification: mailer
      ? {
          sendVerificationEmail: async ({ user, url }: { user: { email: string }; url: string }) => {
            const tpl = verifyEmailEmail(url);
            await mailer.send({
              to: user.email,
              subject: tpl.subject,
              text: tpl.text,
            });
          },
          sendOnSignUp: true,
        }
      : undefined,
    trustedOrigins: origins,
    advanced: {
      useSecureCookies: dashboardUrl.startsWith('https://'),
    },
    databaseHooks: {
      user: {
        create: {
          before: async (user: { email: string; name?: string | null }) => {
            await assertSignupAllowed(db, user.email, allowedEmailDomains);
          },
          after: async (user: { id: string; email: string; name?: string | null }) => {
            await ensureSingletonOrgMembershipFor(db, user);
          },
        },
      },
    },
  }));
}

/**
 * Gate signup. Allowed when:
 *   1. There are no users yet (first-run bootstrap — this user becomes admin).
 *   2. The email domain is in MUNIN_ALLOWED_EMAIL_DOMAINS.
 *   3. There is a pending, unrevoked, unexpired invitation for this email.
 *
 * Otherwise reject. Public deployments without an allowlist are invite-only —
 * strangers can't self-serve into the singleton org.
 */
async function assertSignupAllowed(
  db: Db,
  rawEmail: string,
  allowedEmailDomains: string[],
): Promise<void> {
  const email = rawEmail.trim().toLowerCase();

  const userCount = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(schema.users);
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

/**
 * OSS single-tenant: ensure the one shared org exists, then attach the
 * user as a member. The first user becomes `owner`; subsequent users
 * become `member`. Idempotent — skips if the user already has any
 * membership (e.g. they came in via an invitation that pre-attached them).
 */
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

function uniqueOrigins(values: string[]): string[] {
  return Array.from(new Set(values.map((v) => v.replace(/\/+$/, ''))));
}

export function computeValidAudiences(baseUrl: string): string[] {
  const canonical = baseUrl.replace(/\/+$/, '');
  const variants = new Set<string>([canonical, `${canonical}/`]);
  try {
    const origin = new URL(canonical).origin;
    variants.add(origin);
    variants.add(`${origin}/`);
  } catch (err) {
    console.warn('[auth] computeValidAudiences: baseUrl is not a parseable URL', { baseUrl, err });
  }
  return Array.from(variants);
}

export function readAllowedEmailDomainsFromEnv(): string[] {
  const env = process.env.MUNIN_ALLOWED_EMAIL_DOMAINS;
  if (!env) return [];
  return env
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}
