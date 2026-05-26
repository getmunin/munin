import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import type { AddressInfo } from 'node:net';
import { signUnsubscribeToken } from '@getmunin/core';
import { createDb, runMigrations, schema } from '@getmunin/db';
import { sql } from 'drizzle-orm';
import { AppModule } from '../app.module.ts';

const TEST_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const skipReason = TEST_URL
  ? null
  : 'Set DATABASE_URL or TEST_DATABASE_URL to a Postgres URL to run unsubscribe integration tests.';

(skipReason ? describe.skip : describe)('Outreach unsubscribe controller', () => {
  let app: INestApplication;
  let baseUrl: string;
  let db: ReturnType<typeof createDb>;
  let orgId: string;
  let contactId: string;
  const PEPPER = 'unsubscribe-it-pepper';

  beforeAll(async () => {
    process.env.MUNIN_AUTH_SECRET ??= 'test-secret-do-not-use-in-prod-it-must-be-32-chars';
    process.env.MUNIN_KEY_PEPPER = PEPPER;
    process.env.MUNIN_EMBEDDING_PROVIDER = 'stub';
    process.env.MUNIN_MAIL_PROVIDER = 'stub';
    process.env.MUNIN_WEBHOOK_WORKER_DISABLED = '1';

    await runMigrations(TEST_URL!);
    const appUrl = TEST_URL!.replace(/(postgres(?:ql)?:\/\/)[^:@]+:[^@]+@/, '$1munin_app:munin_app@');
    process.env.DATABASE_URL = appUrl;

    db = createDb(TEST_URL!, { serviceRole: true });
    await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);

    const ts = Date.now();
    const [org] = await db
      .insert(schema.orgs)
      .values({ name: 'Unsub Org' })
      .returning();
    orgId = org!.id;

    const [contact] = await db
      .insert(schema.crmContacts)
      .values({ orgId, name: 'Bob', email: 'bob@example.com' })
      .returning();
    contactId = contact!.id;

    app = await NestFactory.create(AppModule, { logger: false });
    await app.listen(0, '127.0.0.1');
    const server = app.getHttpServer() as { address(): AddressInfo | string | null };
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('expected AddressInfo');
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    if (app) await app.close();
    if (db) {
      await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
      await db.delete(schema.orgs).where(sql`id = ${orgId}`);
    }
  });

  it('valid token marks the contact unsubscribed and logs an activity', async () => {
    const token = signUnsubscribeToken({ orgId, contactId, campaignId: 'cmp_test' }, PEPPER);
    const res = await fetch(`${baseUrl}/api/v1/outreach/unsubscribe?token=${encodeURIComponent(token)}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; alreadyUnsubscribed: boolean; contactFound: boolean };
    expect(body.ok).toBe(true);
    expect(body.contactFound).toBe(true);
    expect(body.alreadyUnsubscribed).toBe(false);

    const rows = await db
      .select({
        unsubscribedAt: schema.crmContacts.unsubscribedAt,
        doNotContact: schema.crmContacts.doNotContact,
      })
      .from(schema.crmContacts)
      .where(sql`id = ${contactId}`);
    expect(rows[0]!.unsubscribedAt).not.toBeNull();
    expect(rows[0]!.doNotContact).toBe(true);

    const activities = await db
      .select({ subject: schema.crmActivities.subject })
      .from(schema.crmActivities)
      .where(sql`contact_id = ${contactId}`);
    expect(activities.some((a) => a.subject === 'Unsubscribed')).toBe(true);
  });

  it('replays as a no-op (alreadyUnsubscribed=true)', async () => {
    const token = signUnsubscribeToken({ orgId, contactId, campaignId: 'cmp_test' }, PEPPER);
    const res = await fetch(`${baseUrl}/api/v1/outreach/unsubscribe?token=${encodeURIComponent(token)}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { alreadyUnsubscribed: boolean };
    expect(body.alreadyUnsubscribed).toBe(true);
  });

  it('rejects a tampered token with 400', async () => {
    const token = signUnsubscribeToken({ orgId, contactId, campaignId: 'cmp_test' }, PEPPER);
    const tampered = token.replace(contactId, 'cct_evil');
    const res = await fetch(
      `${baseUrl}/api/v1/outreach/unsubscribe?token=${encodeURIComponent(tampered)}`,
    );
    expect(res.status).toBe(400);
  });

  it('returns 400 when token is missing', async () => {
    const res = await fetch(`${baseUrl}/api/v1/outreach/unsubscribe`);
    expect(res.status).toBe(400);
  });
});
