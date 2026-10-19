import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { handleOAuthUserInfo } from 'better-auth/oauth2';
import { createDb, runMigrations, schema } from '@getmunin/db';
import { eq } from 'drizzle-orm';
import { createMuninAuthCore } from './auth-factory.ts';

const TEST_URL = process.env.TEST_DATABASE_URL;
const skipReason = TEST_URL
  ? null
  : 'Set TEST_DATABASE_URL to a Postgres URL to run the account linking test.';

const AS_URL = 'http://localhost:3001';
const VICTIM_EMAIL = 'account-linking-victim@example.test';

type LinkContext = Parameters<typeof handleOAuthUserInfo>[0];

(skipReason ? describe.skip : describe)('social account linking', () => {
  let db: ReturnType<typeof createDb>;
  let auth: ReturnType<typeof createMuninAuthCore>;
  let victimId: string;

  const linkContext = async (): Promise<LinkContext> => ({ context: await auth.$context }) as LinkContext;

  const signInWith = async (
    providerId: 'github' | 'google',
    accountId: string,
    emailVerified: boolean,
  ) =>
    handleOAuthUserInfo(await linkContext(), {
      userInfo: {
        id: accountId,
        email: VICTIM_EMAIL,
        emailVerified,
        name: 'Ola Nordmann',
        image: null,
      },
      account: {
        providerId,
        accountId,
        issuer: providerId === 'github' ? 'https://github.com' : 'https://accounts.google.com',
      },
      disableSignUp: true,
    });

  const linkedProviders = async (): Promise<string[]> => {
    const rows = await db
      .select({ providerId: schema.accounts.providerId })
      .from(schema.accounts)
      .where(eq(schema.accounts.userId, victimId));
    return rows.map((r) => r.providerId).sort();
  };

  beforeAll(async () => {
    await runMigrations(TEST_URL!);
    db = createDb(TEST_URL!);
    await db.delete(schema.users).where(eq(schema.users.email, VICTIM_EMAIL));
    auth = createMuninAuthCore({
      db,
      baseUrl: AS_URL,
      authSecret: 'integration-test-secret-000000000000000000',
      socialProviders: {
        github: { clientId: 'github-client', clientSecret: 'github-secret' },
        google: { clientId: 'google-client', clientSecret: 'google-secret' },
      },
    });
    const [victim] = await db
      .insert(schema.users)
      .values({ email: VICTIM_EMAIL, emailVerified: true, name: 'Kari Nordmann' })
      .returning({ id: schema.users.id });
    victimId = victim!.id;
  });

  afterAll(async () => {
    if (db) await db.delete(schema.users).where(eq(schema.users.email, VICTIM_EMAIL));
  });

  it('trusts only google to vouch for an email it has not marked verified', async () => {
    expect((await auth.$context).trustedProviders).toEqual(['google']);
  });

  it('refuses to link an unverified github email into an existing verified user', async () => {
    const result = await signInWith('github', 'gh-unverified-1', false);
    expect(result.error).toBe('account not linked');
    expect(result.data).toBeNull();
    expect(await linkedProviders()).toEqual([]);
  });

  it('still links a github account whose email github reports as verified', async () => {
    const result = await signInWith('github', 'gh-verified-1', true);
    expect(result.error).toBeNull();
    expect(result.data?.user.id).toBe(victimId);
    expect(await linkedProviders()).toEqual(['github']);
  });
});
