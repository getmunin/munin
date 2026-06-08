import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import { createDb, runMigrations, schema } from '@getmunin/db';
import { sql, eq, and } from 'drizzle-orm';
import { AppModule } from '../../../app.module.ts';
import { createApp } from '../../../bootstrap-app.ts';
import { VapiService } from './vapi.service.ts';
import { ActorIdentity, withContext, type RequestContext } from '@getmunin/core';

const TEST_URL = process.env.TEST_DATABASE_URL;
const skipReason = TEST_URL
  ? null
  : 'Set TEST_DATABASE_URL to a Postgres URL to run Vapi integration tests.';

(skipReason ? describe.skip : describe)('Vapi voice channel integration', () => {
  let app: INestApplication;
  let baseUrl: string;
  let db: ReturnType<typeof createDb>;
  let orgId: string;
  let channelId: string;
  const API_KEY = 'vapi-api-key-it';
  const WEBHOOK_SECRET = 'vapi-webhook-secret-it';
  const ASSISTANT_ID = 'asst_test_0001';
  const PHONE_NUMBER_ID = 'pn_test_0001';

  beforeAll(async () => {
    process.env.MUNIN_AUTH_SECRET ??= 'test-secret-do-not-use-in-prod-it-must-be-32-chars';
    process.env.MUNIN_KEY_PEPPER ??= 'test-pepper';
    process.env.MUNIN_ENCRYPTION_KEY ??=
      'dGVzdC1lbmNyeXB0aW9uLWtleS1tdXN0LWJlLWxvbmctZW5vdWdoLWZvci1wZ2NyeXB0bw==';
    process.env.MUNIN_EMBEDDING_PROVIDER = 'stub';
    process.env.MUNIN_MAIL_PROVIDER = 'stub';
    process.env.MUNIN_STORAGE_PROVIDER = 'local';
    process.env.MUNIN_STORAGE_LOCAL_PATH = '/tmp/munin-vapi-test';
    process.env.MUNIN_STORAGE_LOCAL_BASE_URL = 'http://127.0.0.1:0/static/assets';
    process.env.MUNIN_WEBHOOK_WORKER_DISABLED = '1';
    process.env.MUNIN_CMS_SCHEDULE_WORKER_DISABLED = '1';

    await runMigrations(TEST_URL!);
    const appUrl = TEST_URL!.replace(/(postgres(?:ql)?:\/\/)[^:@]+:[^@]+@/, '$1munin_app:munin_app@');
    process.env.DATABASE_URL = appUrl;

    db = createDb(TEST_URL!, { serviceRole: true });
    await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);

    const [org] = await db
      .insert(schema.orgs)
      .values({ name: 'Vapi IT Org' })
      .returning();
    orgId = org!.id;

    app = await createApp(AppModule, { logger: false });
    await app.listen(0, '127.0.0.1');
    const server = app.getHttpServer() as { address(): AddressInfo | string | null };
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('expected AddressInfo');
    baseUrl = `http://127.0.0.1:${address.port}`;

    const svc = app.get(VapiService);
    const actor = new ActorIdentity('user', 'usr_test', orgId, ['*'], ['admin']);
    const channel = await runAsActor(actor, () =>
      svc.createChannel({
        name: 'Vapi main',
        config: {
          apiKey: API_KEY,
          webhookSecret: WEBHOOK_SECRET,
          assistantId: ASSISTANT_ID,
          phoneNumberId: PHONE_NUMBER_ID,
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

  async function postEvent(message: Record<string, unknown>): Promise<Response> {
    const payload = JSON.stringify({ message });
    return fetch(`${baseUrl}/v1/conversations/channels/${channelId}/webhook`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-webhook-secret': WEBHOOK_SECRET,
        'x-forwarded-proto': 'https',
        'x-forwarded-host': 'munin.example',
      },
      body: payload,
    });
  }

  it('rejects webhook with wrong shared secret', async () => {
    const payload = JSON.stringify({ message: { type: 'transcript' } });
    const res = await fetch(`${baseUrl}/v1/conversations/channels/${channelId}/webhook`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-webhook-secret': 'wrong',
        'x-forwarded-proto': 'https',
        'x-forwarded-host': 'munin.example',
      },
      body: payload,
    });
    expect(res.status).toBe(401);
  });

  it('ingests user + assistant transcript turns into one conversation by callId', async () => {
    const callId = 'call_vapi_0001';
    const r1 = await postEvent({
      type: 'transcript',
      transcriptType: 'final',
      role: 'user',
      transcript: 'Hello, my account is locked.',
      call: { id: callId, customer: { number: '+14155551212' } },
    });
    expect(r1.status).toBe(204);

    const r2 = await postEvent({
      type: 'transcript',
      transcriptType: 'final',
      role: 'assistant',
      transcript: "I can help with that. Let's verify a few details.",
      call: { id: callId, customer: { number: '+14155551212' } },
    });
    expect(r2.status).toBe(204);

    const convs = await db
      .select({
        id: schema.convConversations.id,
        metadata: schema.convConversations.metadata,
      })
      .from(schema.convConversations)
      .where(
        and(
          eq(schema.convConversations.orgId, orgId),
          sql`${schema.convConversations.metadata}->>'vapiCallId' = ${callId}`,
        ),
      );
    expect(convs.length).toBe(1);

    const msgs = await db
      .select({
        body: schema.convMessages.body,
        authorType: schema.convMessages.authorType,
      })
      .from(schema.convMessages)
      .where(eq(schema.convMessages.conversationId, convs[0]!.id))
      .orderBy(schema.convMessages.createdAt);
    expect(msgs.length).toBe(2);
    expect(msgs[0]!.authorType).toBe('end_user');
    expect(msgs[1]!.authorType).toBe('agent');
  });

  it('skips partial transcripts', async () => {
    const callId = 'call_vapi_partials';
    await postEvent({
      type: 'transcript',
      transcriptType: 'partial',
      role: 'user',
      transcript: 'I want to ch—',
      call: { id: callId, customer: { number: '+14155553030' } },
    });
    const convs = await db
      .select({ id: schema.convConversations.id })
      .from(schema.convConversations)
      .where(
        and(
          eq(schema.convConversations.orgId, orgId),
          sql`${schema.convConversations.metadata}->>'vapiCallId' = ${callId}`,
        ),
      );
    expect(convs.length).toBe(0);
  });

  it('handles assistant-request: pre-creates conversation + contact, returns fail-soft body when Vapi API unreachable', async () => {
    const callId = 'call_vapi_inbound_first';
    const callerNumber = '+14155556060';
    const res = await postEvent({
      type: 'assistant-request',
      call: { id: callId, customer: { number: callerNumber } },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;

    const convs = await db
      .select({
        id: schema.convConversations.id,
        contactId: schema.convConversations.contactId,
        endUserId: schema.convConversations.endUserId,
        metadata: schema.convConversations.metadata,
      })
      .from(schema.convConversations)
      .where(
        and(
          eq(schema.convConversations.orgId, orgId),
          sql`${schema.convConversations.metadata}->>'vapiCallId' = ${callId}`,
        ),
      );
    expect(convs.length).toBe(1);
    expect(convs[0]!.contactId).toBeTruthy();
    expect(convs[0]!.endUserId).toBeTruthy();

    const contacts = await db
      .select({ phone: schema.convContacts.phone, endUserId: schema.convContacts.endUserId })
      .from(schema.convContacts)
      .where(
        and(
          eq(schema.convContacts.orgId, orgId),
          eq(schema.convContacts.phone, callerNumber),
        ),
      );
    expect(contacts.length).toBe(1);

    const endUsers = await db
      .select({ externalId: schema.endUsers.externalId, phone: schema.endUsers.phone })
      .from(schema.endUsers)
      .where(
        and(
          eq(schema.endUsers.orgId, orgId),
          eq(schema.endUsers.externalId, `phone:${callerNumber}`),
        ),
      );
    expect(endUsers.length).toBe(1);
    expect(endUsers[0]!.phone).toBe(callerNumber);

    expect(body).toEqual({});
  });

  it('assistant-request with no callId returns empty body and creates nothing new', async () => {
    const beforeRows = await db
      .select({ id: schema.convConversations.id })
      .from(schema.convConversations)
      .where(eq(schema.convConversations.orgId, orgId));
    const before = beforeRows.length;

    const res = await postEvent({
      type: 'assistant-request',
      call: { customer: { number: '+14155557070' } },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toEqual({});

    const afterRows = await db
      .select({ id: schema.convConversations.id })
      .from(schema.convConversations)
      .where(eq(schema.convConversations.orgId, orgId));
    expect(afterRows.length).toBe(before);
  });

  it('closes the conversation and stores artifact metadata on end-of-call-report', async () => {
    const callId = 'call_vapi_end';
    await postEvent({
      type: 'transcript',
      transcriptType: 'final',
      role: 'user',
      transcript: 'Goodbye',
      call: { id: callId, customer: { number: '+14155554040' } },
    });
    const r = await postEvent({
      type: 'end-of-call-report',
      endedReason: 'customer-ended-call',
      durationSeconds: 42,
      call: { id: callId },
      artifact: { recordingUrl: 'https://vapi.example/recordings/abc.mp3', transcript: 'full text' },
    });
    expect(r.status).toBe(204);

    const conv = await db
      .select()
      .from(schema.convConversations)
      .where(
        and(
          eq(schema.convConversations.orgId, orgId),
          sql`${schema.convConversations.metadata}->>'vapiCallId' = ${callId}`,
        ),
      )
      .limit(1);
    expect(conv[0]!.status).toBe('closed');
    const meta = conv[0]!.metadata;
    const vapiCall = meta.vapiCall as Record<string, unknown>;
    expect(vapiCall.recordingUrl).toBe('https://vapi.example/recordings/abc.mp3');
    expect(vapiCall.endedReason).toBe('customer-ended-call');
    expect(vapiCall.durationSeconds).toBe(42);
  });
});
