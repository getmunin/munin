import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import type { AddressInfo } from 'node:net';
import { signUnsubscribeToken } from '@getmunin/core';
import { createDb, runMigrations, schema } from '@getmunin/db';
import { sql } from 'drizzle-orm';
import { AppModule } from '../app.module.ts';

const TEST_URL = process.env.TEST_DATABASE_URL;
const skipReason = TEST_URL
  ? null
  : 'Set TEST_DATABASE_URL to a Postgres URL to run unsubscribe integration tests.';

(skipReason ? describe.skip : describe)('Outreach unsubscribe controller', () => {
  let app: INestApplication;
  let baseUrl: string;
  let db: ReturnType<typeof createDb>;
  let orgId: string;
  let contactId: string;
  let pageContactId: string;
  let multipartContactId: string;
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

    const [org] = await db
      .insert(schema.orgs)
      .values({ name: 'Unsub Org' })
      .returning();
    orgId = org!.id;

    const [contact, pageContact, multipartContact] = await db
      .insert(schema.crmContacts)
      .values([
        { orgId, name: 'Ola Nordmann', email: 'ola@example.com' },
        { orgId, name: 'Kari Nordmann', email: 'kari@example.com' },
        { orgId, name: 'Per Nordmann', email: 'per@example.com' },
      ])
      .returning();
    contactId = contact!.id;
    pageContactId = pageContact!.id;
    multipartContactId = multipartContact!.id;

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

  const urlFor = (token: string) =>
    `${baseUrl}/v1/outreach/unsubscribe?token=${encodeURIComponent(token)}`;
  const tokenFor = (id: string) =>
    signUnsubscribeToken({ orgId, contactId: id, campaignId: 'cmp_test' }, PEPPER);
  const contactState = async (id: string) => {
    const rows = await db
      .select({
        unsubscribedAt: schema.crmContacts.unsubscribedAt,
        doNotContact: schema.crmContacts.doNotContact,
      })
      .from(schema.crmContacts)
      .where(sql`id = ${id}`);
    return rows[0]!;
  };
  const unsubscribeMethods = async (id: string) => {
    const rows = await db
      .select({ metadata: schema.crmActivities.metadata })
      .from(schema.crmActivities)
      .where(sql`contact_id = ${id} AND subject = 'Unsubscribed'`);
    return rows.map((r) => (r.metadata as { unsubscribe: { method: string } }).unsubscribe.method);
  };

  it('opening the link shows a confirmation page and unsubscribes nobody, so a link scanner is harmless', async () => {
    const res = await fetch(urlFor(tokenFor(contactId)), {
      headers: { 'accept-language': 'nb-NO,nb;q=0.9' },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/^text\/html/);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const html = await res.text();
    expect(html).toContain('Vil du melde deg av e-poster fra Unsub Org?');
    expect(html).toContain('<form method="post"');

    const state = await contactState(contactId);
    expect(state.unsubscribedAt).toBeNull();
    expect(state.doNotContact).toBe(false);
  });

  it('an RFC 8058 one-click POST unsubscribes the contact and logs the method', async () => {
    const res = await fetch(urlFor(tokenFor(contactId)), {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'List-Unsubscribe=One-Click',
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, alreadyUnsubscribed: false, contactFound: true });

    const state = await contactState(contactId);
    expect(state.unsubscribedAt).not.toBeNull();
    expect(state.doNotContact).toBe(true);
    expect(await unsubscribeMethods(contactId)).toEqual(['one_click']);
  });

  it('replays a one-click POST as a no-op', async () => {
    const res = await fetch(urlFor(tokenFor(contactId)), {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'List-Unsubscribe=One-Click',
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, alreadyUnsubscribed: true, contactFound: true });
    expect(await unsubscribeMethods(contactId)).toEqual(['one_click']);
  });

  it('accepts a one-click POST sent as multipart/form-data', async () => {
    const form = new FormData();
    form.set('List-Unsubscribe', 'One-Click');
    const res = await fetch(urlFor(tokenFor(multipartContactId)), { method: 'POST', body: form });
    expect(res.status).toBe(200);
    expect((await contactState(multipartContactId)).doNotContact).toBe(true);
    expect(await unsubscribeMethods(multipartContactId)).toEqual(['one_click']);
  });

  it('shows the already-unsubscribed page when the link is opened again', async () => {
    const res = await fetch(urlFor(tokenFor(contactId)));
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('You are already unsubscribed');
    expect(html).not.toContain('<form');
  });

  it('the confirmation button unsubscribes and answers with a page', async () => {
    const res = await fetch(urlFor(tokenFor(pageContactId)), {
      method: 'POST',
      headers: {
        accept: 'text/html,application/xhtml+xml',
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: '',
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/^text\/html/);
    expect(await res.text()).toContain('You are unsubscribed');
    expect((await contactState(pageContactId)).doNotContact).toBe(true);
    expect(await unsubscribeMethods(pageContactId)).toEqual(['page']);
  });

  it('reports a token for a contact that no longer exists without failing', async () => {
    const res = await fetch(urlFor(tokenFor('cct_gone')), {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'List-Unsubscribe=One-Click',
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, alreadyUnsubscribed: false, contactFound: false });
  });

  it('rejects a tampered token with 400 on both the page and the POST', async () => {
    const tampered = tokenFor(contactId).replace(contactId, 'cct_evil');
    const page = await fetch(urlFor(tampered));
    expect(page.status).toBe(400);
    expect(await page.text()).toContain('This link does not work');

    const post = await fetch(urlFor(tampered), {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'List-Unsubscribe=One-Click',
    });
    expect(post.status).toBe(400);
  });

  it('returns 400 when the token is missing', async () => {
    const page = await fetch(`${baseUrl}/v1/outreach/unsubscribe`);
    expect(page.status).toBe(400);
    const post = await fetch(`${baseUrl}/v1/outreach/unsubscribe`, { method: 'POST' });
    expect(post.status).toBe(400);
  });
});
