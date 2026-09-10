import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import type { AddressInfo } from 'node:net';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { buildApiKey, hashSecret, keyPrefix } from '@getmunin/core';
import { createDb, runMigrations, schema } from '@getmunin/db';
import { eq, sql } from 'drizzle-orm';
import { AppModule } from '../../app.module.ts';

const TEST_URL = process.env.TEST_DATABASE_URL;
const skipReason = TEST_URL
  ? null
  : 'Set TEST_DATABASE_URL to run conv delivery-retry integration tests.';

interface MessageView {
  id: string;
  body: string;
  deliveryStatus: string | null;
  deliveryError: string | null;
  deliveryAttempts: number | null;
  deliveryNextAttemptAt: string | null;
}

interface ConversationDetail {
  messages: MessageView[];
}

interface ToolCallResult {
  isError?: boolean;
  content?: Array<{ type: string; text?: string }>;
}

(skipReason ? describe.skip : describe)('conv delivery status + retry', () => {
  let app: INestApplication;
  let baseUrl: string;
  let db: ReturnType<typeof createDb>;
  let orgId: string;
  let adminKey: string;
  let channelId: string;
  let archivedChannelId: string;
  let conversationId: string;
  let endUserId: string;
  let endUserToken: string;
  let displayCounter = 0;

  beforeAll(async () => {
    process.env.MUNIN_AUTH_SECRET ??= 'test-secret-do-not-use-in-prod';
    process.env.MUNIN_KEY_PEPPER ??= 'test-pepper';
    process.env.MUNIN_EMBEDDING_PROVIDER = 'stub';
    process.env.MUNIN_MAIL_PROVIDER = 'stub';
    process.env.MUNIN_WEBHOOK_WORKER_DISABLED = '1';
    process.env.MUNIN_BUILTIN_AGENT = '0';
    process.env.MUNIN_INBOUND_POLL_WORKER_DISABLED = '1';
    process.env.MUNIN_OUTBOUND_DELIVERY_WORKER_DISABLED = '1';

    await runMigrations(TEST_URL!);

    const appUrl = TEST_URL!.replace(/(postgres(?:ql)?:\/\/)[^:@]+:[^@]+@/, '$1munin_app:munin_app@');
    process.env.DATABASE_URL = appUrl;

    db = createDb(TEST_URL!, { serviceRole: true });
    await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);

    const [org] = await db.insert(schema.orgs).values({ name: 'Delivery Retry Org' }).returning();
    orgId = org!.id;

    adminKey = buildApiKey('admin');
    await db.insert(schema.apiKeys).values({
      orgId,
      type: 'admin',
      name: 'retry-admin',
      keyHash: hashSecret(adminKey),
      keyPrefix: keyPrefix(adminKey),
      scopes: ['*'],
    });

    const [channel] = await db
      .insert(schema.convChannels)
      .values({
        orgId,
        type: 'email',
        vendor: 'smtp',
        name: 'Support',
        config: { outbound: { provider: 'mailer' } },
      })
      .returning();
    channelId = channel!.id;

    const [archived] = await db
      .insert(schema.convChannels)
      .values({
        orgId,
        type: 'email',
        vendor: 'smtp',
        name: 'Retired',
        config: { outbound: { provider: 'mailer' } },
        active: false,
      })
      .returning();
    archivedChannelId = archived!.id;

    const [endUser] = await db
      .insert(schema.endUsers)
      .values({ orgId, externalId: 'eu-retry-1', name: 'Alice' })
      .returning();
    endUserId = endUser!.id;

    endUserToken = buildApiKey('dlg');
    await db.insert(schema.tokens).values({
      orgId,
      type: 'delegated_end_user',
      tokenHash: hashSecret(endUserToken),
      scopes: ['conv:read', 'conv:write'],
      audiences: ['self_service'],
      endUserId,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });

    app = await NestFactory.create(AppModule, { logger: false });
    await app.listen(0, '127.0.0.1');
    const server = app.getHttpServer() as { address(): AddressInfo | string | null };
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('expected AddressInfo');
    baseUrl = `http://127.0.0.1:${address.port}`;

    conversationId = await mkConversation(channelId);
  });

  afterAll(async () => {
    await app?.close();
    if (db) {
      await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
      await db.delete(schema.orgs).where(sql`id = ${orgId}`);
    }
  });

  async function mkConversation(forChannelId: string, ownerEndUserId?: string): Promise<string> {
    displayCounter += 1;
    const [conv] = await db
      .insert(schema.convConversations)
      .values({
        orgId,
        channelId: forChannelId,
        displayId: displayCounter,
        status: 'open',
        lastMessageAt: new Date(),
        ...(ownerEndUserId ? { endUserId: ownerEndUserId } : {}),
      })
      .returning();
    return conv!.id;
  }

  async function mkDelivery(opts: {
    body: string;
    status: string;
    channelId?: string;
    conversationId?: string;
    error?: string | null;
    attempt?: number;
    nextAttemptAt?: Date | null;
    internal?: boolean;
  }): Promise<string> {
    const [msg] = await db
      .insert(schema.convMessages)
      .values({
        orgId,
        conversationId: opts.conversationId ?? conversationId,
        authorType: 'agent',
        authorId: 'agent',
        body: opts.body,
        internal: opts.internal ?? false,
      })
      .returning();
    await db.insert(schema.convMessageDeliveries).values({
      orgId,
      messageId: msg!.id,
      channelId: opts.channelId ?? channelId,
      status: opts.status,
      attempt: opts.attempt ?? 0,
      error: opts.error ?? null,
      nextAttemptAt: opts.nextAttemptAt ?? null,
    });
    return msg!.id;
  }

  async function withClient<T>(token: string, fn: (c: Client) => Promise<T>): Promise<T> {
    const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    });
    const c = new Client({ name: 'munin-retry-it', version: '0.0.0' });
    await c.connect(transport);
    try {
      return await fn(c);
    } finally {
      await transport.close();
      await c.close();
    }
  }

  async function messagesOf(convId: string): Promise<MessageView[]> {
    const detail = await withClient(adminKey, async (c) =>
      parseToolResult<ConversationDetail>(
        await c.callTool({ name: 'conv_get_conversation', arguments: { id: convId } }),
      ),
    );
    return detail.messages;
  }

  async function retry(messageId: string): Promise<ToolCallResult> {
    return withClient(adminKey, async (c) =>
      (await c.callTool({
        name: 'conv_retry_delivery',
        arguments: { messageId },
      })) as ToolCallResult,
    );
  }

  it('reports the failure and the provider error on an undelivered message', async () => {
    const convId = await mkConversation(channelId);
    const deadId = await mkDelivery({
      conversationId: convId,
      body: 'never arrived',
      status: 'dead',
      error: '535 5.7.8 Authentication credentials invalid',
      attempt: 5,
    });

    const message = (await messagesOf(convId)).find((m) => m.id === deadId);
    expect(message).toMatchObject({
      deliveryStatus: 'dead',
      deliveryError: '535 5.7.8 Authentication credentials invalid',
      deliveryAttempts: 5,
    });
  });

  it('leaves deliveryStatus null on a message that was never queued for delivery', async () => {
    const convId = await mkConversation(channelId);
    const [msg] = await db
      .insert(schema.convMessages)
      .values({
        orgId,
        conversationId: convId,
        authorType: 'agent',
        authorId: 'agent',
        body: 'internal only',
      })
      .returning();

    const message = (await messagesOf(convId)).find((m) => m.id === msg!.id);
    expect(message).toMatchObject({
      deliveryStatus: null,
      deliveryError: null,
      deliveryAttempts: null,
    });
  });

  it('keeps a rate-limit deferral queued rather than reporting it as a failure', async () => {
    const convId = await mkConversation(channelId);
    const deferredId = await mkDelivery({
      conversationId: convId,
      body: 'waiting on the hourly cap',
      status: 'queued',
      error: 'rate_limited: hourly cap reached',
      nextAttemptAt: new Date(Date.now() + 60_000),
    });

    const message = (await messagesOf(convId)).find((m) => m.id === deferredId);
    expect(message?.deliveryStatus).toBe('queued');
    expect(message?.deliveryError).toBe('rate_limited: hourly cap reached');
  });

  it('surfaces the worst delivery when a message fanned out to more than one', async () => {
    const convId = await mkConversation(channelId);
    const messageId = await mkDelivery({
      conversationId: convId,
      body: 'two deliveries',
      status: 'sent',
    });
    await db.insert(schema.convMessageDeliveries).values({
      orgId,
      messageId,
      channelId,
      status: 'dead',
      attempt: 5,
      error: 'connection refused',
    });

    const message = (await messagesOf(convId)).find((m) => m.id === messageId);
    expect(message).toMatchObject({ deliveryStatus: 'dead', deliveryError: 'connection refused' });
  });

  it('re-queues a dead delivery with a fresh attempt budget and no stale error', async () => {
    const convId = await mkConversation(channelId);
    const messageId = await mkDelivery({
      conversationId: convId,
      body: 'retry me',
      status: 'dead',
      error: 'connection timed out',
      attempt: 5,
    });

    const result = await retry(messageId);
    expect(result.isError).toBeFalsy();
    expect(parseToolResult<{ retried: boolean }>(result).retried).toBe(true);

    const rows = await db
      .select()
      .from(schema.convMessageDeliveries)
      .where(eq(schema.convMessageDeliveries.messageId, messageId));
    expect(rows[0]).toMatchObject({ status: 'queued', attempt: 0, error: null });
    expect(rows[0]!.nextAttemptAt).not.toBeNull();

    const message = (await messagesOf(convId)).find((m) => m.id === messageId);
    expect(message?.deliveryStatus).toBe('queued');
  });

  it('refuses to retry a delivery that is not dead instead of resetting a live one', async () => {
    const convId = await mkConversation(channelId);
    const messageId = await mkDelivery({
      conversationId: convId,
      body: 'still retrying on its own',
      status: 'failed',
      error: 'temporary failure',
      attempt: 2,
      nextAttemptAt: new Date(Date.now() + 120_000),
    });

    const result = await retry(messageId);
    expect(result.isError).toBe(true);
    expect(result.content?.[0]?.text ?? '').toContain('conv_conflict');

    const rows = await db
      .select()
      .from(schema.convMessageDeliveries)
      .where(eq(schema.convMessageDeliveries.messageId, messageId));
    expect(rows[0]).toMatchObject({ status: 'failed', attempt: 2 });
  });

  it('refuses to retry onto a channel that has been switched off', async () => {
    const convId = await mkConversation(archivedChannelId);
    const messageId = await mkDelivery({
      conversationId: convId,
      channelId: archivedChannelId,
      body: 'channel is off',
      status: 'dead',
      error: 'connection refused',
      attempt: 5,
    });

    const result = await retry(messageId);
    expect(result.isError).toBe(true);
    expect(result.content?.[0]?.text ?? '').toContain('conv_conflict');

    const rows = await db
      .select()
      .from(schema.convMessageDeliveries)
      .where(eq(schema.convMessageDeliveries.messageId, messageId));
    expect(rows[0]!.status).toBe('dead');
  });

  it('hides delivery internals from the end-user audience, which RLS never shows a delivery row', async () => {
    const convId = await mkConversation(channelId, endUserId);
    const messageId = await mkDelivery({
      conversationId: convId,
      body: 'the customer must not read our smtp error',
      status: 'dead',
      error: '535 5.7.8 Authentication credentials invalid for smtp.internal.acme',
      attempt: 5,
    });

    const res = await fetch(`${baseUrl}/v1/end-users/me/conversations/${convId}`, {
      headers: { Authorization: `Bearer ${endUserToken}` },
    });
    expect(res.status).toBe(200);
    const detail = (await res.json()) as ConversationDetail;
    const message = detail.messages.find((m) => m.id === messageId);
    expect(message).toBeDefined();
    expect(message).toMatchObject({
      deliveryStatus: null,
      deliveryError: null,
      deliveryAttempts: null,
    });

    const asAdmin = (await messagesOf(convId)).find((m) => m.id === messageId);
    expect(asAdmin?.deliveryStatus).toBe('dead');
  });

  it('reports a missing delivery rather than a generic failure', async () => {
    const convId = await mkConversation(channelId);
    const [msg] = await db
      .insert(schema.convMessages)
      .values({
        orgId,
        conversationId: convId,
        authorType: 'agent',
        authorId: 'agent',
        body: 'no delivery row',
      })
      .returning();

    const result = await retry(msg!.id);
    expect(result.isError).toBe(true);
    expect(result.content?.[0]?.text ?? '').toContain('conv_not_found');
  });
});

function parseToolResult<T>(result: unknown): T {
  const r = result as { content?: Array<{ type: string; text?: string }> };
  const text = r.content?.[0]?.text ?? '';
  return JSON.parse(text) as T;
}
