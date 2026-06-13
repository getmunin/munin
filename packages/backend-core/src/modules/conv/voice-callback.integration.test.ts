import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { buildApiKey, hashSecret, keyPrefix } from '@getmunin/core';
import { ActorIdentity, withContext, type RequestContext } from '@getmunin/core';
import { createDb, runMigrations, schema } from '@getmunin/db';
import { sql, eq } from 'drizzle-orm';
import { AppModule } from '../../app.module.ts';
import { createApp } from '../../bootstrap-app.ts';
import { VapiService } from './vapi/vapi.service.ts';

const TEST_URL = process.env.TEST_DATABASE_URL;
const skipReason = TEST_URL
  ? null
  : 'Set TEST_DATABASE_URL to a Postgres URL to run voice-callback integration tests.';

(skipReason ? describe.skip : describe)('Voice callback MCP tools', () => {
  let app: INestApplication;
  let baseUrl: string;
  let db: ReturnType<typeof createDb>;
  let orgId: string;
  let adminKey: string;
  let aliceToken: string;
  let bobToken: string;
  let aliceConvId: string;
  let bobConvId: string;
  let voiceChannelId: string;
  let realFetch: typeof globalThis.fetch;

  beforeAll(async () => {
    process.env.MUNIN_AUTH_SECRET ??= 'test-secret-do-not-use-in-prod-it-must-be-32-chars';
    process.env.MUNIN_KEY_PEPPER ??= 'test-pepper';
    process.env.MUNIN_ENCRYPTION_KEY ??=
      'dGVzdC1lbmNyeXB0aW9uLWtleS1tdXN0LWJlLWxvbmctZW5vdWdoLWZvci1wZ2NyeXB0bw==';
    process.env.MUNIN_EMBEDDING_PROVIDER = 'stub';
    process.env.MUNIN_MAIL_PROVIDER = 'stub';
    process.env.MUNIN_WEBHOOK_WORKER_DISABLED = '1';
    process.env.MUNIN_CMS_SCHEDULE_WORKER_DISABLED = '1';

    await runMigrations(TEST_URL!);
    const appUrl = TEST_URL!.replace(/(postgres(?:ql)?:\/\/)[^:@]+:[^@]+@/, '$1munin_app:munin_app@');
    process.env.DATABASE_URL = appUrl;

    db = createDb(TEST_URL!, { serviceRole: true });
    await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);

    const [org] = await db
      .insert(schema.orgs)
      .values({ name: 'Voice Callback Org' })
      .returning();
    orgId = org!.id;

    adminKey = buildApiKey('admin');
    await db.insert(schema.apiKeys).values({
      orgId,
      type: 'admin',
      name: 'vcb-admin',
      keyHash: hashSecret(adminKey),
      keyPrefix: keyPrefix(adminKey),
      scopes: ['*'],
      audiences: ['admin', 'self_service'],
    });

    const [alice] = await db
      .insert(schema.endUsers)
      .values({ orgId, externalId: 'eu-alice-vcb', name: 'Alice', phone: '+14155551111' })
      .returning();
    const [bob] = await db
      .insert(schema.endUsers)
      .values({ orgId, externalId: 'eu-bob-vcb', name: 'Bob', phone: '+14155552222' })
      .returning();

    aliceToken = buildApiKey('dlg');
    await db.insert(schema.tokens).values({
      orgId,
      type: 'delegated_end_user',
      tokenHash: hashSecret(aliceToken),
      scopes: ['conv:read', 'conv:write'],
      audiences: ['self_service'],
      endUserId: alice!.id,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });
    bobToken = buildApiKey('dlg');
    await db.insert(schema.tokens).values({
      orgId,
      type: 'delegated_end_user',
      tokenHash: hashSecret(bobToken),
      scopes: ['conv:read', 'conv:write'],
      audiences: ['self_service'],
      endUserId: bob!.id,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });

    const [chatChannel] = await db
      .insert(schema.convChannels)
      .values({ orgId, type: 'chat', vendor: 'munin', name: 'Web chat' })
      .returning();

    const [aliceContact] = await db
      .insert(schema.convContacts)
      .values({ orgId, endUserId: alice!.id, name: 'Alice', phone: '+14155551111' })
      .returning();
    const [bobContact] = await db
      .insert(schema.convContacts)
      .values({ orgId, endUserId: bob!.id, name: 'Bob', phone: '+14155552222' })
      .returning();

    const [aliceConv] = await db
      .insert(schema.convConversations)
      .values({
        orgId,
        displayId: 1,
        channelId: chatChannel!.id,
        contactId: aliceContact!.id,
        endUserId: alice!.id,
        status: 'open',
      })
      .returning();
    aliceConvId = aliceConv!.id;
    const [bobConv] = await db
      .insert(schema.convConversations)
      .values({
        orgId,
        displayId: 2,
        channelId: chatChannel!.id,
        contactId: bobContact!.id,
        endUserId: bob!.id,
        status: 'open',
      })
      .returning();
    bobConvId = bobConv!.id;

    app = await createApp(AppModule, { logger: false });
    await app.listen(0, '127.0.0.1');
    const server = app.getHttpServer() as { address(): AddressInfo | string | null };
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('expected AddressInfo');
    baseUrl = `http://127.0.0.1:${address.port}`;

    const vapiSvc = app.get(VapiService);
    const actor = new ActorIdentity('user', 'usr_test_vcb', orgId, ['*'], ['admin']);
    const voiceChannel = await runAsActor(actor, () =>
      vapiSvc.createChannel({
        name: 'Vapi voice',
        config: {
          apiKey: 'vapi-api-key-vcb',
          webhookSecret: 'vapi-webhook-secret-vcb',
          assistantId: 'asst_vcb',
          phoneNumberId: 'pn_vcb',
        },
      }),
    );
    voiceChannelId = voiceChannel.id;

    realFetch = globalThis.fetch;
  });

  afterAll(async () => {
    globalThis.fetch = realFetch;
    if (app) await app.close();
    if (db) {
      await new Promise((r) => setTimeout(r, 50));
      await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
      await db.delete(schema.orgs).where(sql`id = ${orgId}`);
    }
  });

  beforeEach(() => {
    globalThis.fetch = realFetch;
  });

  async function runAsActor<T>(actor: ActorIdentity, fn: () => Promise<T>): Promise<T> {
    return db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.bypass_rls', 'on', true)`);
      await tx.execute(
        sql`SELECT set_config('app.crypt_key', ${process.env.MUNIN_ENCRYPTION_KEY ?? ''}, true)`,
      );
      const ctx: RequestContext = { db: tx, actor, correlationId: randomUUID() };
      return withContext(ctx, fn);
    });
  }

  async function withClient<T>(token: string, fn: (c: Client) => Promise<T>): Promise<T> {
    const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    });
    const c = new Client({ name: 'vcb-it', version: '0.0.0' });
    await c.connect(transport);
    try {
      return await fn(c);
    } finally {
      await transport.close();
      await c.close();
    }
  }

  function stubVapiPlaceCall(response: { id: string; status: string } = { id: 'call_stub_001', status: 'queued' }): { calls: Array<{ url: string; body: string | null }> } {
    const calls: Array<{ url: string; body: string | null }> = [];
    type FetchArgs = Parameters<typeof globalThis.fetch>;
    globalThis.fetch = (async (...args: FetchArgs) => {
      const [input, init] = args;
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.startsWith('https://api.vapi.ai/call')) {
        const body = init && typeof init.body === 'string' ? init.body : null;
        calls.push({ url, body });
        return new Response(JSON.stringify(response), {
          status: 201,
          headers: { 'content-type': 'application/json' },
        });
      }
      return realFetch(...args);
    });
    return { calls };
  }

  function parseResult<T>(toolResult: unknown): T {
    const res = toolResult as { content?: Array<{ type?: string; text?: string }> };
    const text = res.content?.find((c) => c.type === 'text')?.text ?? '';
    return JSON.parse(text) as T;
  }

  it('self-service token does NOT see admin-only voice tools', async () => {
    await withClient(aliceToken, async (c) => {
      const { tools } = await c.listTools();
      const names = tools.map((t) => t.name);
      expect(names).toContain('conv_request_callback');
      expect(names).not.toContain('conv_call_channel');
      expect(names).not.toContain('conv_call_contact');
      expect(names).not.toContain('conv_configure_channel');
    });
  });

  it('admin token sees both the self-service callback and the admin voice tools', async () => {
    await withClient(adminKey, async (c) => {
      const { tools } = await c.listTools();
      const names = tools.map((t) => t.name);
      expect(names).toContain('conv_call_channel');
      expect(names).toContain('conv_call_contact');
    });
  });

  it('alice can request a callback in her own conversation', async () => {
    const { calls } = stubVapiPlaceCall();
    const result = await withClient(aliceToken, async (c) => {
      return parseResult<{ initiated: boolean; callId: string; channelId: string; to: string }>(
        await c.callTool({
          name: 'conv_request_callback',
          arguments: { conversationId: aliceConvId },
        }),
      );
    });
    expect(result.initiated).toBe(true);
    expect(result.callId).toBe('call_stub_001');
    expect(result.channelId).toBe(voiceChannelId);
    expect(result.to).toBe('+14155551111');
    expect(calls.length).toBe(1);
    expect(calls[0]!.body ?? '').toContain('"+14155551111"');
    expect(calls[0]!.body ?? '').toContain('asst_vcb');
  });

  it("bob's token cannot trigger a callback for alice's conversation (cross-end-user isolation)", async () => {
    const { calls } = stubVapiPlaceCall();
    const result = (await withClient(bobToken, async (c) => {
      return await c.callTool({
        name: 'conv_request_callback',
        arguments: { conversationId: aliceConvId },
      });
    })) as { isError?: boolean; content?: Array<{ text?: string }> };
    expect(result.isError).toBe(true);
    expect(result.content?.[0]?.text ?? '').toMatch(/not found/i);
    expect(calls.length).toBe(0);
  });

  it('returns a clear error when no voice channel is configured', async () => {
    await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
    await db
      .update(schema.convChannels)
      .set({ active: false })
      .where(eq(schema.convChannels.id, voiceChannelId));
    try {
      const { calls } = stubVapiPlaceCall();
      const result = (await withClient(aliceToken, async (c) => {
        return await c.callTool({
          name: 'conv_request_callback',
          arguments: { conversationId: aliceConvId },
        });
      })) as { isError?: boolean; content?: Array<{ text?: string }> };
      expect(result.isError).toBe(true);
      expect(result.content?.[0]?.text ?? '').toMatch(/no_active_voice_channel/);
      expect(calls.length).toBe(0);
    } finally {
      await db
        .update(schema.convChannels)
        .set({ active: true })
        .where(eq(schema.convChannels.id, voiceChannelId));
    }
  });

  it('returns a clear error when the conversation contact has no phone', async () => {
    await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
    await db
      .update(schema.convContacts)
      .set({ phone: null })
      .where(sql`org_id = ${orgId} AND end_user_id = (SELECT id FROM end_users WHERE external_id = 'eu-bob-vcb' AND org_id = ${orgId})`);
    try {
      const { calls } = stubVapiPlaceCall();
      const result = (await withClient(bobToken, async (c) => {
        return await c.callTool({
          name: 'conv_request_callback',
          arguments: { conversationId: bobConvId },
        });
      })) as { isError?: boolean; content?: Array<{ text?: string }> };
      expect(result.isError).toBe(true);
      expect(result.content?.[0]?.text ?? '').toMatch(/no phone number/);
      expect(calls.length).toBe(0);
    } finally {
      await db
        .update(schema.convContacts)
        .set({ phone: '+14155552222' })
        .where(sql`org_id = ${orgId} AND end_user_id = (SELECT id FROM end_users WHERE external_id = 'eu-bob-vcb' AND org_id = ${orgId})`);
    }
  });

  it('admin can place a callback for any conversation in the org via conv_call_contact', async () => {
    const { calls } = stubVapiPlaceCall({ id: 'call_admin_002', status: 'ringing' });
    const result = await withClient(adminKey, async (c) => {
      return parseResult<{ initiated: boolean; callId: string }>(
        await c.callTool({
          name: 'conv_call_contact',
          arguments: { conversationId: bobConvId },
        }),
      );
    });
    expect(result.initiated).toBe(true);
    expect(result.callId).toBe('call_admin_002');
    expect(calls.length).toBe(1);
    expect(calls[0]!.body ?? '').toContain('"+14155552222"');
  });

});
