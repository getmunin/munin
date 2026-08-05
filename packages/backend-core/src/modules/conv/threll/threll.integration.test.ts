import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll, vi, type MockInstance } from 'vitest';
import { ConflictException, type INestApplication } from '@nestjs/common';
import type { AddressInfo } from 'node:net';
import { createHmac, randomUUID } from 'node:crypto';
import { createDb, runMigrations, schema } from '@getmunin/db';
import { sql, eq, and } from 'drizzle-orm';
import { AppModule } from '../../../app.module.ts';
import { createApp } from '../../../bootstrap-app.ts';
import { ThrellService, findReusableSigningSecret } from './threll.service.ts';
import { ThrellClientService } from './threll-client.service.ts';
import { ChannelAdminService } from '../channels/channel-admin.service.ts';
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
  let listSubsSpy: MockInstance;
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
    process.env.MUNIN_API_URL = 'https://munin.example';

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
    listSubsSpy = vi
      .spyOn(client, 'listWebhookSubscriptions')
      .mockResolvedValue({ ok: true, subscriptions: [] });

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

  it('completeSetup on a pending channel provisions the webhook and activates it', async () => {
    await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
    const [pending] = await db
      .insert(schema.convChannels)
      .values({
        orgId,
        type: 'voice',
        vendor: 'threll',
        name: 'Threll pending',
        config: { pendingSetup: { workerId: WORKER_ID, accountId: ACCOUNT_ID } },
        active: false,
      })
      .returning();

    const svc = app.get(ThrellService);
    const actor = new ActorIdentity('system', 'credential-handoff', orgId, ['*'], ['admin']);
    const result = await runAsActor(actor, () => svc.completeSetup(pending!.id, { apiKey: API_KEY }));
    expect(result.ok).toBe(true);
    expect(createSubSpy).toHaveBeenCalledWith({
      apiKey: API_KEY,
      accountId: ACCOUNT_ID,
      url: `https://munin.example/v1/conversations/channels/${pending!.id}/webhook`,
    });

    await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
    const rows = await db
      .select()
      .from(schema.convChannels)
      .where(eq(schema.convChannels.id, pending!.id))
      .limit(1);
    expect(rows[0]!.active).toBe(true);
    const config = rows[0]!.config as Record<string, string>;
    expect(config.pendingSetup).toBeUndefined();
    expect(await client.loadSecret(config.encryptedWebhookSecret!)).toBe(WEBHOOK_SECRET);
    expect(await client.loadSecret(config.encryptedApiKey!)).toBe(API_KEY);
    expect(JSON.stringify(config)).not.toContain(API_KEY);
  });

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

  it('consults existing subscriptions and still creates when none match', async () => {
    listSubsSpy.mockResolvedValueOnce({
      ok: true,
      subscriptions: [
        { id: 'sub_other', url: 'https://elsewhere.example/hook', eventType: '*', signingSecret: 'nope' },
      ],
    });
    const before = createSubSpy.mock.calls.length;
    const svc = app.get(ThrellService);
    const actor = new ActorIdentity('user', 'usr_test', orgId, ['*'], ['admin']);
    await runAsActor(actor, () =>
      svc.createChannel({
        name: 'Threll no-match',
        config: { apiKey: API_KEY, accountId: ACCOUNT_ID, workerId: WORKER_ID },
      }),
    );
    expect(listSubsSpy).toHaveBeenCalled();
    expect(createSubSpy.mock.calls.length).toBe(before + 1);
  });

  it('discovers workers via the generic listOptions path without persisting a channel', async () => {
    vi.spyOn(client, 'listWorkers').mockResolvedValueOnce({
      ok: true,
      workers: [
        { id: 'wrk_1', name: 'Front desk', inboundPhoneNumber: '+15551112222', outboundPhoneNumber: null },
        { id: 'wrk_2', name: null, inboundPhoneNumber: null, outboundPhoneNumber: null },
      ],
    });
    vi.spyOn(client, 'fetchAccount').mockResolvedValueOnce({
      ok: true,
      account: { id: ACCOUNT_ID, name: 'Acme Support' },
    });
    const before = await db
      .select({ id: schema.convChannels.id })
      .from(schema.convChannels)
      .where(eq(schema.convChannels.orgId, orgId));
    const res = await app
      .get(ChannelAdminService)
      .listOptions({ vendor: 'threll', config: { apiKey: API_KEY, accountId: ACCOUNT_ID } });
    expect(res.context?.label).toBe('Acme Support');
    const workers = res.groups.find((g) => g.key === 'workers')?.options ?? [];
    expect(workers[0]).toEqual({ value: 'wrk_1', label: 'Front desk', hint: '+15551112222' });
    expect(workers.map((o) => o.value)).toEqual(['wrk_1', 'wrk_2']);
    const after = await db
      .select({ id: schema.convChannels.id })
      .from(schema.convChannels)
      .where(eq(schema.convChannels.orgId, orgId));
    expect(after.length).toBe(before.length);
  });

  it('returns a 409 webhook_conflict when an enabled account-wide subscription already exists', async () => {
    listSubsSpy.mockResolvedValueOnce({
      ok: true,
      subscriptions: [
        { id: 'sub_other', url: 'https://other.example/hook', eventType: '*', enabled: true, signingSecret: 'x' },
      ],
    });
    const deleteSpy = vi.spyOn(client, 'deleteWebhookSubscription').mockResolvedValue({ ok: true });
    const createBefore = createSubSpy.mock.calls.length;
    const svc = app.get(ThrellService);
    const actor = new ActorIdentity('user', 'usr_test', orgId, ['*'], ['admin']);
    let caught: unknown;
    try {
      await runAsActor(actor, () =>
        svc.createChannel({
          name: 'Threll conflict',
          config: { apiKey: API_KEY, accountId: ACCOUNT_ID, workerId: WORKER_ID },
        }),
      );
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ConflictException);
    expect((caught as ConflictException).getStatus()).toBe(409);
    expect((caught as ConflictException).getResponse()).toMatchObject({ code: 'webhook_conflict' });
    expect(deleteSpy).not.toHaveBeenCalled();
    expect(createSubSpy.mock.calls.length).toBe(createBefore);
  });

  it('deletes the conflicting subscription and creates the channel when replaceWebhook is set', async () => {
    listSubsSpy.mockResolvedValueOnce({
      ok: true,
      subscriptions: [
        { id: 'sub_stale', url: 'https://other.example/hook', eventType: '*', enabled: true, signingSecret: 'x' },
      ],
    });
    const deleteSpy = vi
      .spyOn(client, 'deleteWebhookSubscription')
      .mockResolvedValue({ ok: true });
    const createBefore = createSubSpy.mock.calls.length;
    const svc = app.get(ThrellService);
    const actor = new ActorIdentity('user', 'usr_test', orgId, ['*'], ['admin']);
    const channel = await runAsActor(actor, () =>
      svc.createChannel({
        name: 'Threll replaced',
        config: { apiKey: API_KEY, accountId: ACCOUNT_ID, workerId: WORKER_ID },
        replaceWebhook: true,
      }),
    );
    expect(deleteSpy).toHaveBeenCalledWith({
      apiKey: API_KEY,
      accountId: ACCOUNT_ID,
      subscriptionId: 'sub_stale',
    });
    expect(createSubSpy.mock.calls.length).toBe(createBefore + 1);
    expect(channel.id).toBeTruthy();
  });

  it('discovers workers from the API key alone via /accounts/current', async () => {
    const currentSpy = vi.spyOn(client, 'fetchCurrentAccount').mockResolvedValueOnce({
      ok: true,
      account: { id: 'acct_from_key', name: 'Key Account' },
    });
    const listSpy = vi
      .spyOn(client, 'listWorkers')
      .mockResolvedValueOnce({ ok: true, workers: [{ id: 'wrk_9', name: 'Sales' }] });
    const res = await app
      .get(ChannelAdminService)
      .listOptions({ vendor: 'threll', config: { apiKey: API_KEY } });
    expect(currentSpy).toHaveBeenCalledWith({ apiKey: API_KEY });
    expect(listSpy).toHaveBeenCalledWith({ apiKey: API_KEY, accountId: 'acct_from_key' });
    expect(res.context?.label).toBe('Key Account');
    expect(res.groups.find((g) => g.key === 'workers')?.options).toEqual([
      { value: 'wrk_9', label: 'Sales' },
    ]);
  });

  it('creates a channel without an accountId by resolving it from the key', async () => {
    vi.spyOn(client, 'fetchCurrentAccount').mockResolvedValueOnce({
      ok: true,
      account: { id: 'acct_resolved', name: 'Resolved' },
    });
    const svc = app.get(ThrellService);
    const actor = new ActorIdentity('user', 'usr_test', orgId, ['*'], ['admin']);
    const channel = await runAsActor(actor, () =>
      svc.createChannel({ name: 'Threll keyonly', config: { apiKey: API_KEY, workerId: WORKER_ID } }),
    );
    expect(channel.config.accountId).toBe('acct_resolved');
    const [row] = await db
      .select({ config: schema.convChannels.config })
      .from(schema.convChannels)
      .where(eq(schema.convChannels.id, channel.id))
      .limit(1);
    expect(row!.config.accountId).toBe('acct_resolved');
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

  it('worker_request for an in-browser (webrtc) call creates no conversation', async () => {
    const callId = 'call_threll_webrtc';
    const res = await postEvent({
      type: 'call.worker_request',
      data: { callId, direction: 'inbound', transport: 'webrtc', customer: {} },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.metadata).toBeUndefined();
    expect(body.instructions).toBeUndefined();

    const created = await db
      .select({ id: schema.convConversations.id })
      .from(schema.convConversations)
      .where(
        and(
          eq(schema.convConversations.orgId, orgId),
          sql`${schema.convConversations.metadata}->>'threllCallId' = ${callId}`,
        ),
      );
    expect(created.length).toBe(0);
  });

  it('routes web-call transcripts to the pre-linked widget conversation by callId', async () => {
    const [widgetChannel] = await db
      .insert(schema.convChannels)
      .values({
        orgId,
        type: 'chat',
        vendor: 'munin',
        name: 'Widget for threll test',
        config: { provider: 'widget', originAllowlist: [], requireVerifiedIdentity: false },
      })
      .returning();
    const [eu] = await db
      .insert(schema.endUsers)
      .values({ orgId, externalId: 'eu-threll-widget', name: 'Web Caller' })
      .returning();
    const next = await db.execute<{ next: number } & Record<string, unknown>>(
      sql`SELECT conv_next_display_id(${orgId}) AS next`,
    );
    const callId = 'call_threll_widget_web';
    const [widgetConv] = await db
      .insert(schema.convConversations)
      .values({
        orgId,
        displayId: next[0]!.next,
        channelId: widgetChannel!.id,
        endUserId: eu!.id,
        status: 'open',
        metadata: { sessionId: 'sess_threll_widget', threllCallId: callId },
      })
      .returning();

    const transcript = await postEvent({
      type: 'call.transcript',
      data: { callId, role: 'user', text: 'Hi from the browser', isFinal: true, turnIndex: 0 },
    });
    expect(transcript.status).toBe(204);

    const msgs = await db
      .select({ body: schema.convMessages.body, conversationId: schema.convMessages.conversationId })
      .from(schema.convMessages)
      .where(eq(schema.convMessages.conversationId, widgetConv!.id));
    expect(msgs.map((m) => m.body)).toContain('Hi from the browser');

    const onVoice = await db
      .select({ id: schema.convConversations.id })
      .from(schema.convConversations)
      .where(
        and(
          eq(schema.convConversations.orgId, orgId),
          eq(schema.convConversations.channelId, channelId),
          sql`${schema.convConversations.metadata}->>'threllCallId' = ${callId}`,
        ),
      );
    expect(onVoice.length).toBe(0);
  });

  it('routes web-call transcripts to the conversation named in event metadata', async () => {
    const [widgetChannel] = await db
      .insert(schema.convChannels)
      .values({
        orgId,
        type: 'chat',
        vendor: 'munin',
        name: 'Widget meta test',
        config: { provider: 'widget', originAllowlist: [], requireVerifiedIdentity: false },
      })
      .returning();
    const [eu] = await db
      .insert(schema.endUsers)
      .values({ orgId, externalId: 'eu-threll-meta', name: 'Web Caller 2' })
      .returning();
    const next = await db.execute<{ next: number } & Record<string, unknown>>(
      sql`SELECT conv_next_display_id(${orgId}) AS next`,
    );
    const [widgetConv] = await db
      .insert(schema.convConversations)
      .values({
        orgId,
        displayId: next[0]!.next,
        channelId: widgetChannel!.id,
        endUserId: eu!.id,
        status: 'open',
        metadata: { sessionId: 'sess_threll_meta' },
      })
      .returning();

    const callId = 'call_threll_meta';
    const transcript = await postEvent({
      type: 'call.transcript',
      data: {
        callId,
        role: 'user',
        text: 'Routed by metadata',
        isFinal: true,
        turnIndex: 0,
        metadata: { conversationId: widgetConv!.id },
      },
    });
    expect(transcript.status).toBe(204);

    const msgs = await db
      .select({ body: schema.convMessages.body })
      .from(schema.convMessages)
      .where(eq(schema.convMessages.conversationId, widgetConv!.id));
    expect(msgs.map((m) => m.body)).toContain('Routed by metadata');
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

  it('ignores a redelivered transcript turn instead of storing it twice', async () => {
    const callId = 'call_threll_redelivered';
    const turn = {
      type: 'call.transcript',
      data: {
        callId,
        role: 'user',
        text: 'Can you check my order status?',
        isFinal: true,
        turnIndex: 0,
      },
    };
    const r1 = await postEvent(turn);
    expect(r1.status).toBe(204);
    const r2 = await postEvent(turn);
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
      .select({ body: schema.convMessages.body })
      .from(schema.convMessages)
      .where(eq(schema.convMessages.conversationId, convs[0]!.id));
    expect(msgs.length).toBe(1);
  });

  it('orders transcript turns by turnIndex even when webhooks arrive out of order', async () => {
    const callId = 'call_threll_out_of_order';
    const r1 = await postEvent({
      type: 'call.transcript',
      data: {
        callId,
        role: 'agent',
        text: 'Second thing the agent said.',
        isFinal: true,
        turnIndex: 3,
      },
    });
    expect(r1.status).toBe(204);
    const r2 = await postEvent({
      type: 'call.transcript',
      data: {
        callId,
        role: 'user',
        text: 'First thing the caller said.',
        isFinal: true,
        turnIndex: 0,
      },
    });
    expect(r2.status).toBe(204);
    const r3 = await postEvent({
      type: 'call.transcript',
      data: {
        callId,
        role: 'agent',
        text: 'First thing the agent said.',
        isFinal: true,
        turnIndex: 1,
      },
    });
    expect(r3.status).toBe(204);
    const r4 = await postEvent({
      type: 'call.transcript',
      data: {
        callId,
        role: 'user',
        text: 'Second thing the caller said.',
        isFinal: true,
        turnIndex: 2,
      },
    });
    expect(r4.status).toBe(204);

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
      .select({ body: schema.convMessages.body })
      .from(schema.convMessages)
      .where(eq(schema.convMessages.conversationId, convs[0]!.id))
      .orderBy(schema.convMessages.createdAt);
    expect(msgs.map((m) => m.body)).toEqual([
      'First thing the caller said.',
      'First thing the agent said.',
      'Second thing the caller said.',
      'Second thing the agent said.',
    ]);
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

  it('emits conversation.status_changed on call.ended so operator bridges see the auto-close', async () => {
    const callId = 'call_threll_end_status_event';
    await postEvent({
      type: 'call.transcript',
      data: { callId, role: 'user', text: 'That is all, thanks', isFinal: true, turnIndex: 0 },
    });
    await postEvent({
      type: 'call.ended',
      data: { callId, status: 'completed', recordingAvailable: false, analysis: null },
    });

    const [conv] = await db
      .select({ id: schema.convConversations.id, status: schema.convConversations.status })
      .from(schema.convConversations)
      .where(
        and(
          eq(schema.convConversations.orgId, orgId),
          sql`${schema.convConversations.metadata}->>'threllCallId' = ${callId}`,
        ),
      )
      .limit(1);
    expect(conv!.status).toBe('closed');

    const events = await db
      .select({ type: schema.events.type })
      .from(schema.events)
      .where(
        and(
          eq(schema.events.orgId, orgId),
          sql`${schema.events.payload}->>'conversationId' = ${conv!.id}`,
        ),
      );
    expect(events.map((e) => e.type)).toContain('conversation.status_changed');
  });

  it('enqueues the CRM contact-extraction pass when a voice call auto-closes', async () => {
    const callId = 'call_threll_end_curator_job';
    await postEvent({
      type: 'call.transcript',
      data: { callId, role: 'user', text: 'I am Ada, ada@example.com', isFinal: true, turnIndex: 0 },
    });
    await postEvent({
      type: 'call.ended',
      data: { callId, status: 'completed', recordingAvailable: false, analysis: null },
    });

    const [conv] = await db
      .select({ id: schema.convConversations.id })
      .from(schema.convConversations)
      .where(
        and(
          eq(schema.convConversations.orgId, orgId),
          sql`${schema.convConversations.metadata}->>'threllCallId' = ${callId}`,
        ),
      )
      .limit(1);

    const jobs = await db
      .select({ jobUri: schema.curatorJobs.jobUri })
      .from(schema.curatorJobs)
      .where(
        and(
          eq(schema.curatorJobs.orgId, orgId),
          eq(schema.curatorJobs.dedupeKey, `crm-contact-extract:conv:${conv!.id}`),
        ),
      );
    expect(jobs.map((j) => j.jobUri)).toContain('skill://crm/extract-contact-from-message');
  });
});

describe('findReusableSigningSecret', () => {
  const url = 'https://munin.example/v1/conversations/channels/cch_x/webhook';

  it('returns the signing secret of a subscription with the exact url', () => {
    expect(
      findReusableSigningSecret(
        [
          { id: 'a', url: 'https://munin.example/other', eventType: '*', enabled: true, signingSecret: 'nope' },
          { id: 'b', url, eventType: '*', enabled: true, signingSecret: 'whsec_reused' },
        ],
        url,
      ),
    ).toBe('whsec_reused');
  });

  it('returns null when no url matches', () => {
    expect(
      findReusableSigningSecret(
        [{ id: 'a', url: 'https://munin.example/other', eventType: '*', enabled: true, signingSecret: 'x' }],
        url,
      ),
    ).toBeNull();
  });

  it('returns null when the matching subscription has no signing secret', () => {
    expect(
      findReusableSigningSecret([{ id: 'a', url, eventType: '*', enabled: true, signingSecret: null }], url),
    ).toBeNull();
  });
});
