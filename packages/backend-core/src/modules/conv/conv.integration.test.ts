import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import type { AddressInfo } from 'node:net';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { buildApiKey, hashSecret, keyPrefix } from '@getmunin/core';
import { createDb, runMigrations, schema } from '@getmunin/db';
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
      .values({ name: 'Conv IT Org' })
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

    endUserToken = buildApiKey('dlg');
    await db.insert(schema.tokens).values({
      orgId,
      type: 'delegated_end_user',
      tokenHash: hashSecret(endUserToken),
      scopes: ['conv:read', 'conv:write'],
      audiences: ['self_service'],
      endUserId: eu1!.id,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });
    otherEndUserToken = buildApiKey('dlg');
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

  async function rest<T>(
    token: string,
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
  ): Promise<{ status: number; body: T }> {
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    const parsed = text ? (JSON.parse(text) as T) : (undefined as unknown as T);
    return { status: res.status, body: parsed };
  }

  it('admin sets up channel; end-user starts a conversation via REST; admin replies; end-user sees the reply', async () => {
    const channel = await withClient(adminKey, async (c) => {
      return parseToolResult<{ id: string }>(
        await c.callTool({
          name: 'conv_create_channel',
          arguments: { type: 'chat', vendor: 'munin', name: 'Web chat' },
        }),
      );
    });

    await withClient(endUserToken, async (c) => {
      const { tools } = await c.listTools();
      const names = tools.map((t) => t.name);
      expect(names).toContain('conv_request_handover_in_my_conversation');
      expect(names).not.toContain('conv_start_conversation');
      expect(names).not.toContain('conv_list_my_conversations');
      expect(names).not.toContain('conv_get_my_conversation');
      expect(names).not.toContain('conv_send_message_in_my_conversation');
      expect(names).not.toContain('conv_create_channel');
      expect(names).not.toContain('conv_change_status');
    });

    const startResp = await rest<{ id: string; displayId: number; messages: { body: string }[] }>(
      endUserToken,
      'POST',
      '/api/v1/end-users/me/conversations',
      { body: 'Hi — my account is locked, can you help?' },
    );
    expect(startResp.status).toBe(201);
    const startedConv = startResp.body;

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

    const detailResp = await rest<{ messages: { body: string; internal: boolean }[] }>(
      endUserToken,
      'GET',
      `/api/v1/end-users/me/conversations/${startedConv.id}`,
    );
    expect(detailResp.status).toBe(200);
    const detail = detailResp.body;
    const bodies = detail.messages.map((m) => m.body);
    expect(bodies).toContain('Hi Alice, I\'ve unlocked your account.');
    // Internal note is filtered by RLS — never visible to end-users.
    expect(bodies.find((b) => /2FA/.test(b))).toBeUndefined();
    expect(detail.messages.every((m) => m.internal === false)).toBe(true);

    // Cross-end-user isolation: Bob can't see Alice's conversation.
    const otherList = await rest<{ items: Array<{ id: string }> }>(
      otherEndUserToken,
      'GET',
      '/api/v1/end-users/me/conversations',
    );
    expect(otherList.body.items.find((row) => row.id === startedConv.id)).toBeFalsy();

    const otherGet = await rest<{ message?: string }>(
      otherEndUserToken,
      'GET',
      `/api/v1/end-users/me/conversations/${startedConv.id}`,
    );
    expect(otherGet.status).toBe(404);

    void channel;
  }, 30_000);

  it('admin can change status to closed; subsequent listings respect the filter', async () => {
    await rest(endUserToken, 'POST', '/api/v1/end-users/me/conversations', {
      body: 'How do I export my data?',
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

  it('admin agent requests handover; flag is set, internal note appears, idempotent, then user reply clears it', async () => {
    const startResp = await rest<{ id: string }>(endUserToken, 'POST', '/api/v1/end-users/me/conversations', {
      body: 'Can I get a partial refund for last month?',
    });
    const conv = startResp.body;

    type Summary = {
      id: string;
      needsHumanAttention: boolean;
      needsHumanAttentionAt: string | null;
    };
    type Detail = Summary & { messages: Array<{ body: string; internal: boolean; authorType: string }> };

    const flagged = await withClient(adminKey, async (c) => {
      const result = parseToolResult<Summary>(
        await c.callTool({
          name: 'conv_request_handover',
          arguments: { conversationId: conv.id, reason: 'refund outside policy' },
        }),
      );
      expect(result.needsHumanAttention).toBe(true);
      expect(result.needsHumanAttentionAt).not.toBeNull();

      const second = parseToolResult<Summary>(
        await c.callTool({
          name: 'conv_request_handover',
          arguments: { conversationId: conv.id },
        }),
      );
      expect(second.needsHumanAttention).toBe(true);
      expect(second.needsHumanAttentionAt).toBe(result.needsHumanAttentionAt);

      const detail = parseToolResult<Detail>(
        await c.callTool({ name: 'conv_get_conversation', arguments: { id: conv.id } }),
      );
      const systemNotes = detail.messages.filter(
        (m) => m.authorType === 'system' && /handover/i.test(m.body),
      );
      expect(systemNotes).toHaveLength(1);
      expect(systemNotes[0]!.internal).toBe(true);
      expect(systemNotes[0]!.body).toMatch(/refund outside policy/);
      return result;
    });

    const endUserDetail = await rest<Detail>(
      endUserToken,
      'GET',
      `/api/v1/end-users/me/conversations/${conv.id}`,
    );
    const systemNotes = endUserDetail.body.messages.filter((m) => m.authorType === 'system');
    expect(systemNotes).toHaveLength(0);

    await withClient(adminKey, async (c) => {
      const list = parseToolResult<Summary[]>(
        await c.callTool({ name: 'conv_list_conversations', arguments: {} }),
      );
      const idx = list.findIndex((row) => row.id === conv.id);
      const earlier = list.slice(0, idx);
      expect(earlier.every((row) => row.needsHumanAttention)).toBe(true);
    });

    await withClient(adminKey, async (c) => {
      await c.callTool({
        name: 'conv_send_message',
        arguments: { conversationId: conv.id, body: 'Got it — processing the partial refund now.' },
      });
      const detail = parseToolResult<Detail>(
        await c.callTool({ name: 'conv_get_conversation', arguments: { id: conv.id } }),
      );
      expect(detail.needsHumanAttention).toBe(false);
      expect(detail.needsHumanAttentionAt).toBeNull();
    });

    void flagged;
  }, 30_000);

  it('end-user agent can flag its own conversation via conv_request_handover_in_my_conversation (self-service)', async () => {
    const startResp = await rest<{ id: string }>(endUserToken, 'POST', '/api/v1/end-users/me/conversations', {
      body: 'I need to talk to a human about my contract.',
    });
    const conv = startResp.body;

    await withClient(endUserToken, async (c) => {
      const { tools } = await c.listTools();
      expect(tools.map((t) => t.name)).toContain('conv_request_handover_in_my_conversation');
      const result = parseToolResult<{ needsHumanAttention: boolean }>(
        await c.callTool({
          name: 'conv_request_handover_in_my_conversation',
          arguments: { conversationId: conv.id, reason: 'contract terms need review' },
        }),
      );
      expect(result.needsHumanAttention).toBe(true);
    });

    await withClient(adminKey, async (c) => {
      const list = parseToolResult<Array<{ id: string; needsHumanAttention: boolean }>>(
        await c.callTool({
          name: 'conv_list_conversations',
          arguments: { needsHumanAttention: true },
        }),
      );
      expect(list.find((row) => row.id === conv.id)?.needsHumanAttention).toBe(true);
    });
  }, 30_000);

  it('emits conversation.handover_resolved exactly once when admin reply clears the flag', async () => {
    const startResp = await rest<{ id: string }>(endUserToken, 'POST', '/api/v1/end-users/me/conversations', {
      body: 'Need help with my booking — flight got cancelled.',
    });
    const conv = startResp.body;

    await withClient(adminKey, async (c) => {
      await c.callTool({
        name: 'conv_request_handover',
        arguments: { conversationId: conv.id, reason: 'cancellation policy' },
      });
    });

    type EventRow = { type: string; payload: { conversationId?: string; authorType?: string } };
    const beforeReply = (await db.execute(
      sql`SELECT type, payload FROM events WHERE org_id = ${orgId} AND type = 'conversation.handover_resolved' AND payload->>'conversationId' = ${conv.id}`,
    )) as unknown as EventRow[];
    expect(beforeReply).toHaveLength(0);

    await withClient(adminKey, async (c) => {
      await c.callTool({
        name: 'conv_send_message',
        arguments: { conversationId: conv.id, body: "We'll rebook you on the next flight." },
      });
    });

    // The MCP transport's HTTP response can land before postgres-js has
    // surfaced the just-committed transaction to other pool sessions; give
    // the read-side a brief moment in the parallel-test case.
    await new Promise((r) => setTimeout(r, 100));

    const afterReply = (await db.execute(
      sql`SELECT type, payload FROM events WHERE org_id = ${orgId} AND type = 'conversation.handover_resolved' AND payload->>'conversationId' = ${conv.id} ORDER BY created_at DESC`,
    )) as unknown as EventRow[];
    expect(afterReply).toHaveLength(1);
    expect(afterReply[0]!.payload.conversationId).toBe(conv.id);
    expect(afterReply[0]!.payload.authorType).toBe('agent');

    // A second admin message on the same conversation should NOT re-emit the
    // event; the flag is already cleared.
    await withClient(adminKey, async (c) => {
      await c.callTool({
        name: 'conv_send_message',
        arguments: { conversationId: conv.id, body: 'Anything else I can help with?' },
      });
    });

    const stillOne = (await db.execute(
      sql`SELECT count(*)::int AS n FROM events WHERE org_id = ${orgId} AND type = 'conversation.handover_resolved' AND payload->>'conversationId' = ${conv.id}`,
    )) as unknown as Array<{ n: number }>;
    expect(stillOne[0]!.n).toBe(1);
  }, 30_000);

  it('changeStatus to closed clears needsHumanAttention', async () => {
    const startResp = await rest<{ id: string }>(endUserToken, 'POST', '/api/v1/end-users/me/conversations', {
      body: 'My invoice has the wrong VAT.',
    });
    const conv = startResp.body;

    await withClient(adminKey, async (c) => {
      await c.callTool({
        name: 'conv_request_handover',
        arguments: { conversationId: conv.id, reason: 'tax question' },
      });
      await c.callTool({
        name: 'conv_change_status',
        arguments: { id: conv.id, status: 'closed' },
      });
      const detail = parseToolResult<{ needsHumanAttention: boolean; needsHumanAttentionAt: string | null }>(
        await c.callTool({ name: 'conv_get_conversation', arguments: { id: conv.id } }),
      );
      expect(detail.needsHumanAttention).toBe(false);
      expect(detail.needsHumanAttentionAt).toBeNull();
    });
  }, 30_000);
});

function parseToolResult<T>(result: unknown): T {
  const r = result as { content?: Array<{ type: string; text?: string }> };
  const text = r.content?.[0]?.text ?? '';
  return JSON.parse(text) as T;
}
