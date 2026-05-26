import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import type { AddressInfo } from 'node:net';
import { createDb, runMigrations, schema } from '@getmunin/db';
import { sql } from 'drizzle-orm';
import { hashSecret, randomToken } from '@getmunin/core';
import { createApp } from '@getmunin/backend-core';
import { AppModule } from '../app.module.ts';

const TEST_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const skipReason = TEST_URL
  ? null
  : 'Set DATABASE_URL or TEST_DATABASE_URL to a Postgres URL to run OSS signup tests.';

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

    // Start from a clean slate so the "first user becomes owner" path runs.
    await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', true)`);
    await db.delete(schema.orgInvitations);
    await db.delete(schema.orgMembers);
    await db.delete(schema.users);
    await db.delete(schema.orgs);

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

  async function attemptSignup(email: string): Promise<{ status: number; userId?: string }> {
    const res = await fetch(`${baseUrl}/auth/sign-up/email`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: 'verystrongpassword123', name: email.split('@')[0] }),
    });
    if (res.status >= 400) return { status: res.status };
    const body = (await res.json()) as { user: { id: string } };
    return { status: res.status, userId: body.user.id };
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

  it('subsequent signup with allowlisted domain joins the singleton org as member', async () => {
    const email = `colleague-${Date.now()}@allowed.example`;
    const { status, userId } = await attemptSignup(email);
    expect(status).toBeLessThan(400);
    userIdsToCleanup.push(userId!);

    const memberships = await db
      .select({ role: schema.orgMembers.role, orgId: schema.orgMembers.orgId })
      .from(schema.orgMembers)
      .where(sql`user_id = ${userId!}`);
    expect(memberships).toHaveLength(1);
    expect(memberships[0]!.role).toBe('member');
  });

  it('signup with a valid pending invitation succeeds even outside the allowlist', async () => {
    const email = `invitee-${Date.now()}@elsewhere.example`;
    // Find the singleton org id.
    const [orgRow] = await db
      .select({ id: schema.orgs.id })
      .from(schema.orgs)
      .limit(1);
    expect(orgRow).toBeTruthy();

    const token = randomToken(24);
    await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', true)`);
    await db.insert(schema.orgInvitations).values({
      orgId: orgRow!.id,
      email,
      role: 'member',
      tokenHash: hashSecret(token),
      invitedByUserId: null,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });

    const { status, userId } = await attemptSignup(email);
    expect(status).toBeLessThan(400);
    userIdsToCleanup.push(userId!);
  });
});
