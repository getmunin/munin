import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { schema, type Db } from '@munin/db';

export type MuninAuth = ReturnType<typeof createMuninAuth>;

export interface MuninAuthOptions {
  db: Db;
  baseUrl: string;
  authSecret: string;
  google?: { clientId: string; clientSecret: string };
}

export function createMuninAuth({ db, baseUrl, authSecret, google }: MuninAuthOptions) {
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
    },
    socialProviders: google
      ? {
          google: {
            clientId: google.clientId,
            clientSecret: google.clientSecret,
          },
        }
      : undefined,
    trustedOrigins: [baseUrl],
  });
}

export function readGoogleProviderFromEnv(): { clientId: string; clientSecret: string } | undefined {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) return undefined;
  return { clientId, clientSecret };
}
