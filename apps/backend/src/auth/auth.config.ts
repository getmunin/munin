import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { schema, type Db } from '@munin/db';
import type { Mailer } from '@munin/core';

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
