import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll, vi, type MockInstance } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import type { AddressInfo } from 'node:net';
import { createHmac, randomUUID } from 'node:crypto';
import { createDb, runMigrations, schema } from '@getmunin/db';
import { sql, eq, and } from 'drizzle-orm';
import { AppModule } from '../../../app.module.ts';
import { createApp } from '../../../bootstrap-app.ts';
import { ThrellService } from './threll.service.ts';
import { ThrellClientService } from './threll-client.service.ts';
import { ActorIdentity, withContext, type RequestContext } from '@getmunin/core';

const TEST_URL = process.env.TEST_DATABASE_URL;
const skipReason = TEST_URL
  ? null
  : 'Set TEST_DATABASE_URL to a Postgres URL to run Threll integration tests.';

(skipReason ? describe.skip : describe)('Threll voice channel integration', () => {
  let app: INestApplication;
  let baseUrl: string;
  let db: ReturnType<typeof createDb>;
  let client: ThrellClientService;
  let createSubSpy: MockInstance;
  let orgId: string;
  let channelId: string;
  const API_KEY = 'threll-api-key-it';
  const WEBHOOK_SECRET = 'whsec_threll_webhook_secret_it';
  const ACCOUNT_ID = 'acct_test_0001';
  const WORKER_ID = 'wrk_test_0001';

  beforeAll(async () => {
    process.env.MUNIN_AUTH_SECRET ??= 'test-secret-do-not-use-in-prod-it-must-be-32-chars';
    process.env.MUNIN_KEY_PEPPER ??= 'test-pepper';
    process.env.MUNIN_ENCRYPTION_KEY ??=
      'dGVzdC1lbmNyeXB0aW9uLWtleS1tdXN0LWJlLWxvbmctZW5vdWdoLWZvci1wZ2NyeXB0bw==';
    process.env.MUNIN_EMBEDDING_PROVIDER = 'stub';
    process.env.MUNIN_MAIL_PROVIDER = 'stub';
    process.env.MUNIN_STORAGE_PROVIDER = 'local';
    process.env.MUNIN_STORAGE_LOCAL_PATH = '/tmp/munin-threll-test';
    process.env.MUNIN_STORAGE_LOCAL_BASE_URL = 'http://127.0.0.1:0/static/assets';
    process.env.MUNIN_WEBHOOK_WORKER_DISABLED = '1';
    process.env.MUNIN_CMS_SCHEDULE_WORKER_DISABLED = '1';
    process.env.NEXT_PUBLIC_MCP_URL = 'https://munin.example';

    await runMigrations(TEST_URL!);
    const appUrl = TEST_URL!.replace(/(postgres(?:ql)?:\/\/)[^:@]+:[^@]+@/, '$1munin_app:munin_app@');
    process.env.DATABASE_URL = appUrl;

    db = createDb(TEST_URL!, { serviceRole: true });
    await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);

    const [org] = await db.insert(schema.orgs).values({ name: 'Threll IT Org' }).returning();
    orgId = org!.id;

    app = await createApp(AppModule, { logger: false });
    await app.listen(0, '127.0.0.1');
    const server = app.getHttpServer() as { address(): AddressInfo | string | null };
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('expected AddressInfo');
    baseUrl = `http://127.0.0.1:${address.port}`;

    client = app.get(ThrellClientService);
    createSubSpy = vi.spyOn(client, 'createWebhookSubscription').mockResolvedValue({
      ok: true,
      signingSecret: WEBHOOK_SECRET,
    });

    const svc = app.get(ThrellService);
    const actor = new ActorIdentity('user', 'usr_test', orgId, ['*'], ['admin']);
    const channel = await runAsActor(actor, () =>
      svc.createChannel({
        name: 'Threll main',
        config: {
          apiKey: API_KEY,
          accountId: ACCOUNT_ID,
          workerId: WORKER_ID,
        },
      }),
    );
    channelId = channel.id;
  });

  afterAll(async () => {
    if (app) await app.close();
    if (db) {
      await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
      await db.delete(schema.orgs).where(sql`id = ${orgId}`);
    }
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

  function sign(rawBody: string): string {
    return createHmac('sha256', WEBHOOK_SECRET).update(rawBody).digest('hex');
  }

  async function postEvent(event: Record<string, unknown>, signature?: string): Promise<Response> {
    const payload = JSON.stringify(event);
    return fetch(`${baseUrl}/v1/conversations/channels/${channelId}/webhook`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-threll-signature': signature ?? sign(payload),
        'x-forwarded-proto': 'https',
        'x-forwarded-host': 'munin.example',
      },
      body: payload,
    });
  }

  it('auto-provisions the Threll webhook subscription and stores the returned secret', async () => {
    expect(createSubSpy).toHaveBeenCalledWith({
      apiKey: API_KEY,
      accountId: ACCOUNT_ID,
      url: `https://munin.example/v1/conversations/channels/${channelId}/webhook`,
    });
    const rows = await db
      .select({ config: schema.convChannels.config })
      .from(schema.convChannels)
      .where(eq(schema.convChannels.id, channelId))
      .limit(1);
    const ct = (rows[0]!.config as Record<string, string>).encryptedWebhookSecret!;
    const stored = await client.loadSecret(ct);
    expect(stored).toBe(WEBHOOK_SECRET);
  });

  it('does not persist a channel when webhook provisioning fails', async () => {
    createSubSpy.mockResolvedValueOnce({ ok: false, error: 'threll_unauthorized' });
    const svc = app.get(ThrellService);
    const actor = new ActorIdentity('user', 'usr_test', orgId, ['*'], ['admin']);
    await expect(
      runAsActor(actor, () =>
        svc.createChannel({
          name: 'Threll failed',
          config: { apiKey: API_KEY, accountId: ACCOUNT_ID, workerId: WORKER_ID },
        }),
      ),
    ).rejects.toThrow('threll_unauthorized');
    const rows = await db
      .select({ id: schema.convChannels.id })
      .from(schema.convChannels)
      .where(
        and(eq(schema.convChannels.orgId, orgId), eq(schema.convChannels.name, 'Threll failed')),
      );
    expect(rows.length).toBe(0);
  });

  it('derives the webhook URL from forwarded request headers', async () => {
    const svc = app.get(ThrellService);
    const actor = new ActorIdentity('user', 'usr_test', orgId, ['*'], ['admin']);
    const created = await runAsActor(actor, () =>
      svc.createChannel({
        name: 'Threll fwd',
        config: { apiKey: API_KEY, accountId: ACCOUNT_ID, workerId: WORKER_ID },
        headers: { 'x-forwarded-proto': 'https', 'x-forwarded-host': 'api.getmunin.com' },
      }),
    );
    expect(createSubSpy).toHaveBeenLastCalledWith({
      apiKey: API_KEY,
      accountId: ACCOUNT_ID,
      url: `https://api.getmunin.com/v1/conversations/channels/${created.id}/webhook`,
    });
  });

  it('rejects webhook with an invalid signature', async () => {
    const res = await postEvent(
      { type: 'call.transcript', data: { callId: 'x' } },
      'deadbeef',
    );
    expect(res.status).toBe(401);
  });

  it('handles call.worker_request: pre-creates conversation + contact, returns instructions + metadata', async () => {
    const callId = 'call_threll_inbound';
    const callerNumber = '+14155556060';
    const res = await postEvent({
      type: 'call.worker_request',
      data: { callId, direction: 'inbound', customer: { number: callerNumber } },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;

    const convs = await db
      .select({
        id: schema.convConversations.id,
        contactId: schema.convConversations.contactId,
        endUserId: schema.convConversations.endUserId,
      })
      .from(schema.convConversations)
      .where(
        and(
          eq(schema.convConversations.orgId, orgId),
          sql`${schema.convConversations.metadata}->>'threllCallId' = ${callId}`,
        ),
      );
    expect(convs.length).toBe(1);
    expect(convs[0]!.contactId).toBeTruthy();
    expect(convs[0]!.endUserId).toBeTruthy();

    expect(typeof body.instructions).toBe('string');
    const meta = body.metadata as Record<string, unknown>;
    expect(meta.conversationId).toBe(convs[0]!.id);
    expect(meta.endUserId).toBe(convs[0]!.endUserId);

    const endUsers = await db
      .select({ phone: schema.endUsers.phone })
      .from(schema.endUsers)
      .where(
        and(
          eq(schema.endUsers.orgId, orgId),
          eq(schema.endUsers.externalId, `phone:${callerNumber}`),
        ),
      );
    expect(endUsers.length).toBe(1);
  });

  it('ingests user + agent transcript turns into one conversation by callId', async () => {
    const callId = 'call_threll_transcript';
    const r1 = await postEvent({
      type: 'call.transcript',
      data: {
        callId,
        role: 'user',
        text: 'Hello, my account is locked.',
        isFinal: true,
        turnIndex: 0,
      },
    });
    expect(r1.status).toBe(204);
    const r2 = await postEvent({
      type: 'call.transcript',
      data: {
        callId,
        role: 'agent',
        text: "I can help with that.",
        isFinal: true,
        turnIndex: 1,
      },
    });
    expect(r2.status).toBe(204);

    const convs = await db
      .select({ id: schema.convConversations.id })
      .from(schema.convConversations)
      .where(
        and(
          eq(schema.convConversations.orgId, orgId),
          sql`${schema.convConversations.metadata}->>'threllCallId' = ${callId}`,
        ),
      );
    expect(convs.length).toBe(1);

    const msgs = await db
      .select({ authorType: schema.convMessages.authorType })
      .from(schema.convMessages)
      .where(eq(schema.convMessages.conversationId, convs[0]!.id))
      .orderBy(schema.convMessages.createdAt);
    expect(msgs.length).toBe(2);
    expect(msgs[0]!.authorType).toBe('end_user');
    expect(msgs[1]!.authorType).toBe('agent');
  });

  it('skips non-final transcripts', async () => {
    const callId = 'call_threll_partial';
    await postEvent({
      type: 'call.transcript',
      data: { callId, role: 'user', text: 'I want to ch—', isFinal: false },
    });
    const convs = await db
      .select({ id: schema.convConversations.id })
      .from(schema.convConversations)
      .where(
        and(
          eq(schema.convConversations.orgId, orgId),
          sql`${schema.convConversations.metadata}->>'threllCallId' = ${callId}`,
        ),
      );
    expect(convs.length).toBe(0);
  });

  it('closes the conversation and stores artifact metadata on call.ended', async () => {
    const callId = 'call_threll_end';
    await postEvent({
      type: 'call.transcript',
      data: { callId, role: 'user', text: 'Goodbye', isFinal: true, turnIndex: 0 },
    });
    const r = await postEvent({
      type: 'call.ended',
      data: { callId, status: 'completed', recordingAvailable: true, analysis: 'Resolved.' },
    });
    expect(r.status).toBe(204);

    const conv = await db
      .select()
      .from(schema.convConversations)
      .where(
        and(
          eq(schema.convConversations.orgId, orgId),
          sql`${schema.convConversations.metadata}->>'threllCallId' = ${callId}`,
        ),
      )
      .limit(1);
    expect(conv[0]!.status).toBe('closed');
    const threllCall = conv[0]!.metadata.threllCall as Record<string, unknown>;
    expect(threllCall.recordingAvailable).toBe(true);
    expect(threllCall.analysis).toBe('Resolved.');
    expect(threllCall.endedReason).toBe('completed');
  });
});
