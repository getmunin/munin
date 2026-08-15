import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import type { AddressInfo } from 'node:net';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { buildApiKey, hashSecret, keyPrefix } from '@getmunin/core';
import { createDb, runMigrations, schema } from '@getmunin/db';
import { sql } from 'drizzle-orm';
import { AppModule } from '../../app.module.ts';

const TEST_URL = process.env.TEST_DATABASE_URL;
const skipReason = TEST_URL
  ? null
  : 'Set TEST_DATABASE_URL to run conv email-open integration tests.';

interface OpenStats {
  since: string;
  sinceDays: number;
  channels: Array<{
    channelId: string;
    channelName: string;
    trackOpens: boolean;
    sent: number;
    opened: number;
    totalOpens: number;
    openRate: number | null;
  }>;
  totals: { sent: number; opened: number; totalOpens: number; openRate: number | null };
}

interface ConversationDetail {
  messages: Array<{
    id: string;
    body: string;
    seenAt: string | null;
    firstOpenedAt: string | null;
    lastOpenedAt: string | null;
    openCount: number | null;
  }>;
}

(skipReason ? describe.skip : describe)('conv email open tracking', () => {
  let app: INestApplication;
  let baseUrl: string;
  let db: ReturnType<typeof createDb>;
  let orgId: string;
  let adminKey: string;
  let trackedChannelId: string;
  let untrackedChannelId: string;
  let chatChannelId: string;
  let conversationId: string;
  let displayCounter = 0;

  beforeAll(async () => {
    process.env.MUNIN_AUTH_SECRET ??= 'test-secret-do-not-use-in-prod';
    process.env.MUNIN_KEY_PEPPER ??= 'test-pepper';
    process.env.MUNIN_EMBEDDING_PROVIDER = 'stub';
    process.env.MUNIN_MAIL_PROVIDER = 'stub';
    process.env.MUNIN_WEBHOOK_WORKER_DISABLED = '1';
    process.env.MUNIN_BUILTIN_AGENT = '0';
    process.env.MUNIN_INBOUND_POLL_WORKER_DISABLED = '1';

    await runMigrations(TEST_URL!);

    const appUrl = TEST_URL!.replace(/(postgres(?:ql)?:\/\/)[^:@]+:[^@]+@/, '$1munin_app:munin_app@');
    process.env.DATABASE_URL = appUrl;

    db = createDb(TEST_URL!, { serviceRole: true });
    await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);

    const [org] = await db.insert(schema.orgs).values({ name: 'Email Opens Org' }).returning();
    orgId = org!.id;

    adminKey = buildApiKey('admin');
    await db.insert(schema.apiKeys).values({
      orgId,
      type: 'admin',
      name: 'opens-admin',
      keyHash: hashSecret(adminKey),
      keyPrefix: keyPrefix(adminKey),
      scopes: ['*'],
    });

    const [tracked] = await db
      .insert(schema.convChannels)
      .values({
        orgId,
        type: 'email',
        vendor: 'smtp',
        name: 'A Tracked',
        config: { outbound: { provider: 'mailer', trackOpens: true } },
      })
      .returning();
    trackedChannelId = tracked!.id;

    const [untracked] = await db
      .insert(schema.convChannels)
      .values({
        orgId,
        type: 'email',
        vendor: 'smtp',
        name: 'B Untracked',
        config: { outbound: { provider: 'mailer' } },
      })
      .returning();
    untrackedChannelId = untracked!.id;

    const [chat] = await db
      .insert(schema.convChannels)
      .values({
        orgId,
        type: 'chat',
        vendor: 'munin',
        name: 'Widget',
        config: { provider: 'widget', originAllowlist: [] },
      })
      .returning();
    chatChannelId = chat!.id;

    app = await NestFactory.create(AppModule, { logger: false });
    await app.listen(0, '127.0.0.1');
    const server = app.getHttpServer() as { address(): AddressInfo | string | null };
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('expected AddressInfo');
    baseUrl = `http://127.0.0.1:${address.port}`;

    conversationId = await mkConversation(trackedChannelId);

    await mkDelivery({
      channelId: trackedChannelId,
      conversationId,
      body: 'opened twice',
      sentDaysAgo: 1,
      firstOpenedAt: new Date(Date.now() - 20 * 60 * 60 * 1000),
      lastOpenedAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
      openCount: 2,
    });
    await mkDelivery({
      channelId: trackedChannelId,
      conversationId,
      body: 'never opened',
      sentDaysAgo: 2,
    });
    await mkDelivery({
      channelId: trackedChannelId,
      conversationId,
      body: 'outside the window',
      sentDaysAgo: 90,
      firstOpenedAt: new Date(),
      lastOpenedAt: new Date(),
      openCount: 5,
    });
    await mkDelivery({
      channelId: trackedChannelId,
      conversationId,
      body: 'still queued',
      status: 'queued',
    });
    await mkDelivery({
      channelId: untrackedChannelId,
      conversationId,
      body: 'sent without a pixel',
      sentDaysAgo: 1,
    });
  });

  afterAll(async () => {
    await app?.close();
    if (db) {
      await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
      await db.delete(schema.orgs).where(sql`id = ${orgId}`);
    }
  });

  async function mkConversation(channelId: string): Promise<string> {
    displayCounter += 1;
    const [conv] = await db
      .insert(schema.convConversations)
      .values({
        orgId,
        channelId,
        displayId: displayCounter,
        status: 'open',
        lastMessageAt: new Date(),
      })
      .returning();
    return conv!.id;
  }

  async function mkMessage(conversationId: string, body: string): Promise<string> {
    const [msg] = await db
      .insert(schema.convMessages)
      .values({ orgId, conversationId, authorType: 'agent', authorId: 'agent', body })
      .returning();
    return msg!.id;
  }

  async function mkDelivery(opts: {
    channelId: string;
    conversationId: string;
    body: string;
    status?: string;
    sentDaysAgo?: number;
    firstOpenedAt?: Date;
    lastOpenedAt?: Date;
    openCount?: number;
  }): Promise<string> {
    const messageId = await mkMessage(opts.conversationId, opts.body);
    await db.insert(schema.convMessageDeliveries).values({
      orgId,
      messageId,
      channelId: opts.channelId,
      status: opts.status ?? 'sent',
      sentAt:
        opts.sentDaysAgo === undefined
          ? null
          : new Date(Date.now() - opts.sentDaysAgo * 24 * 60 * 60 * 1000),
      firstOpenedAt: opts.firstOpenedAt ?? null,
      lastOpenedAt: opts.lastOpenedAt ?? null,
      openCount: opts.openCount ?? 0,
    });
    return messageId;
  }

  async function withClient<T>(token: string, fn: (c: Client) => Promise<T>): Promise<T> {
    const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    });
    const c = new Client({ name: 'munin-opens-it', version: '0.0.0' });
    await c.connect(transport);
    try {
      return await fn(c);
    } finally {
      await transport.close();
      await c.close();
    }
  }

  async function stats(args: Record<string, unknown> = {}): Promise<OpenStats> {
    return withClient(adminKey, async (c) =>
      parseToolResult<OpenStats>(
        await c.callTool({ name: 'conv_get_email_open_stats', arguments: args }),
      ),
    );
  }

  it('counts opened deliveries and totals opens per email channel', async () => {
    const result = await stats({ sinceDays: 30 });
    const tracked = result.channels.find((ch) => ch.channelId === trackedChannelId);
    expect(tracked).toMatchObject({
      trackOpens: true,
      sent: 2,
      opened: 1,
      totalOpens: 2,
      openRate: 0.5,
    });
  });

  it('excludes deliveries sent before the window and deliveries that never left', async () => {
    const narrow = await stats({ sinceDays: 30 });
    const wide = await stats({ sinceDays: 365 });
    expect(narrow.channels.find((c) => c.channelId === trackedChannelId)?.sent).toBe(2);
    expect(wide.channels.find((c) => c.channelId === trackedChannelId)?.sent).toBe(3);
    expect(wide.channels.find((c) => c.channelId === trackedChannelId)?.totalOpens).toBe(7);
  });

  it('reports trackOpens false for a channel that embeds no pixel', async () => {
    const result = await stats({ sinceDays: 30 });
    const untracked = result.channels.find((c) => c.channelId === untrackedChannelId);
    expect(untracked).toMatchObject({ trackOpens: false, sent: 1, opened: 0, openRate: 0 });
  });

  it('omits non-email channels entirely', async () => {
    const result = await stats({ sinceDays: 30 });
    expect(result.channels.map((c) => c.channelId)).not.toContain(chatChannelId);
  });

  it('sums totals across email channels', async () => {
    const result = await stats({ sinceDays: 30 });
    expect(result.totals).toMatchObject({ sent: 3, opened: 1, totalOpens: 2 });
  });

  it('scopes to one channel when channelId is given', async () => {
    const result = await stats({ sinceDays: 30, channelId: trackedChannelId });
    expect(result.channels).toHaveLength(1);
    expect(result.channels[0]!.channelId).toBe(trackedChannelId);
  });

  it('rejects a non-email channel id without a 500', async () => {
    const result = await withClient(adminKey, async (c) =>
      c.callTool({ name: 'conv_get_email_open_stats', arguments: { channelId: chatChannelId } }),
    );
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain('conv_invalid');
  });

  it('rejects an unknown channel id without a 500', async () => {
    const result = await withClient(adminKey, async (c) =>
      c.callTool({ name: 'conv_get_email_open_stats', arguments: { channelId: 'chn_missing' } }),
    );
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain('conv_not_found');
  });

  it('returns a null open rate for a channel that sent nothing in the window', async () => {
    const result = await stats({ sinceDays: 1, channelId: untrackedChannelId });
    expect(result.channels[0]).toMatchObject({ sent: 0, opened: 0, openRate: null });
  });

  it('exposes per-message open fields on conv_get_conversation', async () => {
    const detail = await withClient(adminKey, async (c) =>
      parseToolResult<ConversationDetail>(
        await c.callTool({ name: 'conv_get_conversation', arguments: { id: conversationId } }),
      ),
    );
    const opened = detail.messages.find((m) => m.body === 'opened twice');
    expect(opened).toMatchObject({ openCount: 2 });
    expect(opened!.firstOpenedAt).not.toBeNull();
    expect(opened!.lastOpenedAt).not.toBeNull();

    const unopened = detail.messages.find((m) => m.body === 'never opened');
    expect(unopened).toMatchObject({ openCount: 0, firstOpenedAt: null, lastOpenedAt: null });
  });

  it('leaves openCount null on a message that has no delivery row', async () => {
    const convId = await mkConversation(chatChannelId);
    await mkMessage(convId, 'widget reply');
    const detail = await withClient(adminKey, async (c) =>
      parseToolResult<ConversationDetail>(
        await c.callTool({ name: 'conv_get_conversation', arguments: { id: convId } }),
      ),
    );
    expect(detail.messages[0]).toMatchObject({
      openCount: null,
      firstOpenedAt: null,
      lastOpenedAt: null,
    });
  });
});

function parseToolResult<T>(result: unknown): T {
  const r = result as { content?: Array<{ type: string; text?: string }> };
  const text = r.content?.[0]?.text ?? '';
  return JSON.parse(text) as T;
}
