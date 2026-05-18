import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import type { AddressInfo } from 'node:net';
import { createHmac } from 'node:crypto';
import { createDb, runMigrations, schema } from '@getmunin/db';
import { sql, eq, and } from 'drizzle-orm';
import { AppModule } from '../../../app.module.js';
import { createApp } from '../../../bootstrap-app.js';
import { TwilioSmsService } from './twilio-sms.service.js';
import { ActorIdentity, withContext, type RequestContext } from '@getmunin/core';
import { randomUUID } from 'node:crypto';

const TEST_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const skipReason = TEST_URL
  ? null
  : 'Set DATABASE_URL or TEST_DATABASE_URL to a Postgres URL to run Twilio SMS integration tests.';

(skipReason ? describe.skip : describe)('Twilio SMS inbound webhook integration', () => {
  let app: INestApplication;
  let baseUrl: string;
  let db: ReturnType<typeof createDb>;
  let orgId: string;
  let channelId: string;
  const AUTH_TOKEN = 'test-auth-token-for-twilio-it';
  const ACCOUNT_SID = 'AC00000000000000000000000000000000';
  const FROM_NUMBER = '+15005550006';

  beforeAll(async () => {
    process.env.MUNIN_AUTH_SECRET ??= 'test-secret-do-not-use-in-prod-it-must-be-32-chars';
    process.env.MUNIN_KEY_PEPPER ??= 'test-pepper';
    process.env.MUNIN_ENCRYPTION_KEY ??=
      'dGVzdC1lbmNyeXB0aW9uLWtleS1tdXN0LWJlLWxvbmctZW5vdWdoLWZvci1wZ2NyeXB0bw==';
    process.env.MUNIN_EMBEDDING_PROVIDER = 'stub';
    process.env.MUNIN_MAIL_PROVIDER = 'stub';
    process.env.MUNIN_STORAGE_PROVIDER = 'local';
    process.env.MUNIN_STORAGE_LOCAL_PATH = '/tmp/munin-twilio-test';
    process.env.MUNIN_STORAGE_LOCAL_BASE_URL = 'http://127.0.0.1:0/static/assets';
    process.env.MUNIN_WEBHOOK_WORKER_DISABLED = '1';
    process.env.MUNIN_CMS_SCHEDULE_WORKER_DISABLED = '1';

    await runMigrations(TEST_URL!);
    const appUrl = TEST_URL!.replace(/(postgres(?:ql)?:\/\/)[^:@]+:[^@]+@/, '$1munin_app:munin_app@');
    process.env.DATABASE_URL = appUrl;

    db = createDb(TEST_URL!, { serviceRole: true });
    await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);

    const ts = Date.now();
    const [org] = await db
      .insert(schema.orgs)
      .values({ name: 'Twilio IT Org', slug: `twilio-it-${ts}` })
      .returning();
    orgId = org!.id;

    app = await createApp(AppModule, { logger: false });
    await app.listen(0, '127.0.0.1');
    const server = app.getHttpServer() as { address(): AddressInfo | string | null };
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('expected AddressInfo');
    baseUrl = `http://127.0.0.1:${address.port}`;

    const twilio = app.get(TwilioSmsService);
    const actor = new ActorIdentity('user', 'usr_test', orgId, ['*'], ['admin']);
    const channel = await runAsActor(actor, () =>
      twilio.createChannel({
        name: 'Twilio main',
        config: {
          accountSid: ACCOUNT_SID,
          authToken: AUTH_TOKEN,
          fromNumber: FROM_NUMBER,
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

  function signRequest(url: string, params: Record<string, string>): string {
    const keys = Object.keys(params).sort();
    let data = url;
    for (const k of keys) data += k + params[k];
    return createHmac('sha1', AUTH_TOKEN).update(data, 'utf8').digest('base64');
  }

  async function postWebhook(params: Record<string, string>, urlForSig: string): Promise<Response> {
    const body = new URLSearchParams(params);
    const signature = signRequest(urlForSig, params);
    return fetch(`${baseUrl}/api/v1/conversations/channels/${channelId}/webhook`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'x-twilio-signature': signature,
        'x-forwarded-proto': 'https',
        'x-forwarded-host': 'munin.example',
      },
      body: body.toString(),
    });
  }

  it('accepts a signed inbound SMS and creates a conv_messages row', async () => {
    const url = `https://munin.example/api/v1/conversations/channels/${channelId}/webhook`;
    const params = {
      AccountSid: ACCOUNT_SID,
      MessageSid: 'SM_inbound_0001',
      From: '+14155551212',
      To: FROM_NUMBER,
      Body: 'Hi, account locked, help?',
      NumMedia: '0',
    };
    const res = await postWebhook(params, url);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('<Response>');

    const rows = await db
      .select({
        id: schema.convMessages.id,
        body: schema.convMessages.body,
        metadata: schema.convMessages.metadata,
        conversationId: schema.convMessages.conversationId,
      })
      .from(schema.convMessages)
      .where(
        and(
          eq(schema.convMessages.orgId, orgId),
          sql`${schema.convMessages.metadata}->>'providerMessageId' = ${params.MessageSid}`,
        ),
      );
    expect(rows.length).toBe(1);
    expect(rows[0]!.body).toBe(params.Body);
  });

  it('rejects an invalid signature', async () => {
    const url = `https://munin.example/api/v1/conversations/channels/${channelId}/webhook`;
    const params = {
      AccountSid: ACCOUNT_SID,
      MessageSid: 'SM_inbound_bad',
      From: '+14155551313',
      To: FROM_NUMBER,
      Body: 'tampered',
    };
    const res = await fetch(`${baseUrl}/api/v1/conversations/channels/${channelId}/webhook`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'x-twilio-signature': 'bogus-signature',
        'x-forwarded-proto': 'https',
        'x-forwarded-host': 'munin.example',
      },
      body: new URLSearchParams(params).toString(),
    });
    expect(res.status).toBe(401);
    const rows = await db
      .select({ id: schema.convMessages.id })
      .from(schema.convMessages)
      .where(
        and(
          eq(schema.convMessages.orgId, orgId),
          sql`${schema.convMessages.metadata}->>'providerMessageId' = ${params.MessageSid}`,
        ),
      );
    expect(rows.length).toBe(0);
  });

  it('dedupes duplicate MessageSid', async () => {
    const url = `https://munin.example/api/v1/conversations/channels/${channelId}/webhook`;
    const params = {
      AccountSid: ACCOUNT_SID,
      MessageSid: 'SM_inbound_dedup',
      From: '+14155552222',
      To: FROM_NUMBER,
      Body: 'first delivery',
      NumMedia: '0',
    };
    const res1 = await postWebhook(params, url);
    expect(res1.status).toBe(200);
    const res2 = await postWebhook(params, url);
    expect(res2.status).toBe(200);
    const rows = await db
      .select({ id: schema.convMessages.id })
      .from(schema.convMessages)
      .where(
        and(
          eq(schema.convMessages.orgId, orgId),
          sql`${schema.convMessages.metadata}->>'providerMessageId' = ${params.MessageSid}`,
        ),
      );
    expect(rows.length).toBe(1);
  });

  it('updates conv_message_deliveries on a status callback', async () => {
    const conversationRows = await db
      .select({ id: schema.convConversations.id })
      .from(schema.convConversations)
      .where(eq(schema.convConversations.orgId, orgId))
      .limit(1);
    const conversationId = conversationRows[0]!.id;
    const [msg] = await db
      .insert(schema.convMessages)
      .values({
        orgId,
        conversationId,
        authorType: 'agent',
        authorId: 'agent_test',
        body: 'reply from agent',
      })
      .returning();
    const sidProvider = 'SM_outbound_status_track_0001';
    await db.insert(schema.convMessageDeliveries).values({
      orgId,
      messageId: msg!.id,
      channelId,
      status: 'sent',
      attempt: 1,
      sentAt: new Date(),
      messageIdHeader: sidProvider,
      nextAttemptAt: null,
    });

    const url = `https://munin.example/api/v1/conversations/channels/${channelId}/webhook`;
    const params = {
      AccountSid: ACCOUNT_SID,
      MessageSid: sidProvider,
      MessageStatus: 'failed',
      ErrorCode: '30003',
      ErrorMessage: 'unreachable destination',
    };
    const res = await postWebhook(params, url);
    expect(res.status).toBe(200);

    const updated = await db
      .select()
      .from(schema.convMessageDeliveries)
      .where(eq(schema.convMessageDeliveries.messageIdHeader, sidProvider))
      .limit(1);
    expect(updated[0]!.status).toBe('failed');
    expect(updated[0]!.error).toMatch(/twilio_30003/);
  });
});
