import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import type { AddressInfo } from 'node:net';
import { createDb, runMigrations, schema } from '@getmunin/db';
import { sql } from 'drizzle-orm';
import { hashSecret, randomToken } from '@getmunin/core';
import { createApp } from '@getmunin/backend-core';
import { createEmailVerificationToken } from 'better-auth/api';
import { AppModule } from '../app.module.ts';

const TEST_URL = process.env.TEST_DATABASE_URL;
const skipReason = TEST_URL
  ? null
  : 'Set TEST_DATABASE_URL to a Postgres URL to run OSS signup tests.';

(skipReason ? describe.skip : describe)('Singleton org + invite-only signup', () => {
  let app: INestApplication;
  let baseUrl: string;
  let db: ReturnType<typeof createDb>;
  const userIdsToCleanup: string[] = [];
  const orgIdsToCleanup: string[] = [];

  beforeAll(async () => {
    process.env.MUNIN_AUTH_SECRET ??= 'test-secret-do-not-use-in-prod';
    process.env.MUNIN_KEY_PEPPER ??= 'test-pepper';
    process.env.MUNIN_EMBEDDING_PROVIDER = 'stub';
    process.env.MUNIN_MAIL_PROVIDER = 'stub';
    process.env.MUNIN_WEBHOOK_WORKER_DISABLED = '1';
    process.env.MUNIN_CMS_SCHEDULE_WORKER_DISABLED = '1';
    process.env.MUNIN_STORAGE_PROVIDER = 'local';
    process.env.MUNIN_STORAGE_LOCAL_PATH = '/tmp/munin-oss-signup-test';
    process.env.MUNIN_STORAGE_LOCAL_BASE_URL = 'http://127.0.0.1:0/static/assets';
    process.env.MUNIN_ALLOWED_EMAIL_DOMAINS = 'allowed.example';

    await runMigrations(TEST_URL!);
    const appUrl = TEST_URL!.replace(/(postgres(?:ql)?:\/\/)[^:@]+:[^@]+@/, '$1munin_app:munin_app@');
    process.env.DATABASE_URL = appUrl;

    db = createDb(TEST_URL!, { serviceRole: true });
    await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);

    await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', true)`);
    await db.delete(schema.orgInvitations);
    await db.delete(schema.orgMembers);
    await db.delete(schema.users);
    await db.delete(schema.orgs);
    await db.delete(schema.authRateLimit);

    app = await createApp(AppModule, { logger: false });
    await app.listen(0, '127.0.0.1');
    const server = app.getHttpServer() as { address(): AddressInfo | string | null };
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('expected AddressInfo');
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    if (app) await app.close();
    if (db) {
      await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', true)`);
      for (const userId of userIdsToCleanup) {
        await db.delete(schema.users).where(sql`id = ${userId}`);
      }
      for (const orgId of orgIdsToCleanup) {
        await db.delete(schema.orgs).where(sql`id = ${orgId}`);
      }
    }
  });

  async function attemptSignup(
    email: string,
  ): Promise<{ status: number; userId?: string; cookie?: string }> {
    const res = await fetch(`${baseUrl}/auth/sign-up/email`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: 'verystrongpassword123', name: email.split('@')[0] }),
    });
    if (res.status >= 400) return { status: res.status };
    const body = (await res.json()) as { user: { id: string } };
    const cookie = res.headers
      .getSetCookie()
      .map((c) => c.split(';')[0])
      .join('; ');
    return { status: res.status, userId: body.user.id, cookie };
  }

  async function seedSignedInUser(email: string): Promise<{ userId: string; cookie: string }> {
    const [user] = await db
      .insert(schema.users)
      .values({ email, name: email.split('@')[0]! })
      .returning({ id: schema.users.id });
    const sessionToken = randomToken(32);
    await db.insert(schema.sessions).values({
      userId: user!.id,
      token: sessionToken,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });
    userIdsToCleanup.push(user!.id);
    return { userId: user!.id, cookie: `better-auth.session_token=${sessionToken}` };
  }

  async function membershipsOf(userId: string): Promise<Array<{ role: string; orgId: string }>> {
    return db
      .select({ role: schema.orgMembers.role, orgId: schema.orgMembers.orgId })
      .from(schema.orgMembers)
      .where(sql`user_id = ${userId}`);
  }

  async function createInvitation(email: string, role: string): Promise<string> {
    const [orgRow] = await db.select({ id: schema.orgs.id }).from(schema.orgs).limit(1);
    expect(orgRow).toBeTruthy();
    const token = randomToken(24);
    await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', true)`);
    await db.insert(schema.orgInvitations).values({
      orgId: orgRow!.id,
      email,
      role,
      tokenHash: hashSecret(token),
      invitedByUserId: null,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });
    return token;
  }

  async function acceptInvitation(token: string, cookie: string): Promise<Response> {
    return fetch(`${baseUrl}/v1/invitations/accept`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ token }),
    });
  }

  it('first user signs up and becomes owner of the singleton "munin" org', async () => {
    const email = `first-${Date.now()}@anywhere.example`;
    const { status, userId } = await attemptSignup(email);
    expect(status).toBeLessThan(400);
    expect(userId).toBeTruthy();
    userIdsToCleanup.push(userId!);

    const memberships = await db
      .select({ orgId: schema.orgMembers.orgId, role: schema.orgMembers.role })
      .from(schema.orgMembers)
      .where(sql`user_id = ${userId!}`);
    expect(memberships).toHaveLength(1);
    expect(memberships[0]!.role).toBe('owner');

    const org = await db
      .select({ id: schema.orgs.id })
      .from(schema.orgs)
      .where(sql`id = ${memberships[0]!.orgId}`);
    expect(org[0]).toBeDefined();
    orgIdsToCleanup.push(org[0]!.id);
  });

  it('subsequent signup with non-allowlisted, non-invited email is rejected', async () => {
    const { status } = await attemptSignup(`stranger-${Date.now()}@somewhere.example`);
    expect(status).toBeGreaterThanOrEqual(400);
  });


  it('allowlisted-domain signup gets no membership until the email is verified', async () => {
    const email = `colleague-${Date.now()}@allowed.example`;
    const { status, userId } = await attemptSignup(email);
    expect(status).toBeLessThan(400);
    userIdsToCleanup.push(userId!);
    expect(await membershipsOf(userId!)).toHaveLength(0);

    const token = await createEmailVerificationToken(process.env.MUNIN_AUTH_SECRET!, email);
    const verify = await fetch(`${baseUrl}/auth/verify-email?token=${encodeURIComponent(token)}`);
    expect(verify.status).toBeLessThan(400);

    const memberships = await membershipsOf(userId!);
    expect(memberships).toHaveLength(1);
    expect(memberships[0]!.role).toBe('member');
  });

  it('invited signup joins only by accepting the token, with the invited role, and marks the email verified', async () => {
    const email = `invitee-${Date.now()}@elsewhere.example`;
    const token = await createInvitation(email, 'admin');

    const { status, userId, cookie } = await attemptSignup(email);
    expect(status).toBeLessThan(400);
    userIdsToCleanup.push(userId!);
    expect(await membershipsOf(userId!)).toHaveLength(0);

    const accept = await acceptInvitation(token, cookie!);
    expect(accept.status).toBe(200);

    const memberships = await membershipsOf(userId!);
    expect(memberships).toHaveLength(1);
    expect(memberships[0]!.role).toBe('admin');

    const [user] = await db
      .select({ emailVerified: schema.users.emailVerified })
      .from(schema.users)
      .where(sql`id = ${userId!}`);
    expect(user!.emailVerified).toBe(true);

    const again = await acceptInvitation(token, cookie!);
    expect(again.status).toBe(200);
    expect(await membershipsOf(userId!)).toHaveLength(1);
  });

  it('concurrent accepts by the invitee both succeed and create one membership', async () => {
    const email = `double-${Date.now()}@elsewhere.example`;
    const token = await createInvitation(email, 'member');
    const { userId, cookie } = await seedSignedInUser(email);

    const results = await Promise.all([
      acceptInvitation(token, cookie),
      acceptInvitation(token, cookie),
    ]);
    expect(results.map((r) => r.status)).toEqual([200, 200]);
    expect(await membershipsOf(userId)).toHaveLength(1);
  });

  it('an invitation claimed by another account answers 409', async () => {
    const email = `claimed-${Date.now()}@elsewhere.example`;
    const token = await createInvitation(email, 'member');
    const { cookie } = await seedSignedInUser(email);

    expect((await acceptInvitation(token, cookie)).status).toBe(200);
    await db
      .update(schema.orgInvitations)
      .set({ acceptedByUserId: null })
      .where(sql`token_hash = ${hashSecret(token)}`);

    expect((await acceptInvitation(token, cookie)).status).toBe(409);
  });

  it('an invitation cannot be accepted by a user signed in with a different email', async () => {
    const invitedEmail = `invited-${Date.now()}@elsewhere.example`;
    const token = await createInvitation(invitedEmail, 'owner');

    const other = await attemptSignup(`bystander-${Date.now()}@allowed.example`);
    expect(other.status).toBeLessThan(400);
    userIdsToCleanup.push(other.userId!);

    const accept = await acceptInvitation(token, other.cookie!);
    expect(accept.status).toBe(403);
    const body = (await accept.json()) as { code?: string };
    expect(body.code).toBe('invitation_email_mismatch');
    expect(await membershipsOf(other.userId!)).toHaveLength(0);

    const [row] = await db
      .select({ acceptedAt: schema.orgInvitations.acceptedAt })
      .from(schema.orgInvitations)
      .where(sql`token_hash = ${hashSecret(token)}`);
    expect(row!.acceptedAt).toBeNull();
  });
});
