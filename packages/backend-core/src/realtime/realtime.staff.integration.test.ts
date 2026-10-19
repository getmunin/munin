import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import type { AddressInfo } from 'node:net';
import { createHash, randomBytes } from 'node:crypto';
import { WebSocket } from 'ws';
import { CredentialResolver, buildApiKey, hashSecret, keyPrefix } from '@getmunin/core';
import { createDb, runMigrations, schema } from '@getmunin/db';
import { sql } from 'drizzle-orm';
import { AppModule } from '../app.module.ts';

const TEST_URL = process.env.TEST_DATABASE_URL;
const skipReason = TEST_URL
  ? null
  : 'Set TEST_DATABASE_URL to a Postgres URL to run staff WS integration tests.';

const DASHBOARD_ORIGIN = 'http://localhost:3000';

interface Frame {
  type: string;
  channel?: string;
  event?: { type: string; payload?: Record<string, unknown> };
}

(skipReason ? describe.skip : describe)('Realtime staff subscription gate', () => {
  let app: INestApplication;
  let wsBase: string;
  let db: ReturnType<typeof createDb>;
  let orgId: string;
  let fullAdminKey: string;
  let narrowAdminKey: string;
  let ownerSession: string;
  let memberSession: string;
  let oauthAccessToken: string;

  beforeAll(async () => {
    process.env.MUNIN_AUTH_SECRET ??= 'test-secret-do-not-use-in-prod-it-must-be-32-chars';
    process.env.MUNIN_KEY_PEPPER ??= 'test-pepper';
    process.env.MUNIN_EMBEDDING_PROVIDER = 'stub';
    process.env.MUNIN_MAIL_PROVIDER = 'stub';
    process.env.MUNIN_WEBHOOK_WORKER_DISABLED = '1';
    process.env.MUNIN_CMS_SCHEDULE_WORKER_DISABLED = '1';
    process.env.MUNIN_CORS_ORIGINS = DASHBOARD_ORIGIN;

    await runMigrations(TEST_URL!);
    const appUrl = TEST_URL!.replace(
      /(postgres(?:ql)?:\/\/)[^:@]+:[^@]+@/,
      '$1munin_app:munin_app@',
    );
    process.env.DATABASE_URL = appUrl;

    db = createDb(TEST_URL!, { serviceRole: true });
    await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);

    const label = `rt-staff-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const [org] = await db.insert(schema.orgs).values({ name: 'Staff RT Gate Org' }).returning();
    orgId = org!.id;

    fullAdminKey = buildApiKey('admin');
    narrowAdminKey = buildApiKey('admin');
    await db.insert(schema.apiKeys).values([
      {
        orgId,
        type: 'admin',
        name: 'rt-staff-full',
        keyHash: hashSecret(fullAdminKey),
        keyPrefix: keyPrefix(fullAdminKey),
        scopes: ['*'],
      },
      {
        orgId,
        type: 'admin',
        name: 'rt-staff-narrow',
        keyHash: hashSecret(narrowAdminKey),
        keyPrefix: keyPrefix(narrowAdminKey),
        scopes: ['kb:read'],
      },
    ]);

    const [owner] = await db
      .insert(schema.users)
      .values({ email: `${label}-owner@example.com`, name: 'Kari Nordmann' })
      .returning();
    const [member] = await db
      .insert(schema.users)
      .values({ email: `${label}-member@example.com`, name: 'Ola Nordmann' })
      .returning();
    await db.insert(schema.orgMembers).values([
      { orgId, userId: owner!.id, role: 'owner', isDefault: true },
      { orgId, userId: member!.id, role: 'member', isDefault: true },
    ]);

    ownerSession = randomBytes(24).toString('hex');
    memberSession = randomBytes(24).toString('hex');
    await db.insert(schema.sessions).values([
      { userId: owner!.id, token: ownerSession, expiresAt: new Date(Date.now() + 60 * 60 * 1000) },
      { userId: member!.id, token: memberSession, expiresAt: new Date(Date.now() + 60 * 60 * 1000) },
    ]);

    const clientId = `client-${label}`;
    await db.insert(schema.oauthClient).values({
      clientId,
      name: 'Acme MCP client',
      redirectUris: ['https://client.example/cb'],
    });
    oauthAccessToken = `oat-${randomBytes(24).toString('hex')}`;
    await db.insert(schema.oauthAccessToken).values({
      token: createHash('sha256').update(oauthAccessToken).digest('base64url'),
      clientId,
      userId: owner!.id,
      referenceId: orgId,
      scopes: ['mcp:admin'],
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

  function connectWithToken(token: string): WebSocket {
    return new WebSocket(`${wsBase}/v1/realtime`, ['bearer', token]);
  }

  function connectWithSession(token: string): WebSocket {
    return new WebSocket(`${wsBase}/v1/realtime?orgId=${encodeURIComponent(orgId)}`, {
      headers: {
        Origin: DASHBOARD_ORIGIN,
        Cookie: `better-auth.session_token=${token}.placeholder-sig`,
      },
    });
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
        const reason = res.headers['x-munin-error'];
        const code = Array.isArray(reason) ? reason[0] : reason;
        reject(new Error(`upgrade rejected: ${res.statusCode} ${code ?? 'no-reason'}`));
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

  function collectFrames(ws: WebSocket): Frame[] {
    const frames: Frame[] = [];
    ws.on('message', (data) => {
      const frame = JSON.parse(decodeWsData(data)) as Frame;
      if (frame.type === 'event') frames.push(frame);
    });
    return frames;
  }

  async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (!predicate()) {
      if (Date.now() > deadline) throw new Error(`condition not met within ${timeoutMs}ms`);
      await new Promise((r) => setTimeout(r, 25));
    }
  }

  async function emitAdminOnlyEvents(): Promise<void> {
    await emit('api_key.minted', { apiKeyId: 'key_1', name: 'ci' });
    await emit('crm.contact.created', { contactId: 'ctc_1', email: 'lead@example.com' });
    await emit('end_user.created', { endUserId: 'eu_1', externalId: 'ext-1', email: 'visitor@example.com' });
    await emit('kb.document.created', { documentId: 'doc_1', spaceId: 'spc_1' });
  }

  it('refuses an OAuth access token minted for /mcp with 401', async () => {
    const resolved = await new CredentialResolver(db).resolveBearerToken(oauthAccessToken);
    expect(resolved?.actor.orgId).toBe(orgId);
    expect(resolved?.audience).toBeTruthy();

    const ws = connectWithToken(oauthAccessToken);
    await expect(waitForOpen(ws)).rejects.toThrow(/upgrade rejected: 401 unauthorized/);
    ws.terminate();
  });

  it('refuses a narrow-scope admin key with 403', async () => {
    const ws = connectWithToken(narrowAdminKey);
    await expect(waitForOpen(ws)).rejects.toThrow(/upgrade rejected: 403 realtime_forbidden/);
    ws.terminate();
  });

  it('streams every org event to an unrestricted admin key', async () => {
    const ws = connectWithToken(fullAdminKey);
    await waitForOpen(ws);
    try {
      const frames = collectFrames(ws);
      ws.send(JSON.stringify({ type: 'subscribe', channel: 'org' }));
      await new Promise((r) => setTimeout(r, 150));
      await emit('api_key.minted', { apiKeyId: 'key_full', name: 'ci' });
      await waitFor(() => frames.some((f) => f.event?.type === 'api_key.minted'));
    } finally {
      ws.terminate();
    }
  });

  it('streams every org event to an owner session', async () => {
    const ws = connectWithSession(ownerSession);
    await waitForOpen(ws);
    try {
      const frames = collectFrames(ws);
      ws.send(JSON.stringify({ type: 'subscribe', channel: 'org' }));
      await new Promise((r) => setTimeout(r, 150));
      await emit('crm.contact.created', { contactId: 'ctc_owner', email: 'lead@example.com' });
      await waitFor(() => frames.some((f) => f.event?.type === 'crm.contact.created'));
    } finally {
      ws.terminate();
    }
  });

  it('gives a member session conversation events on the org channel and nothing else', async () => {
    const ws = connectWithSession(memberSession);
    await waitForOpen(ws);
    try {
      const frames = collectFrames(ws);
      ws.send(JSON.stringify({ type: 'subscribe', channel: 'org' }));
      await new Promise((r) => setTimeout(r, 150));

      await emitAdminOnlyEvents();
      await emit('conversation.message.received', {
        conversationId: 'cnv_member',
        messageId: 'msg_member',
        authorType: 'end_user',
        internal: false,
      });
      await waitFor(() => frames.some((f) => f.event?.type === 'conversation.message.received'));
      await new Promise((r) => setTimeout(r, 200));

      expect(frames.map((f) => f.event?.type)).toEqual(['conversation.message.received']);
    } finally {
      ws.terminate();
    }
  });

  it('lets a member follow one conversation but not a contact channel', async () => {
    const ws = connectWithSession(memberSession);
    await waitForOpen(ws);
    try {
      const frames = collectFrames(ws);
      ws.send(JSON.stringify({ type: 'subscribe', channel: 'conversation', id: 'cnv_followed' }));
      ws.send(JSON.stringify({ type: 'subscribe', channel: 'contact', id: 'ctc_followed' }));
      await new Promise((r) => setTimeout(r, 150));

      await emit('crm.contact.updated', { contactId: 'ctc_followed', email: 'lead@example.com' });
      await emit('conversation.draft_requested', {
        conversationId: 'cnv_followed',
        note: 'keep it short',
      });
      await waitFor(() => frames.some((f) => f.event?.type === 'conversation.draft_requested'));
      await new Promise((r) => setTimeout(r, 200));

      expect(frames.map((f) => f.channel)).toEqual(['conversation:cnv_followed']);
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
