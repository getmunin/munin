import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import type { AddressInfo } from 'node:net';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { buildApiKey, hashSecret, keyPrefix, randomToken } from '@munin/core';
import { createDb, runMigrations, schema } from '@munin/db';
import { sql } from 'drizzle-orm';
import { AppModule } from '../../app.module.js';

const TEST_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const skipReason = TEST_URL
  ? null
  : 'Set DATABASE_URL or TEST_DATABASE_URL to a Postgres URL to run conv integration tests.';

(skipReason ? describe.skip : describe)('Conversations integration: end-user + admin flow', () => {
  let app: INestApplication;
  let baseUrl: string;
  let db: ReturnType<typeof createDb>;
  let orgId: string;
  let adminKey: string;
  let endUserToken: string;
  let otherEndUserToken: string;

  beforeAll(async () => {
    process.env.MUNIN_AUTH_SECRET ??= 'test-secret-do-not-use-in-prod';
    process.env.MUNIN_KEY_PEPPER ??= 'test-pepper';
    process.env.MUNIN_EMBEDDING_PROVIDER = 'stub';
    process.env.MUNIN_MAIL_PROVIDER = 'stub';

    await runMigrations(TEST_URL!);

    const appUrl = TEST_URL!.replace(/(postgres(?:ql)?:\/\/)[^:@]+:[^@]+@/, '$1munin_app:munin_app@');
    process.env.DATABASE_URL = appUrl;

    db = createDb(TEST_URL!, { serviceRole: true });
    await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);

    const ts = Date.now();
    const [org] = await db
      .insert(schema.orgs)
      .values({ name: 'Conv IT Org', slug: `conv-it-${ts}` })
      .returning();
    orgId = org!.id;

    adminKey = buildApiKey('admin');
    await db.insert(schema.apiKeys).values({
      orgId,
      type: 'admin',
      name: 'conv-it-admin',
      keyHash: hashSecret(adminKey),
      keyPrefix: keyPrefix(adminKey),
      scopes: ['*'],
    });

    const [eu1] = await db
      .insert(schema.endUsers)
      .values({ orgId, externalId: 'eu-1', name: 'Alice' })
      .returning();
    const [eu2] = await db
      .insert(schema.endUsers)
      .values({ orgId, externalId: 'eu-2', name: 'Bob' })
      .returning();

    endUserToken = randomToken(32);
    await db.insert(schema.tokens).values({
      orgId,
      type: 'delegated_end_user',
      tokenHash: hashSecret(endUserToken),
      scopes: ['conv:read', 'conv:write'],
      audiences: ['self_service'],
      endUserId: eu1!.id,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });
    otherEndUserToken = randomToken(32);
    await db.insert(schema.tokens).values({
      orgId,
      type: 'delegated_end_user',
      tokenHash: hashSecret(otherEndUserToken),
      scopes: ['conv:read', 'conv:write'],
      audiences: ['self_service'],
      endUserId: eu2!.id,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });

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

  async function withClient<T>(token: string, fn: (c: Client) => Promise<T>): Promise<T> {
    const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    });
    const c = new Client({ name: 'munin-it', version: '0.0.0' });
    await c.connect(transport);
    try {
      return await fn(c);
    } finally {
      await transport.close();
      await c.close();
    }
  }

  it('admin sets up channel; end-user starts a conversation; admin replies; end-user sees the reply', async () => {
    const channel = await withClient(adminKey, async (c) => {
      return parseToolResult<{ id: string }>(
        await c.callTool({
          name: 'conv_create_channel',
          arguments: { type: 'chat', name: 'Web chat' },
        }),
      );
    });

    const startedConv = await withClient(endUserToken, async (c) => {
      const { tools } = await c.listTools();
      const names = tools.map((t) => t.name);
      expect(names).toContain('conv_start_conversation');
      expect(names).toContain('conv_list_my_conversations');
      expect(names).not.toContain('conv_create_channel');
      expect(names).not.toContain('conv_change_status');

      return parseToolResult<{ id: string; displayId: number; messages: { body: string }[] }>(
        await c.callTool({
          name: 'conv_start_conversation',
          arguments: { body: 'Hi — my account is locked, can you help?' },
        }),
      );
    });

    expect(startedConv.displayId).toBeGreaterThan(0);
    expect(startedConv.messages).toHaveLength(1);
    expect(startedConv.messages[0]!.body).toMatch(/account is locked/);

    const adminReply = await withClient(adminKey, async (c) => {
      const list = parseToolResult<Array<{ id: string }>>(
        await c.callTool({ name: 'conv_list_conversations', arguments: {} }),
      );
      expect(list.find((row) => row.id === startedConv.id)).toBeTruthy();

      // Drop a private internal note (should NOT appear in end-user's view).
      await c.callTool({
        name: 'conv_send_message',
        arguments: {
          conversationId: startedConv.id,
          body: 'TODO: confirm caller via 2FA before unlocking.',
          internal: true,
        },
      });
      // Then a public reply (should appear).
      return parseToolResult<{ id: string; body: string; internal: boolean }>(
        await c.callTool({
          name: 'conv_send_message',
          arguments: {
            conversationId: startedConv.id,
            body: 'Hi Alice, I\'ve unlocked your account.',
          },
        }),
      );
    });
    expect(adminReply.internal).toBe(false);

    await withClient(endUserToken, async (c) => {
      const detail = parseToolResult<{ messages: { body: string; internal: boolean }[] }>(
        await c.callTool({
          name: 'conv_get_my_conversation',
          arguments: { id: startedConv.id },
        }),
      );
      const bodies = detail.messages.map((m) => m.body);
      expect(bodies).toContain('Hi Alice, I\'ve unlocked your account.');
      // Internal note is filtered by RLS — never visible to end-users.
      expect(bodies.find((b) => /2FA/.test(b))).toBeUndefined();
      expect(detail.messages.every((m) => m.internal === false)).toBe(true);
    });

    // Cross-end-user isolation: Bob can't see Alice's conversation.
    await withClient(otherEndUserToken, async (c) => {
      const list = parseToolResult<Array<{ id: string }>>(
        await c.callTool({ name: 'conv_list_my_conversations', arguments: {} }),
      );
      expect(list.find((row) => row.id === startedConv.id)).toBeFalsy();
    });

    void channel;
  }, 30_000);

  it('admin can change status to closed; subsequent listings respect the filter', async () => {
    await withClient(endUserToken, async (c) => {
      await c.callTool({
        name: 'conv_start_conversation',
        arguments: { body: 'How do I export my data?' },
      });
    });

    await withClient(adminKey, async (c) => {
      const list = parseToolResult<Array<{ id: string; status: string }>>(
        await c.callTool({
          name: 'conv_list_conversations',
          arguments: { status: 'open' },
        }),
      );
      const conv = list[0]!;

      await c.callTool({
        name: 'conv_change_status',
        arguments: { id: conv.id, status: 'closed' },
      });

      const stillOpen = parseToolResult<Array<{ id: string }>>(
        await c.callTool({
          name: 'conv_list_conversations',
          arguments: { status: 'open' },
        }),
      );
      expect(stillOpen.find((row) => row.id === conv.id)).toBeFalsy();

      const closed = parseToolResult<Array<{ id: string; status: string }>>(
        await c.callTool({
          name: 'conv_list_conversations',
          arguments: { status: 'closed' },
        }),
      );
      expect(closed.find((row) => row.id === conv.id && row.status === 'closed')).toBeTruthy();
    });
  }, 30_000);
});

function parseToolResult<T>(result: unknown): T {
  const r = result as { content?: Array<{ type: string; text?: string }> };
  const text = r.content?.[0]?.text ?? '';
  return JSON.parse(text) as T;
}
