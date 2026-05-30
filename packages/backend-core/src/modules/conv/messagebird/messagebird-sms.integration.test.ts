import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import type { AddressInfo } from 'node:net';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { createDb, runMigrations, schema } from '@getmunin/db';
import { sql, eq, and } from 'drizzle-orm';
import { AppModule } from '../../../app.module.ts';
import { createApp } from '../../../bootstrap-app.ts';
import { MessageBirdSmsService } from './messagebird-sms.service.ts';
import { ActorIdentity, withContext, type RequestContext } from '@getmunin/core';

const TEST_URL = process.env.TEST_DATABASE_URL;
const skipReason = TEST_URL
  ? null
  : 'Set TEST_DATABASE_URL to a Postgres URL to run MessageBird SMS integration tests.';

(skipReason ? describe.skip : describe)('MessageBird SMS inbound webhook integration', () => {
  let app: INestApplication;
  let baseUrl: string;
  let db: ReturnType<typeof createDb>;
  let orgId: string;
  let channelId: string;
  const ACCESS_KEY = 'mb-access-key-it';
  const SIGNING_KEY = 'mb-signing-key-it';
  const ORIGINATOR = '31612345678';

  beforeAll(async () => {
    process.env.MUNIN_AUTH_SECRET ??= 'test-secret-do-not-use-in-prod-it-must-be-32-chars';
    process.env.MUNIN_KEY_PEPPER ??= 'test-pepper';
    process.env.MUNIN_ENCRYPTION_KEY ??=
      'dGVzdC1lbmNyeXB0aW9uLWtleS1tdXN0LWJlLWxvbmctZW5vdWdoLWZvci1wZ2NyeXB0bw==';
    process.env.MUNIN_EMBEDDING_PROVIDER = 'stub';
    process.env.MUNIN_MAIL_PROVIDER = 'stub';
    process.env.MUNIN_STORAGE_PROVIDER = 'local';
    process.env.MUNIN_STORAGE_LOCAL_PATH = '/tmp/munin-messagebird-test';
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
      .values({ name: 'MessageBird IT Org' })
      .returning();
    orgId = org!.id;

    app = await createApp(AppModule, { logger: false });
    await app.listen(0, '127.0.0.1');
    const server = app.getHttpServer() as { address(): AddressInfo | string | null };
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('expected AddressInfo');
    baseUrl = `http://127.0.0.1:${address.port}`;

    const svc = app.get(MessageBirdSmsService);
    const actor = new ActorIdentity('user', 'usr_test', orgId, ['*'], ['admin']);
    const channel = await runAsActor(actor, () =>
      svc.createChannel({
        name: 'MessageBird main',
        config: {
          accessKey: ACCESS_KEY,
          signingKey: SIGNING_KEY,
          originator: ORIGINATOR,
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

  function b64url(buf: Buffer): string {
    return buf.toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  }

  function buildJwt(urlForSig: string, rawBody: Buffer): string {
    const now = Math.floor(Date.now() / 1000);
    const header = { alg: 'HS256', typ: 'JWT' };
    const payload: Record<string, unknown> = {
      iss: 'MessageBird',
      nbf: now - 60,
      exp: now + 300,
      jti: randomUUID(),
      url_hash: createHash('sha256').update(urlForSig, 'utf8').digest('hex'),
      payload_hash:
        rawBody.length > 0 ? createHash('sha256').update(rawBody).digest('hex') : null,
    };
    const headerB64 = b64url(Buffer.from(JSON.stringify(header)));
    const payloadB64 = b64url(Buffer.from(JSON.stringify(payload)));
    const signature = createHmac('sha256', SIGNING_KEY)
      .update(`${headerB64}.${payloadB64}`, 'utf8')
      .digest();
    return `${headerB64}.${payloadB64}.${b64url(signature)}`;
  }

  async function postWebhook(params: Record<string, string>, urlForSig: string): Promise<Response> {
    const body = new URLSearchParams(params).toString();
    const rawBody = Buffer.from(body);
    const token = buildJwt(urlForSig, rawBody);
    return fetch(`${baseUrl}/v1/conversations/channels/${channelId}/webhook`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'messagebird-signature-jwt': token,
        'x-forwarded-proto': 'https',
        'x-forwarded-host': 'munin.example',
      },
      body,
    });
  }

  it('accepts a JWT-signed inbound SMS and creates a conv_messages row', async () => {
    const url = `https://munin.example/v1/conversations/channels/${channelId}/webhook`;
    const params = {
      id: 'mb_inbound_0001',
      originator: '14155551212',
      recipient: ORIGINATOR,
      body: 'Hi from MessageBird',
      createdDatetime: new Date().toISOString(),
    };
    const res = await postWebhook(params, url);
    expect(res.status).toBe(200);

    const rows = await db
      .select({
        id: schema.convMessages.id,
        body: schema.convMessages.body,
        metadata: schema.convMessages.metadata,
      })
      .from(schema.convMessages)
      .where(
        and(
          eq(schema.convMessages.orgId, orgId),
          sql`${schema.convMessages.metadata}->>'providerMessageId' = ${params.id}`,
        ),
      );
    expect(rows.length).toBe(1);
    expect(rows[0]!.body).toBe(params.body);
  });

  it('rejects a tampered JWT', async () => {
    const url = `https://munin.example/v1/conversations/channels/${channelId}/webhook`;
    const params = {
      id: 'mb_inbound_bad',
      originator: '14155551313',
      recipient: ORIGINATOR,
      body: 'tampered',
      createdDatetime: new Date().toISOString(),
    };
    const body = new URLSearchParams(params).toString();
    const res = await fetch(`${baseUrl}/v1/conversations/channels/${channelId}/webhook`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'messagebird-signature-jwt': 'not.a.jwt',
        'x-forwarded-proto': 'https',
        'x-forwarded-host': 'munin.example',
      },
      body,
    });
    expect(res.status).toBe(401);
  });

  it('dedupes duplicate message ids', async () => {
    const url = `https://munin.example/v1/conversations/channels/${channelId}/webhook`;
    const params = {
      id: 'mb_inbound_dedup',
      originator: '14155552222',
      recipient: ORIGINATOR,
      body: 'first delivery',
      createdDatetime: new Date().toISOString(),
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
          sql`${schema.convMessages.metadata}->>'providerMessageId' = ${params.id}`,
        ),
      );
    expect(rows.length).toBe(1);
  });

  it('updates conv_message_deliveries on a status report', async () => {
    const conv = await db
      .select({ id: schema.convConversations.id })
      .from(schema.convConversations)
      .where(eq(schema.convConversations.orgId, orgId))
      .limit(1);
    const conversationId = conv[0]!.id;
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
    const messageBirdId = 'mb_outbound_status_track_001';
    await db.insert(schema.convMessageDeliveries).values({
      orgId,
      messageId: msg!.id,
      channelId,
      status: 'sent',
      attempt: 1,
      sentAt: new Date(),
      messageIdHeader: messageBirdId,
      nextAttemptAt: null,
    });

    const url = `https://munin.example/v1/conversations/channels/${channelId}/webhook`;
    const params = {
      id: messageBirdId,
      recipient: '14155553333',
      status: 'delivery_failed',
      statusDatetime: new Date().toISOString(),
      statusReason: 'unknown subscriber',
    };
    const res = await postWebhook(params, url);
    expect(res.status).toBe(200);

    const updated = await db
      .select()
      .from(schema.convMessageDeliveries)
      .where(eq(schema.convMessageDeliveries.messageIdHeader, messageBirdId))
      .limit(1);
    expect(updated[0]!.status).toBe('failed');
    expect(updated[0]!.error).toMatch(/messagebird_delivery_failed/);
  });
});
