import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import type { AddressInfo } from 'node:net';
import { buildApiKey, hashSecret, keyPrefix } from '@getmunin/core';
import { createDb, runMigrations, schema } from '@getmunin/db';
import { sql } from 'drizzle-orm';
import { AppModule } from '../../app.module.ts';

const TEST_URL = process.env.TEST_DATABASE_URL;
const skipReason = TEST_URL
  ? null
  : 'Set TEST_DATABASE_URL to run conv awaiting-reply integration tests.';

(skipReason ? describe.skip : describe)('conv awaiting-reply sweep selection', () => {
  let app: INestApplication;
  let baseUrl: string;
  let db: ReturnType<typeof createDb>;
  let orgId: string;
  let adminKey: string;
  let chatChannelId: string;
  let voiceChannelId: string;
  let euId: string;
  let contactId: string;
  let staffUserId: string;
  let displayCounter = 0;

  beforeAll(async () => {
    process.env.MUNIN_AUTH_SECRET ??= 'test-secret-do-not-use-in-prod';
    process.env.MUNIN_KEY_PEPPER ??= 'test-pepper';
    process.env.MUNIN_EMBEDDING_PROVIDER = 'stub';
    process.env.MUNIN_MAIL_PROVIDER = 'stub';
    process.env.MUNIN_WEBHOOK_WORKER_DISABLED = '1';
    process.env.MUNIN_BUILTIN_AGENT = '0';

    await runMigrations(TEST_URL!);

    const appUrl = TEST_URL!.replace(/(postgres(?:ql)?:\/\/)[^:@]+:[^@]+@/, '$1munin_app:munin_app@');
    process.env.DATABASE_URL = appUrl;

    db = createDb(TEST_URL!, { serviceRole: true });
    await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);

    const [org] = await db
      .insert(schema.orgs)
      .values({ name: 'Awaiting Reply Org' })
      .returning();
    orgId = org!.id;

    adminKey = buildApiKey('admin');
    await db.insert(schema.apiKeys).values({
      orgId,
      type: 'admin',
      name: 'ar-admin',
      keyHash: hashSecret(adminKey),
      keyPrefix: keyPrefix(adminKey),
      scopes: ['*'],
    });

    const [chat] = await db
      .insert(schema.convChannels)
      .values({
        orgId,
        type: 'chat',
        vendor: 'munin',
        name: 'ar-chat',
        config: { provider: 'widget', originAllowlist: [] },
      })
      .returning();
    chatChannelId = chat!.id;

    const [voice] = await db
      .insert(schema.convChannels)
      .values({ orgId, type: 'voice', vendor: 'vapi', name: 'ar-voice', config: {} })
      .returning();
    voiceChannelId = voice!.id;

    const [eu] = await db
      .insert(schema.endUsers)
      .values({ orgId, externalId: 'ar-eu', name: 'EU' })
      .returning();
    euId = eu!.id;

    const [contact] = await db
      .insert(schema.convContacts)
      .values({ orgId, endUserId: euId, name: 'EU' })
      .returning();
    contactId = contact!.id;

    const [staff] = await db
      .insert(schema.users)
      .values({ email: `ar-staff-${Date.now()}@example.com`, name: 'Staff' })
      .returning();
    staffUserId = staff!.id;

    app = await NestFactory.create(AppModule, { logger: false });
    await app.listen(0, '127.0.0.1');
    const server = app.getHttpServer() as { address(): AddressInfo | string | null };
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('expected AddressInfo');
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await app?.close();
    if (db) {
      await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
      await db.delete(schema.orgs).where(sql`id = ${orgId}`);
      await db.delete(schema.users).where(sql`id = ${staffUserId}`);
    }
  });

  async function mkConv(opts: {
    channelId?: string;
    status?: 'open' | 'snoozed' | 'closed' | 'spam';
    agentMode?: 'auto' | 'draft_only' | 'off';
    assigneeUserId?: string | null;
    endUserId?: string | null;
    lastMessageAt?: Date;
    messages: Array<{
      authorType: 'user' | 'agent' | 'end_user' | 'system';
      internal?: boolean;
      offsetMs: number;
    }>;
  }): Promise<string> {
    displayCounter += 1;
    const base = Date.now();
    const [conv] = await db
      .insert(schema.convConversations)
      .values({
        orgId,
        channelId: opts.channelId ?? chatChannelId,
        endUserId: opts.endUserId === undefined ? euId : opts.endUserId,
        contactId,
        displayId: displayCounter,
        status: opts.status ?? 'open',
        agentMode: opts.agentMode ?? 'auto',
        assigneeUserId: opts.assigneeUserId ?? null,
        lastMessageAt: opts.lastMessageAt ?? new Date(),
      })
      .returning();
    for (const m of opts.messages) {
      await db.insert(schema.convMessages).values({
        orgId,
        conversationId: conv!.id,
        authorType: m.authorType,
        authorId: 'author',
        body: 'x',
        internal: m.internal ?? false,
        createdAt: new Date(base + m.offsetMs),
      });
    }
    return conv!.id;
  }

  async function awaitingIds(query = ''): Promise<string[]> {
    const res = await fetch(`${baseUrl}/v1/conversations/awaiting-reply${query}`, {
      headers: { authorization: `Bearer ${adminKey}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: Array<{ id: string }> };
    return body.items.map((i) => i.id);
  }

  it('includes a conversation whose latest message is from the visitor', async () => {
    const id = await mkConv({ messages: [{ authorType: 'end_user', offsetMs: 0 }] });
    expect(await awaitingIds()).toContain(id);
  });

  it('excludes a conversation the agent already answered', async () => {
    const id = await mkConv({
      messages: [
        { authorType: 'end_user', offsetMs: 0 },
        { authorType: 'agent', offsetMs: 1000 },
      ],
    });
    expect(await awaitingIds()).not.toContain(id);
  });

  it('treats an internal agent note as not answering the visitor', async () => {
    const id = await mkConv({
      messages: [
        { authorType: 'end_user', offsetMs: 0 },
        { authorType: 'agent', internal: true, offsetMs: 1000 },
      ],
    });
    expect(await awaitingIds()).toContain(id);
  });

  it('excludes conversations assigned to staff', async () => {
    const id = await mkConv({
      assigneeUserId: staffUserId,
      messages: [{ authorType: 'end_user', offsetMs: 0 }],
    });
    expect(await awaitingIds()).not.toContain(id);
  });

  it('excludes non-auto agent modes', async () => {
    const id = await mkConv({
      agentMode: 'draft_only',
      messages: [{ authorType: 'end_user', offsetMs: 0 }],
    });
    expect(await awaitingIds()).not.toContain(id);
  });

  it('excludes voice conversations', async () => {
    const id = await mkConv({
      channelId: voiceChannelId,
      messages: [{ authorType: 'end_user', offsetMs: 0 }],
    });
    expect(await awaitingIds()).not.toContain(id);
  });

  it('excludes conversations that are not open', async () => {
    const id = await mkConv({
      status: 'snoozed',
      messages: [{ authorType: 'end_user', offsetMs: 0 }],
    });
    expect(await awaitingIds()).not.toContain(id);
  });

  it('respects the lookback window', async () => {
    const id = await mkConv({
      lastMessageAt: new Date(Date.now() - 3 * 60 * 60 * 1000),
      messages: [{ authorType: 'end_user', offsetMs: 0 }],
    });
    expect(await awaitingIds()).not.toContain(id);
    expect(await awaitingIds('?lookbackMinutes=300')).toContain(id);
  });
});
