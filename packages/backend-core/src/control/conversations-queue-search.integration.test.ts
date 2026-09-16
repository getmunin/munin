import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import type { AddressInfo } from 'node:net';
import { randomToken } from '@getmunin/core';
import { createDb, runMigrations, schema } from '@getmunin/db';
import { eq, sql } from 'drizzle-orm';
import { createApp } from '../bootstrap-app.ts';
import { AppModule } from '../app.module.ts';

const TEST_URL = process.env.TEST_DATABASE_URL;
const skipReason = TEST_URL
  ? null
  : 'Set TEST_DATABASE_URL to a Postgres URL to run conversation queue search tests.';

interface QueuePage {
  items: Array<{ id: string; displayId: number; subject: string | null; status: string }>;
  nextCursor: string | null;
}

(skipReason ? describe.skip : describe)('GET /v1/conversations/queue?q=', () => {
  let app: INestApplication;
  let baseUrl: string;
  let db: ReturnType<typeof createDb>;
  let orgId: string;
  let otherOrgId: string;
  let sessionToken: string;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    process.env.MUNIN_AUTH_SECRET ??= 'test-secret-do-not-use-in-prod';
    process.env.MUNIN_KEY_PEPPER ??= 'test-pepper';
    process.env.MUNIN_EMBEDDING_PROVIDER = 'stub';
    process.env.MUNIN_MAIL_PROVIDER = 'stub';
    process.env.MUNIN_WEBHOOK_WORKER_DISABLED = '1';
    process.env.MUNIN_CMS_SCHEDULE_WORKER_DISABLED = '1';
    process.env.MUNIN_STORAGE_PROVIDER = 'local';

    await runMigrations(TEST_URL!);

    const appUrl = TEST_URL!.replace(
      /(postgres(?:ql)?:\/\/)[^:@]+:[^@]+@/,
      '$1munin_app:munin_app@',
    );
    process.env.DATABASE_URL = appUrl;

    db = createDb(TEST_URL!, { serviceRole: true });
    await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);

    const label = `queue-search-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const [org] = await db.insert(schema.orgs).values({ name: `Org ${label}` }).returning();
    orgId = org!.id;
    const [otherOrg] = await db
      .insert(schema.orgs)
      .values({ name: `Org ${label} other` })
      .returning();
    otherOrgId = otherOrg!.id;

    const [user] = await db
      .insert(schema.users)
      .values({ email: `${label}@example.com`, name: 'Owner User' })
      .returning();
    await db
      .insert(schema.orgMembers)
      .values({ orgId, userId: user!.id, role: 'owner', isDefault: true });

    sessionToken = randomToken(32);
    await db.insert(schema.sessions).values({
      userId: user!.id,
      token: sessionToken,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });

    const [channel] = await db
      .insert(schema.convChannels)
      .values({ orgId, type: 'email', vendor: 'imap', name: `${label}-channel` })
      .returning();
    const [otherChannel] = await db
      .insert(schema.convChannels)
      .values({ orgId: otherOrgId, type: 'email', vendor: 'imap', name: `${label}-other` })
      .returning();

    const [contact] = await db
      .insert(schema.convContacts)
      .values({ orgId, name: 'Ola Nordmann', email: 'ola@example.com', phone: '+4712345678' })
      .returning();
    const [endUser] = await db
      .insert(schema.endUsers)
      .values({ orgId, externalId: `${label}-eu`, name: 'Kari Nordmann' })
      .returning();
    const [topic] = await db
      .insert(schema.convTopics)
      .values({ orgId, slug: 'document-requests', name: 'Document requests' })
      .returning();

    const seed = async (
      key: string,
      values: Partial<typeof schema.convConversations.$inferInsert>,
      body?: string,
    ) => {
      const [row] = await db
        .insert(schema.convConversations)
        .values({
          orgId,
          displayId: Object.keys(ids).length + 1,
          channelId: channel!.id,
          status: 'open',
          lastMessageAt: new Date(Date.now() - Object.keys(ids).length * 60_000),
          ...values,
        })
        .returning();
      ids[key] = row!.id;
      if (body) {
        await db.insert(schema.convMessages).values({
          orgId,
          conversationId: row!.id,
          authorType: 'end_user',
          authorId: 'seed',
          body,
        });
      }
    };

    await seed('subject', { subject: 'Payslip upload keeps failing' });
    await seed('contact', { subject: 'Nothing to see', contactId: contact!.id });
    await seed('endUser', { subject: 'Nothing to see', endUserId: endUser!.id });
    await seed('topic', { subject: 'Nothing to see', topicId: topic!.id });
    await seed('body', { subject: 'Nothing to see' }, 'The invoice mentions a refinancing fee');
    await seed('closed', { subject: 'Payslip archive', status: 'closed' });
    await seed('wildcard', { subject: '100% of the fee was refunded' });
    await seed(
      'internalOnly',
      { subject: 'Nothing to see' },
    );
    await db.insert(schema.convMessages).values({
      orgId,
      conversationId: ids['internalOnly']!,
      authorType: 'user',
      authorId: 'seed',
      internal: true,
      body: 'Private note about escrow',
    });

    await db.insert(schema.convConversations).values({
      orgId: otherOrgId,
      displayId: 1,
      channelId: otherChannel!.id,
      status: 'open',
      subject: 'Payslip upload keeps failing',
      lastMessageAt: new Date(),
    });

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
      await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
      if (orgId) await db.delete(schema.orgs).where(eq(schema.orgs.id, orgId));
      if (otherOrgId) await db.delete(schema.orgs).where(eq(schema.orgs.id, otherOrgId));
    }
  });

  async function search(term: string, extra = ''): Promise<string[]> {
    const res = await fetch(
      `${baseUrl}/v1/conversations/queue?q=${encodeURIComponent(term)}${extra}`,
      { headers: { Cookie: `better-auth.session_token=${sessionToken}.placeholder-sig` } },
    );
    expect(res.status).toBe(200);
    const page = (await res.json()) as QueuePage;
    return page.items.map((i) => i.id);
  }

  it('matches the subject case-insensitively', async () => {
    expect(await search('PAYSLIP UPLOAD')).toContain(ids['subject']);
  });

  it('matches the customer behind the conversation, contact or end user', async () => {
    expect(await search('ola@example')).toEqual([ids['contact']]);
    expect(await search('12345678')).toEqual([ids['contact']]);
    expect(await search('kari nord')).toEqual([ids['endUser']]);
  });

  it('matches the topic name', async () => {
    expect(await search('document req')).toEqual([ids['topic']]);
  });

  it('matches a phrase inside a message body, not just the loaded row preview', async () => {
    expect(await search('refinancing fee')).toEqual([ids['body']]);
  });

  it('leaves internal notes out of the match', async () => {
    expect(await search('escrow')).toEqual([]);
  });

  it('reaches closed conversations, and honours a status filter when one is set', async () => {
    const all = await search('payslip');
    expect(all).toContain(ids['subject']);
    expect(all).toContain(ids['closed']);
    expect(await search('payslip', '&status=closed')).toEqual([ids['closed']]);
  });

  it('matches the conversation number, with or without the hash', async () => {
    expect(await search('#1')).toContain(ids['subject']);
    expect(await search('1')).toContain(ids['subject']);
  });

  it('treats a LIKE wildcard as literal text', async () => {
    expect(await search('100%')).toEqual([ids['wildcard']]);
    expect(await search('%')).toEqual([ids['wildcard']]);
  });

  it('never reaches another org', async () => {
    const all = await search('payslip');
    expect(all).toHaveLength(2);
  });

  it('rejects a search term past the length cap', async () => {
    const res = await fetch(`${baseUrl}/v1/conversations/queue?q=${'a'.repeat(201)}`, {
      headers: { Cookie: `better-auth.session_token=${sessionToken}.placeholder-sig` },
    });
    expect(res.status).toBe(400);
  });
});
