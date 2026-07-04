import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll, vi, type MockInstance } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import { buildApiKey, hashSecret, keyPrefix } from '@getmunin/core';
import { ActorIdentity, withContext, type RequestContext } from '@getmunin/core';
import { createDb, runMigrations, schema } from '@getmunin/db';
import { sql, eq } from 'drizzle-orm';
import { AppModule } from '../../../app.module.ts';
import { createApp } from '../../../bootstrap-app.ts';
import { VapiService } from '../vapi/vapi.service.ts';
import { VapiClientService } from '../vapi/vapi-client.service.ts';

const TEST_URL = process.env.TEST_DATABASE_URL;
const skipReason = TEST_URL
  ? null
  : 'Set TEST_DATABASE_URL to a Postgres URL to run widget-voice integration tests.';

(skipReason ? describe.skip : describe)('Widget voice/start endpoint', () => {
  const ALICE_SESSION_ID = 'voice_alice_session';
  let app: INestApplication;
  let baseUrl: string;
  let db: ReturnType<typeof createDb>;
  let orgId: string;
  let widgetKey: string;
  let widgetChannelId: string;
  let voiceChannelId: string;
  let aliceConvId: string;
  let fetchAssistantSpy: MockInstance;

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
      .values({ name: 'Widget Voice Org' })
      .returning();
    orgId = org!.id;

    const [chatChannel] = await db
      .insert(schema.convChannels)
      .values({
        orgId,
        type: 'chat',
        vendor: 'munin',
        name: 'Web chat',
        config: { provider: 'widget', originAllowlist: [], requireVerifiedIdentity: false },
      })
      .returning();
    widgetChannelId = chatChannel!.id;

    widgetKey = buildApiKey('widget');
    await db.insert(schema.apiKeys).values({
      orgId,
      type: 'widget',
      name: 'wv-widget',
      keyHash: hashSecret(widgetKey),
      keyPrefix: keyPrefix(widgetKey),
      scopes: ['conv:write'],
      channelId: widgetChannelId,
    });

    const [alice] = await db
      .insert(schema.endUsers)
      .values({ orgId, externalId: 'eu-alice-wv', name: 'Alice', phone: '+14155551111' })
      .returning();

    const [aliceContact] = await db
      .insert(schema.convContacts)
      .values({ orgId, endUserId: alice!.id, name: 'Alice', phone: '+14155551111' })
      .returning();

    const [aliceConv] = await db
      .insert(schema.convConversations)
      .values({
        orgId,
        displayId: 1,
        channelId: widgetChannelId,
        contactId: aliceContact!.id,
        endUserId: alice!.id,
        status: 'open',
        metadata: { sessionId: ALICE_SESSION_ID },
      })
      .returning();
    aliceConvId = aliceConv!.id;

    app = await createApp(AppModule, { logger: false });
    await app.listen(0, '127.0.0.1');
    const server = app.getHttpServer() as { address(): AddressInfo | string | null };
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('expected AddressInfo');
    baseUrl = `http://127.0.0.1:${address.port}`;

    const vapiClient = app.get(VapiClientService);
    fetchAssistantSpy = vi.spyOn(vapiClient, 'fetchAssistantConfig');
    fetchAssistantSpy.mockResolvedValue({
      ok: true,
      config: {
        id: 'asst_wv',
        name: 'Test assistant',
        model: { provider: 'openai', model: 'gpt-4o-mini', messages: [], tools: [] },
        firstMessage: 'Hi',
      },
    });

    const vapiSvc = app.get(VapiService);
    const actor = new ActorIdentity('user', 'usr_test_wv', orgId, ['*'], ['admin']);
    const voiceChannel = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.bypass_rls', 'on', true)`);
      await tx.execute(
        sql`SELECT set_config('app.crypt_key', ${process.env.MUNIN_ENCRYPTION_KEY ?? ''}, true)`,
      );
      const ctx: RequestContext = { db: tx, actor, correlationId: randomUUID() };
      return withContext(ctx, () =>
        vapiSvc.createChannel({
          name: 'Vapi voice',
          config: {
            apiKey: 'vapi-api-key-wv',
            webhookSecret: 'vapi-webhook-secret-wv',
            assistantId: 'asst_wv',
            phoneNumberId: 'pn_wv',
            publicKey: 'pk_widget_browser_safe_xyz',
          },
        }),
      );
    });
    voiceChannelId = voiceChannel.id;
  });

  afterAll(async () => {
    if (app) await app.close();
    if (db) {
      await new Promise((r) => setTimeout(r, 50));
      await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
      await db.delete(schema.orgs).where(sql`id = ${orgId}`);
    }
  });

  async function call(body: unknown, token: string = widgetKey): Promise<{ status: number; json: unknown }> {
    const res = await fetch(`${baseUrl}/v1/widget/voice/start`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = text;
    }
    return { status: res.status, json };
  }

  async function callAvailable(
    query: Record<string, string>,
    token: string = widgetKey,
  ): Promise<{ status: number; json: unknown }> {
    const url = new URL(`${baseUrl}/v1/widget/voice/available`);
    const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
    const sessionHeaderMap: Record<string, string> = {
      sessionId: 'x-munin-session-id',
      verifiedExternalId: 'x-munin-verified-external-id',
      userHash: 'x-munin-user-hash',
    };
    for (const [k, v] of Object.entries(query)) {
      const header = sessionHeaderMap[k];
      if (header) headers[header] = v;
      else url.searchParams.set(k, v);
    }
    const res = await fetch(url, { headers });
    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = text;
    }
    return { status: res.status, json };
  }

  it('voice/available reports available without minting a Vapi assistant session', async () => {
    const before = fetchAssistantSpy.mock.calls.length;
    const { status, json } = await callAvailable({
      channelId: widgetChannelId,
      conversationId: aliceConvId,
      sessionId: ALICE_SESSION_ID,
    });
    expect(status).toBe(200);
    expect(json).toEqual({ available: true });
    expect(fetchAssistantSpy.mock.calls.length).toBe(before);
  });

  it('voice/available rejects when body channelId does not match the bound widget key', async () => {
    const { status, json } = await callAvailable({
      channelId: 'cch_someone_elses',
      conversationId: aliceConvId,
      sessionId: ALICE_SESSION_ID,
    });
    expect(status).toBe(403);
    expect(JSON.stringify(json)).toContain('widget_channel_mismatch');
  });

  it('voice/available returns available:false when voice channel has no publicKey', async () => {
    await db
      .update(schema.convChannels)
      .set({ config: sql`config - 'publicKey'` })
      .where(eq(schema.convChannels.id, voiceChannelId));
    try {
      const { status, json } = await callAvailable({
        channelId: widgetChannelId,
        conversationId: aliceConvId,
        sessionId: ALICE_SESSION_ID,
      });
      expect(status).toBe(200);
      expect(json).toEqual({ available: false, reason: 'voice_channel_missing_public_key' });
    } finally {
      await db
        .update(schema.convChannels)
        .set({ config: sql`config || '{"publicKey":"pk_widget_browser_safe_xyz"}'::jsonb` })
        .where(eq(schema.convChannels.id, voiceChannelId));
    }
  });

  it('returns a Vapi descriptor for an alice conversation', async () => {
    const { status, json } = await call({
      channelId: widgetChannelId,
      conversationId: aliceConvId,
      sessionId: ALICE_SESSION_ID,
    });
    expect(status).toBe(201);
    const body = json as {
      available: boolean;
      descriptor?: { vendor: string; publicKey: string; assistantId: string; metadata: Record<string, string> };
    };
    expect(body.available).toBe(true);
    expect(body.descriptor?.vendor).toBe('vapi');
    expect(body.descriptor?.publicKey).toBe('pk_widget_browser_safe_xyz');
    expect(body.descriptor?.assistantId).toBe('asst_wv');
    expect(body.descriptor?.metadata).toEqual({
      conversationId: aliceConvId,
      endUserId: expect.any(String) as unknown,
    });
  });

  it('rejects unauthenticated requests', async () => {
    const res = await fetch(`${baseUrl}/v1/widget/voice/start`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ channelId: widgetChannelId, conversationId: aliceConvId }),
    });
    expect(res.status).toBe(401);
  });

  it('rejects when body channelId does not match the bound widget key', async () => {
    const { status, json } = await call({
      channelId: 'cch_someone_elses',
      conversationId: aliceConvId,
      sessionId: ALICE_SESSION_ID,
    });
    expect(status).toBe(403);
    expect(JSON.stringify(json)).toContain('widget_channel_mismatch');
  });

  it('rejects when the conversation belongs to a different channel', async () => {
    const [otherConv] = await db
      .insert(schema.convConversations)
      .values({
        orgId,
        displayId: 99,
        channelId: voiceChannelId,
        status: 'open',
        metadata: { sessionId: ALICE_SESSION_ID },
      })
      .returning();
    try {
      const { status, json } = await call({
        channelId: widgetChannelId,
        conversationId: otherConv!.id,
        sessionId: ALICE_SESSION_ID,
      });
      expect(status).toBe(403);
      expect(JSON.stringify(json)).toContain('conversation_channel_mismatch');
    } finally {
      await db.delete(schema.convConversations).where(eq(schema.convConversations.id, otherConv!.id));
    }
  });

  it('rejects when sessionId does not match the conversation', async () => {
    const { status, json } = await call({
      channelId: widgetChannelId,
      conversationId: aliceConvId,
      sessionId: 'someone_elses_session',
    });
    expect(status).toBe(403);
    expect(JSON.stringify(json)).toContain('conversation_session_mismatch');
  });

  it('rejects when the bound widget channel has been deactivated', async () => {
    await db
      .update(schema.convChannels)
      .set({ active: false })
      .where(eq(schema.convChannels.id, widgetChannelId));
    try {
      const { status, json } = await call({
        channelId: widgetChannelId,
        conversationId: aliceConvId,
        sessionId: ALICE_SESSION_ID,
      });
      expect(status).toBe(403);
      expect(JSON.stringify(json)).toContain('is inactive');
    } finally {
      await db
        .update(schema.convChannels)
        .set({ active: true })
        .where(eq(schema.convChannels.id, widgetChannelId));
    }
  });

  it('returns available:false when voice channel has no publicKey', async () => {
    await db
      .update(schema.convChannels)
      .set({
        config: sql`config - 'publicKey'`,
      })
      .where(eq(schema.convChannels.id, voiceChannelId));
    try {
      const { status, json } = await call({
        channelId: widgetChannelId,
        conversationId: aliceConvId,
        sessionId: ALICE_SESSION_ID,
      });
      expect(status).toBe(201);
      expect(json).toEqual({ available: false, reason: 'voice_channel_missing_public_key' });
    } finally {
      await db
        .update(schema.convChannels)
        .set({
          config: sql`config || '{"publicKey":"pk_widget_browser_safe_xyz"}'::jsonb`,
        })
        .where(eq(schema.convChannels.id, voiceChannelId));
    }
  });

  it('returns available:false when no active voice channel exists', async () => {
    await db
      .update(schema.convChannels)
      .set({ active: false })
      .where(eq(schema.convChannels.id, voiceChannelId));
    try {
      const { status, json } = await call({
        channelId: widgetChannelId,
        conversationId: aliceConvId,
        sessionId: ALICE_SESSION_ID,
      });
      expect(status).toBe(201);
      expect(json).toEqual({ available: false, reason: 'no_active_voice_channel' });
    } finally {
      await db
        .update(schema.convChannels)
        .set({ active: true })
        .where(eq(schema.convChannels.id, voiceChannelId));
    }
  });

  it('returns multiple_voice_channels_without_widget_routing when 2 voice channels and widget has no voiceChannelId', async () => {
    const [extra] = await db
      .insert(schema.convChannels)
      .values({
        orgId,
        type: 'voice',
        vendor: 'vapi',
        name: 'extra-vapi',
        active: true,
        config: {
          encryptedApiKey: 'fake',
          encryptedWebhookSecret: 'fake',
          assistantId: 'asst_extra',
          phoneNumberId: 'pn_extra',
          publicKey: 'pk_extra',
        },
      })
      .returning();
    try {
      const { status, json } = await call({
        channelId: widgetChannelId,
        conversationId: aliceConvId,
        sessionId: ALICE_SESSION_ID,
      });
      expect(status).toBe(201);
      expect(json).toEqual({
        available: false,
        reason: 'multiple_voice_channels_without_widget_routing',
      });
    } finally {
      await db.delete(schema.convChannels).where(eq(schema.convChannels.id, extra!.id));
    }
  });

  it('routes to the configured voiceChannelId when widget has one set and multiple voice channels exist', async () => {
    const vapiSvc = app.get(VapiService);
    const actor = new ActorIdentity('user', 'usr_test_wv', orgId, ['*'], ['admin']);
    const extra = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.bypass_rls', 'on', true)`);
      await tx.execute(
        sql`SELECT set_config('app.crypt_key', ${process.env.MUNIN_ENCRYPTION_KEY ?? ''}, true)`,
      );
      const ctx: RequestContext = { db: tx, actor, correlationId: randomUUID() };
      return withContext(ctx, () =>
        vapiSvc.createChannel({
          name: 'Vapi voice 2',
          config: {
            apiKey: 'vapi-api-key-wv-2',
            webhookSecret: 'vapi-webhook-secret-wv-2',
            assistantId: 'asst_extra2',
            phoneNumberId: 'pn_extra2',
            publicKey: 'pk_target',
          },
        }),
      );
    });
    await db
      .update(schema.convChannels)
      .set({
        config: sql`config || ${JSON.stringify({ provider: 'widget', voiceChannelId: extra.id })}::jsonb`,
      })
      .where(eq(schema.convChannels.id, widgetChannelId));
    try {
      const { status, json } = await call({
        channelId: widgetChannelId,
        conversationId: aliceConvId,
        sessionId: ALICE_SESSION_ID,
      });
      expect(status).toBe(201);
      const body = json as {
        available: boolean;
        descriptor?: { publicKey: string; assistantId: string };
      };
      expect(body.available).toBe(true);
      expect(body.descriptor?.publicKey).toBe('pk_target');
      expect(body.descriptor?.assistantId).toBe('asst_extra2');
    } finally {
      await db
        .update(schema.convChannels)
        .set({ config: sql`config - 'voiceChannelId'` })
        .where(eq(schema.convChannels.id, widgetChannelId));
      await db.delete(schema.convChannels).where(eq(schema.convChannels.id, extra.id));
    }
  });

  it('returns widget_voice_channel_id_not_found_or_inactive when voiceChannelId points at an unknown channel', async () => {
    await db
      .update(schema.convChannels)
      .set({
        config: sql`config || ${JSON.stringify({ provider: 'widget', voiceChannelId: 'cch_does_not_exist' })}::jsonb`,
      })
      .where(eq(schema.convChannels.id, widgetChannelId));
    try {
      const { status, json } = await call({
        channelId: widgetChannelId,
        conversationId: aliceConvId,
        sessionId: ALICE_SESSION_ID,
      });
      expect(status).toBe(201);
      expect(json).toEqual({
        available: false,
        reason: 'widget_voice_channel_id_not_found_or_inactive',
      });
    } finally {
      await db
        .update(schema.convChannels)
        .set({ config: sql`config - 'voiceChannelId'` })
        .where(eq(schema.convChannels.id, widgetChannelId));
    }
  });
});
