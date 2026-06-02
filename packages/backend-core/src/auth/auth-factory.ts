import { betterAuth, type BetterAuthOptions } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { jwt } from 'better-auth/plugins';
import { oauthProvider } from '@better-auth/oauth-provider';
import { schema, type Db } from '@getmunin/db';
import {
  SUPPORTED_SCOPES as MUNIN_SUPPORTED_SCOPES,
  mcpResourceUrl,
} from '../oauth/oauth.constants.ts';

type BetterAuthInstance = ReturnType<typeof betterAuth>;

export const STANDARD_OIDC_SCOPES = ['openid', 'profile', 'email', 'offline_access'] as const;

export const SUPPORTED_AUTH_SCOPES = [
  ...STANDARD_OIDC_SCOPES,
  ...MUNIN_SUPPORTED_SCOPES,
] as const;

export interface SignupHookUser {
  id: string;
  email: string;
  name?: string | null;
}

export interface SignupBeforeUser {
  email: string;
  name?: string | null;
}

export interface DeleteUserConfig {
  beforeDelete?: (user: { id: string; email: string }) => Promise<void>;
  sendDeleteAccountVerification?: (params: {
    user: { email: string };
    url: string;
  }) => Promise<void>;
}

export interface MuninAuthCoreOptions {
  db: Db;
  baseUrl: string;
  authSecret: string;
  trustedOrigins?: string[];
  webBaseUrl?: string;

  sendResetPassword?: (params: { user: { email: string }; url: string }) => Promise<void>;
  sendVerificationEmail?: (params: { user: { email: string }; url: string }) => Promise<void>;

  signupBefore?: (user: SignupBeforeUser) => Promise<void>;
  signupAfter?: (user: SignupHookUser) => Promise<void>;

  deleteUser?: DeleteUserConfig;

  socialProviders?: {
    google?: { clientId: string; clientSecret: string };
    github?: { clientId: string; clientSecret: string };
  };

  crossSubDomainCookies?: { domain: string };

  rateLimit?: BetterAuthOptions['rateLimit'];

  logger?: BetterAuthOptions['logger'];
}

export type MuninAuthInstance = BetterAuthInstance;

const asMuninAuth = (instance: unknown): MuninAuthInstance => instance as MuninAuthInstance;

export function createMuninAuthCore(opts: MuninAuthCoreOptions): MuninAuthInstance {
  const origins = uniqueOrigins([opts.baseUrl, ...(opts.trustedOrigins ?? [])]);
  const dashboardUrl = (opts.webBaseUrl ?? opts.trustedOrigins?.[0] ?? opts.baseUrl).replace(
    /\/+$/,
    '',
  );
  const validAudiences = computeValidAudiences(opts.baseUrl, mcpResourceUrl());
  const issuer = opts.baseUrl.replace(/\/+$/, '');

  const socialProviders = buildSocialProviders(opts.socialProviders);

  return asMuninAuth(betterAuth({
    baseURL: opts.baseUrl,
    basePath: '/auth',
    secret: opts.authSecret,
    rateLimit: opts.rateLimit,
    logger: opts.logger,
    database: drizzleAdapter(opts.db, {
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
        rateLimit: schema.authRateLimit,
      },
    }),
    plugins: [
      jwt({ jwt: { issuer } }),
      oauthProvider({
        loginPage: `${dashboardUrl}/login`,
        consentPage: `${dashboardUrl}/dashboard/oauth/consent`,
        allowDynamicClientRegistration: true,
        allowUnauthenticatedClientRegistration: true,
        scopes: [...SUPPORTED_AUTH_SCOPES],
        validAudiences,
        silenceWarnings: { oauthAuthServerConfig: true, openidConfig: true },
      }),
    ],
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: false,
      autoSignIn: true,
      sendResetPassword: opts.sendResetPassword,
    },
    emailVerification: opts.sendVerificationEmail
      ? {
          sendVerificationEmail: opts.sendVerificationEmail,
          sendOnSignUp: true,
        }
      : undefined,
    socialProviders,
    account: { encryptOAuthTokens: true },
    user: opts.deleteUser
      ? {
          deleteUser: {
            enabled: true,
            beforeDelete: opts.deleteUser.beforeDelete,
            sendDeleteAccountVerification: opts.deleteUser.sendDeleteAccountVerification,
          },
        }
      : undefined,
    trustedOrigins: origins,
    advanced: {
      useSecureCookies: dashboardUrl.startsWith('https://'),
      ...(opts.crossSubDomainCookies
        ? {
            crossSubDomainCookies: {
              enabled: true,
              domain: opts.crossSubDomainCookies.domain,
            },
          }
        : {}),
    },
    databaseHooks:
      opts.signupBefore || opts.signupAfter
        ? {
            user: {
              create: {
                before: opts.signupBefore,
                after: opts.signupAfter,
              },
            },
          }
        : undefined,
  }));
}

export function computeValidAudiences(
  baseUrl: string,
  mcpResourceUrl?: string | null,
): string[] {
  const variants = new Set<string>();
  addUrlVariants(variants, baseUrl);
  if (mcpResourceUrl) addUrlVariants(variants, mcpResourceUrl);
  return Array.from(variants);
}

function addUrlVariants(variants: Set<string>, url: string): void {
  const canonical = url.replace(/\/+$/, '');
  if (!canonical) return;
  variants.add(canonical);
  variants.add(`${canonical}/`);
  try {
    const origin = new URL(canonical).origin;
    variants.add(origin);
    variants.add(`${origin}/`);
  } catch (err) {
    console.warn('[auth-factory] computeValidAudiences: url is not a parseable URL', {
      url,
      err,
    });
  }
}

function uniqueOrigins(values: string[]): string[] {
  return Array.from(new Set(values.map((v) => v.replace(/\/+$/, ''))));
}

function buildSocialProviders(
  cfg: MuninAuthCoreOptions['socialProviders'],
): BetterAuthOptions['socialProviders'] | undefined {
  if (!cfg) return undefined;
  if (!cfg.google && !cfg.github) return undefined;
  return {
    ...(cfg.google
      ? { google: { clientId: cfg.google.clientId, clientSecret: cfg.google.clientSecret } }
      : {}),
    ...(cfg.github
      ? { github: { clientId: cfg.github.clientId, clientSecret: cfg.github.clientSecret } }
      : {}),
  };
}
