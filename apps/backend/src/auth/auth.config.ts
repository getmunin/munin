import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { schema, type Db } from '@munin/db';
import type { Mailer } from '@munin/core';
import { eq, sql } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';

export type MuninAuth = ReturnType<typeof createMuninAuth>;

export interface MuninAuthOptions {
  db: Db;
  baseUrl: string;
  authSecret: string;
  trustedOrigins?: string[];
  google?: { clientId: string; clientSecret: string };
  mailer?: Mailer;
  /** URL of the dashboard, used to build verification + reset links. */
  webBaseUrl?: string;
}

export function createMuninAuth({
  db,
  baseUrl,
  authSecret,
  trustedOrigins,
  google,
  mailer,
  webBaseUrl,
}: MuninAuthOptions) {
  const origins = uniqueOrigins([baseUrl, ...(trustedOrigins ?? [])]);
  const dashboardUrl = (webBaseUrl ?? trustedOrigins?.[0] ?? baseUrl).replace(/\/+$/, '');

  return betterAuth({
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
      },
    }),
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: false,
      autoSignIn: true,
      sendResetPassword: mailer
        ? async ({ user, url }: { user: { email: string }; url: string }) => {
            await mailer.send({
              to: user.email,
              subject: 'Reset your Munin password',
              text: [
                'You asked to reset your Munin password.',
                '',
                `Click the link below to set a new one (valid for 1 hour):`,
                url,
                '',
                "If you didn't request this, you can ignore this email.",
              ].join('\n'),
            });
          }
        : undefined,
    },
    emailVerification: mailer
      ? {
          sendVerificationEmail: async ({ user, url }: { user: { email: string }; url: string }) => {
            await mailer.send({
              to: user.email,
              subject: 'Verify your Munin email',
              text: [
                `Welcome to Munin.`,
                '',
                'Confirm your email so we know we can reach you:',
                url,
                '',
                `If you didn't sign up, ignore this email.`,
              ].join('\n'),
            });
          },
          sendOnSignUp: true,
        }
      : undefined,
    socialProviders: google
      ? {
          google: {
            clientId: google.clientId,
            clientSecret: google.clientSecret,
          },
        }
      : undefined,
    trustedOrigins: origins,
    advanced: {
      useSecureCookies: dashboardUrl.startsWith('https://'),
    },
    databaseHooks: {
      user: {
        create: {
          after: async (user: { id: string; email: string; name?: string | null }) => {
            await provisionPersonalOrgFor(db, user);
          },
        },
      },
    },
  });
}

/**
 * Auto-provision a personal org + owner membership for a freshly-created
 * user. Idempotent: skips if the user already has any membership (e.g. an
 * invited user accepted the invite before the hook ran, or a re-run of the
 * hook).
 *
 * The slug derives from the email local part plus a short random suffix to
 * sidestep collisions; full collision-loop is overkill at our scale.
 */
async function provisionPersonalOrgFor(
  db: Db,
  user: { id: string; email: string; name?: string | null },
): Promise<void> {
  const existing = await db
    .select({ orgId: schema.orgMembers.orgId })
    .from(schema.orgMembers)
    .where(eq(schema.orgMembers.userId, user.id))
    .limit(1);
  if (existing[0]) return;

  const localPart = user.email.split('@')[0] ?? 'org';
  const baseSlug = localPart
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32) || 'org';
  const slug = `${baseSlug}-${randomBytes(3).toString('hex')}`;
  const name = user.name?.trim() || `${baseSlug}'s workspace`;

  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.bypass_rls', 'on', true)`);
    const [org] = await tx
      .insert(schema.orgs)
      .values({ name, slug })
      .returning({ id: schema.orgs.id });
    await tx.insert(schema.orgMembers).values({
      orgId: org!.id,
      userId: user.id,
      role: 'owner',
    });
  });
}

function uniqueOrigins(values: string[]): string[] {
  return Array.from(new Set(values.map((v) => v.replace(/\/+$/, ''))));
}

export function readGoogleProviderFromEnv(): { clientId: string; clientSecret: string } | undefined {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) return undefined;
  return { clientId, clientSecret };
}

export function readTrustedOriginsFromEnv(): string[] {
  const env = process.env.MUNIN_AUTH_TRUSTED_ORIGINS;
  if (!env) return ['http://localhost:3000', 'http://127.0.0.1:3000'];
  return env.split(',').map((s) => s.trim()).filter(Boolean);
}
