import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import type { AddressInfo } from 'node:net';
import { WebSocket } from 'ws';
import { buildApiKey, hashSecret } from '@getmunin/core';
import { createDb, runMigrations, schema } from '@getmunin/db';
import { sql } from 'drizzle-orm';
import { AppModule } from '../app.module.ts';

const TEST_URL = process.env.TEST_DATABASE_URL;
const skipReason = TEST_URL
  ? null
  : 'Set TEST_DATABASE_URL to a Postgres URL to run end-user WS integration tests.';

(skipReason ? describe.skip : describe)('Realtime end_user_agent subscription gate', () => {
  let app: INestApplication;
  let wsBase: string;
  let db: ReturnType<typeof createDb>;
  let orgId: string;
  let channelId: string;
  let endUserAId: string;
  let endUserBId: string;
  let contactBId: string;
  let conversationAId: string;
  let conversationBId: string;
  let tokenA: string;

  beforeAll(async () => {
    process.env.MUNIN_AUTH_SECRET ??= 'test-secret-do-not-use-in-prod-it-must-be-32-chars';
    process.env.MUNIN_KEY_PEPPER ??= 'test-pepper';
    process.env.MUNIN_EMBEDDING_PROVIDER = 'stub';
    process.env.MUNIN_MAIL_PROVIDER = 'stub';
    process.env.MUNIN_WEBHOOK_WORKER_DISABLED = '1';
    process.env.MUNIN_CMS_SCHEDULE_WORKER_DISABLED = '1';

    await runMigrations(TEST_URL!);
    const appUrl = TEST_URL!.replace(
      /(postgres(?:ql)?:\/\/)[^:@]+:[^@]+@/,
      '$1munin_app:munin_app@',
    );
    process.env.DATABASE_URL = appUrl;

    db = createDb(TEST_URL!, { serviceRole: true });
    await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);

    const [org] = await db.insert(schema.orgs).values({ name: 'EU RT Gate Org' }).returning();
    orgId = org!.id;

    const [chan] = await db
      .insert(schema.convChannels)
      .values({ orgId, type: 'chat', vendor: 'munin', name: 'Web chat', config: {} })
      .returning();
    channelId = chan!.id;

    const [euA] = await db
      .insert(schema.endUsers)
      .values({ orgId, externalId: 'eu-a', name: 'A' })
      .returning();
    const [euB] = await db
      .insert(schema.endUsers)
      .values({ orgId, externalId: 'eu-b', name: 'B' })
      .returning();
    endUserAId = euA!.id;
    endUserBId = euB!.id;

    const [ctcA] = await db
      .insert(schema.convContacts)
      .values({ orgId, endUserId: endUserAId, name: 'A' })
      .returning();
    const [ctcB] = await db
      .insert(schema.convContacts)
      .values({ orgId, endUserId: endUserBId, name: 'B' })
      .returning();
    contactBId = ctcB!.id;

    const [convA] = await db
      .insert(schema.convConversations)
      .values({
        orgId,
        displayId: 1,
        channelId,
        contactId: ctcA!.id,
        endUserId: endUserAId,
      })
      .returning();
    const [convB] = await db
      .insert(schema.convConversations)
      .values({
        orgId,
        displayId: 2,
        channelId,
        contactId: ctcB!.id,
        endUserId: endUserBId,
      })
      .returning();
    conversationAId = convA!.id;
    conversationBId = convB!.id;

    tokenA = buildApiKey('dlg');
    await db.insert(schema.tokens).values({
      orgId,
      type: 'delegated_end_user',
      tokenHash: hashSecret(tokenA),
      scopes: ['conv:read', 'conv:write'],
      audiences: ['self_service'],
      endUserId: endUserAId,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });

    app = await NestFactory.create(AppModule, { logger: false });
    await app.listen(0, '127.0.0.1');
    const server = app.getHttpServer() as { address(): AddressInfo | string | null };
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('expected AddressInfo');
    wsBase = `ws://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    if (app) await app.close();
    if (db) {
      await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
      await db.delete(schema.orgs).where(sql`id = ${orgId}`);
    }
  });

  function connectWs(token: string): WebSocket {
    return new WebSocket(`${wsBase}/v1/realtime`, ['bearer', token]);
  }

  async function waitForOpen(ws: WebSocket, timeoutMs = 1500): Promise<void> {
    if (ws.readyState === WebSocket.OPEN) return;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`ws never opened within ${timeoutMs}ms`)),
        timeoutMs,
      );
      ws.once('open', () => {
        clearTimeout(timer);
        resolve();
      });
      ws.once('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
      ws.once('unexpected-response', (_req, res) => {
        clearTimeout(timer);
        reject(new Error(`upgrade rejected: ${res.statusCode}`));
      });
    });
  }

  async function emit(type: string, payload: Record<string, unknown>): Promise<void> {
    const json = JSON.stringify({
      id: `evt_${Math.random().toString(36).slice(2)}`,
      org_id: orgId,
      type,
      actor_id: null,
      correlation_id: null,
      hop_count: 0,
      payload,
      created_at: new Date().toISOString(),
    });
    await db.execute(sql`SELECT pg_notify('munin_events', ${json})`);
  }

  function nextEvent(
    ws: WebSocket,
    predicate: (msg: { type: string; channel?: string; event?: { type: string } }) => boolean,
    timeoutMs = 1500,
  ): Promise<{ channel?: string; event?: { type: string; payload?: Record<string, unknown> } }> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`no matching event within ${timeoutMs}ms`)),
        timeoutMs,
      );
      const onMessage = (data: WebSocket.RawData) => {
        try {
          const text = decodeWsData(data);
          const msg = JSON.parse(text) as {
            type: string;
            channel?: string;
            event?: { type: string; payload?: Record<string, unknown> };
          };
          if (predicate(msg)) {
            clearTimeout(timer);
            ws.off('message', onMessage);
            resolve(msg);
          }
        } catch {
          // ignore
        }
      };
      ws.on('message', onMessage);
    });
  }

  function expectNoEvent(
    ws: WebSocket,
    predicate: (msg: { type: string; channel?: string }) => boolean,
    withinMs = 600,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        ws.off('message', onMessage);
        resolve();
      }, withinMs);
      const onMessage = (data: WebSocket.RawData) => {
        try {
          const msg = JSON.parse(decodeWsData(data)) as { type: string; channel?: string };
          if (predicate(msg)) {
            clearTimeout(timer);
            ws.off('message', onMessage);
            reject(new Error(`unexpected event: ${JSON.stringify(msg)}`));
          }
        } catch {
          // ignore
        }
      };
      ws.on('message', onMessage);
    });
  }

  it('rejects org-wide subscriptions for delegated end-user tokens', async () => {
    const ws = connectWs(tokenA);
    await waitForOpen(ws);
    try {
      ws.send(JSON.stringify({ type: 'subscribe', channel: 'org' }));
      await new Promise((r) => setTimeout(r, 100));

      const noEventP = expectNoEvent(ws, (m) => m.type === 'event', 600);
      await emit('conversation.created', {
        conversationId: conversationBId,
        channelId,
      });
      await noEventP;
    } finally {
      ws.terminate();
    }
  });

  it('rejects subscriptions to another end-user\'s conversation', async () => {
    const ws = connectWs(tokenA);
    await waitForOpen(ws);
    try {
      ws.send(
        JSON.stringify({ type: 'subscribe', channel: 'conversation', id: conversationBId }),
      );
      await new Promise((r) => setTimeout(r, 100));

      const noEventP = expectNoEvent(
        ws,
        (m) => m.type === 'event' && m.channel === `conversation:${conversationBId}`,
        600,
      );
      await emit('conversation.message.received', {
        conversationId: conversationBId,
        messageId: 'msg_fake',
        authorType: 'end_user',
        internal: false,
      });
      await noEventP;
    } finally {
      ws.terminate();
    }
  });

  it('rejects subscriptions to another end-user\'s contact channel', async () => {
    const ws = connectWs(tokenA);
    await waitForOpen(ws);
    try {
      ws.send(JSON.stringify({ type: 'subscribe', channel: 'contact', id: contactBId }));
      await new Promise((r) => setTimeout(r, 100));

      const noEventP = expectNoEvent(
        ws,
        (m) => m.type === 'event' && m.channel === `contact:${contactBId}`,
        600,
      );
      await emit('contact.updated', { contactId: contactBId });
      await noEventP;
    } finally {
      ws.terminate();
    }
  });

  it('accepts subscriptions to the end-user\'s own conversation', async () => {
    const ws = connectWs(tokenA);
    await waitForOpen(ws);
    try {
      ws.send(
        JSON.stringify({ type: 'subscribe', channel: 'conversation', id: conversationAId }),
      );
      await new Promise((r) => setTimeout(r, 150));

      const evP = nextEvent(
        ws,
        (m) =>
          m.type === 'event' &&
          m.channel === `conversation:${conversationAId}` &&
          m.event?.type === 'conversation.message.received',
      );
      await emit('conversation.message.received', {
        conversationId: conversationAId,
        messageId: 'msg_real',
        authorType: 'end_user',
        internal: false,
      });
      const ev = await evP;
      expect(ev.event!.type).toBe('conversation.message.received');
    } finally {
      ws.terminate();
    }
  });
});

function decodeWsData(data: WebSocket.RawData): string {
  if (typeof data === 'string') return data;
  if (Buffer.isBuffer(data)) return data.toString('utf8');
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
  return Buffer.from(data).toString('utf8');
}
