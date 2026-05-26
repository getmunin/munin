import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import type { AddressInfo } from 'node:net';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { buildApiKey, hashSecret, keyPrefix, verifyHmac } from '@getmunin/core';
import { createDb, runMigrations, schema } from '@getmunin/db';
import { sql } from 'drizzle-orm';
import { AppModule } from '../../app.module.ts';
import { WebhookWorker } from './webhook.worker.ts';

const TEST_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const skipReason = TEST_URL
  ? null
  : 'Set DATABASE_URL or TEST_DATABASE_URL to a Postgres URL to run webhook worker tests.';

interface ReceivedRequest {
  body: string;
  signature: string | null;
  event: string | null;
  deliveryId: string | null;
}

(skipReason ? describe.skip : describe)('WebhookWorker', () => {
  let app: INestApplication;
  let baseUrl: string;
  let db: ReturnType<typeof createDb>;
  let orgId: string;
  let adminKey: string;
  let receiver: Server;
  let received: ReceivedRequest[];
  let receiverShouldFail: boolean;
  let receiverUrl: string;

  beforeAll(async () => {
    process.env.MUNIN_AUTH_SECRET ??= 'test-secret-do-not-use-in-prod';
    process.env.MUNIN_KEY_PEPPER ??= 'test-pepper';
    process.env.MUNIN_EMBEDDING_PROVIDER = 'stub';
    process.env.MUNIN_MAIL_PROVIDER = 'stub';
    process.env.MUNIN_WEBHOOK_WORKER_DISABLED = '1';

    await runMigrations(TEST_URL!);

    const appUrl = TEST_URL!.replace(/(postgres(?:ql)?:\/\/)[^:@]+:[^@]+@/, '$1munin_app:munin_app@');
    process.env.DATABASE_URL = appUrl;

    db = createDb(TEST_URL!, { serviceRole: true });
    await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);

    const ts = Date.now();
    const [org] = await db
      .insert(schema.orgs)
      .values({ name: 'Webhook Org' })
      .returning();
    orgId = org!.id;

    adminKey = buildApiKey('admin');
    await db.insert(schema.apiKeys).values({
      orgId,
      type: 'admin',
      name: 'wh-admin',
      keyHash: hashSecret(adminKey),
      keyPrefix: keyPrefix(adminKey),
      scopes: ['*'],
    });

    received = [];
    receiverShouldFail = false;
    receiver = createServer((req: IncomingMessage, res: ServerResponse) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        received.push({
          body: Buffer.concat(chunks).toString('utf8'),
          signature: pickHeader(req, 'x-munin-signature'),
          event: pickHeader(req, 'x-munin-event'),
          deliveryId: pickHeader(req, 'x-munin-delivery-id'),
        });
        if (receiverShouldFail) {
          res.writeHead(500);
        } else {
          res.writeHead(200);
        }
        res.end('ok');
      });
    });
    await new Promise<void>((resolve) => receiver.listen(0, '127.0.0.1', resolve));
    const recvAddr = receiver.address() as AddressInfo;
    receiverUrl = `http://127.0.0.1:${recvAddr.port}`;

    app = await NestFactory.create(AppModule, { logger: false });
    await app.listen(0, '127.0.0.1');
    const server = app.getHttpServer() as { address(): AddressInfo | string | null };
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('expected AddressInfo');
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    if (app) await app.close();
    if (receiver) await new Promise<void>((resolve) => receiver.close(() => resolve()));
    if (db) {
      await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
      await db.delete(schema.orgs).where(sql`id = ${orgId}`);
    }
  });

  async function rest(method: string, path: string, body?: unknown): Promise<Response> {
    return fetch(`${baseUrl}${path}`, {
      method,
      headers: { Authorization: `Bearer ${adminKey}`, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  it('emits + delivers a signed conversation.created event', async () => {
    const create = await rest('POST', '/api/v1/webhooks', {
      url: receiverUrl,
      events: ['conversation.created', 'conversation.message.received'],
    });
    expect(create.status).toBe(201);
    const webhook = (await create.json()) as { id: string; secret: string };

    // Set up a chat channel so end-user start_conversation can pick one up.
    const [channel] = await db
      .insert(schema.convChannels)
      .values({ orgId, type: 'chat', vendor: 'munin', name: 'Web' })
      .returning();
    // Provision an end-user + token, then start a conversation through the
    // service layer directly (we already exercised the MCP path elsewhere).
    const [eu] = await db
      .insert(schema.endUsers)
      .values({ orgId, externalId: 'eu-1', name: 'Alice' })
      .returning();

    // Insert a conversation + first message via service-role db, then emit
    // the matching events through the WebhookDispatcher's persistence
    // layer using a quick dispatch step. Easier: create a conv via the
    // admin REST → MCP path. We'll just use the desk admin tool over MCP.
    // For simplicity here, do the inserts directly + create the events row.
    const [conv] = await db
      .insert(schema.convConversations)
      .values({
        orgId,
        displayId: 1,
        channelId: channel!.id,
        endUserId: eu!.id,
        status: 'open',
        lastMessageAt: new Date(),
      })
      .returning();
    const [event] = await db
      .insert(schema.events)
      .values({
        orgId,
        type: 'conversation.created',
        payload: { conversationId: conv!.id, channelId: channel!.id },
      })
      .returning();
    await db.insert(schema.webhookDeliveries).values({
      webhookId: webhook.id,
      eventId: event!.id,
      nextAttemptAt: new Date(),
    });

    received.length = 0;
    const worker = app.get(WebhookWorker);
    const result = await worker.tick();
    expect(result.delivered).toBe(1);
    expect(received).toHaveLength(1);
    const delivery = received[0]!;
    expect(delivery.event).toBe('conversation.created');
    expect(delivery.signature).toMatch(/^sha256=/);

    // Signature verifies against the secret that's set on the webhook.
    const sigOnly = delivery.signature!.replace(/^sha256=/, '');
    expect(verifyHmac(delivery.body, webhook.secret, sigOnly)).toBe(true);

    const parsed = JSON.parse(delivery.body) as {
      type: string;
      payload: { conversationId: string };
    };
    expect(parsed.type).toBe('conversation.created');
    expect(parsed.payload.conversationId).toBe(conv!.id);
  }, 30_000);

  it('retries on non-2xx and stops after MAX_ATTEMPTS', async () => {
    const create = await rest('POST', '/api/v1/webhooks', {
      url: receiverUrl,
      events: ['failure.test'],
    });
    const webhook = (await create.json()) as { id: string };

    const [event] = await db
      .insert(schema.events)
      .values({
        orgId,
        type: 'failure.test',
        payload: { foo: 'bar' },
      })
      .returning();
    const [delivery] = await db
      .insert(schema.webhookDeliveries)
      .values({
        webhookId: webhook.id,
        eventId: event!.id,
        nextAttemptAt: new Date(),
      })
      .returning();

    received.length = 0;
    receiverShouldFail = true;
    try {
      const worker = app.get(WebhookWorker);
      // First attempt: should record an error and schedule a retry.
      const r1 = await worker.tick();
      expect(r1.delivered).toBe(0);
      expect(r1.failed).toBe(1);
      const [afterFirst] = await db
        .select()
        .from(schema.webhookDeliveries)
        .where(sql`id = ${delivery!.id}`);
      expect(afterFirst!.attempt).toBe(1);
      expect(afterFirst!.deliveredAt).toBeNull();
      expect(afterFirst!.error).toMatch(/non-2xx: 500/);
      expect(afterFirst!.nextAttemptAt).toBeInstanceOf(Date);

      // Force the row to "due" again and run 4 more times to exhaust attempts.
      for (let i = 0; i < 4; i++) {
        await db
          .update(schema.webhookDeliveries)
          .set({ nextAttemptAt: new Date() })
          .where(sql`id = ${delivery!.id}`);
        await worker.tick();
      }
      const [final] = await db
        .select()
        .from(schema.webhookDeliveries)
        .where(sql`id = ${delivery!.id}`);
      expect(final!.attempt).toBe(5);
      expect(final!.deliveredAt).not.toBeNull();
      expect(final!.nextAttemptAt).toBeNull();
    } finally {
      receiverShouldFail = false;
    }
  }, 30_000);
});

function pickHeader(req: IncomingMessage, name: string): string | null {
  const v = req.headers[name];
  if (Array.isArray(v)) return v[0] ?? null;
  return typeof v === 'string' ? v : null;
}
