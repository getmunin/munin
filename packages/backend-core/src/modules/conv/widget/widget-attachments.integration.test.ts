import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import sharp from 'sharp';
import { sql, eq } from 'drizzle-orm';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import {
  ActorIdentity,
  buildApiKey,
  hashSecret,
  keyPrefix,
  withContext,
  type RequestContext,
} from '@getmunin/core';
import { createDb, runMigrations, schema } from '@getmunin/db';
import { AppModule } from '../../../app.module.ts';
import { createApp } from '../../../bootstrap-app.ts';
import { ConvAttachmentsService } from '../attachments/conv-attachments.service.ts';

const TEST_URL = process.env.TEST_DATABASE_URL;
const skipReason = TEST_URL
  ? null
  : 'Set TEST_DATABASE_URL to a Postgres URL to run widget attachment integration tests.';

const ORIGIN = 'https://customer.example';
const PRESIGN_HOST = 'http://127.0.0.1:1';

(skipReason ? describe.skip : describe)('Chat-widget attachments', () => {
  let app: INestApplication;
  let baseUrl: string;
  let db: ReturnType<typeof createDb>;
  let appDb: ReturnType<typeof createDb>;
  let storageDir: string;
  let orgId: string;
  let adminKey: string;
  let widgetKey: string;
  let channelId: string;

  beforeAll(async () => {
    process.env.MUNIN_AUTH_SECRET ??= 'test-secret-do-not-use-in-prod-it-must-be-32-chars';
    process.env.MUNIN_KEY_PEPPER ??= 'test-pepper';
    process.env.MUNIN_EMBEDDING_PROVIDER = 'stub';
    process.env.MUNIN_MAIL_PROVIDER = 'stub';
    process.env.MUNIN_WEBHOOK_WORKER_DISABLED = '1';
    process.env.MUNIN_CMS_SCHEDULE_WORKER_DISABLED = '1';
    process.env.MUNIN_STORAGE_PROVIDER = 'local';
    storageDir = await mkdtemp(join(tmpdir(), 'munin-widget-att-'));
    process.env.MUNIN_STORAGE_LOCAL_PATH = storageDir;
    process.env.MUNIN_STORAGE_LOCAL_BASE_URL = `${PRESIGN_HOST}/static/assets`;

    await runMigrations(TEST_URL!);
    const appUrl = TEST_URL!.replace(
      /(postgres(?:ql)?:\/\/)[^:@]+:[^@]+@/,
      '$1munin_app:munin_app@',
    );
    process.env.DATABASE_URL = appUrl;

    db = createDb(TEST_URL!, { serviceRole: true });
    appDb = createDb(appUrl);
    await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);

    const [org] = await db.insert(schema.orgs).values({ name: 'Widget Att Org' }).returning();
    orgId = org!.id;

    adminKey = buildApiKey('admin');
    await db.insert(schema.apiKeys).values({
      orgId,
      type: 'admin',
      name: 'widget-att-admin',
      keyHash: hashSecret(adminKey),
      keyPrefix: keyPrefix(adminKey),
      scopes: ['*'],
    });

    app = await createApp(AppModule, { logger: false });
    await app.listen(0, '127.0.0.1');
    const server = app.getHttpServer() as { address(): AddressInfo | string | null };
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('expected AddressInfo');
    baseUrl = `http://127.0.0.1:${address.port}`;

    const created = await withClient(adminKey, async (c) =>
      parseToolResult<{ id: string; widgetKey: string }>(
        await c.callTool({
          name: 'conv_create_widget_channel',
          arguments: { name: 'att-bot', originAllowlist: [ORIGIN] },
        }),
      ),
    );
    channelId = created.id;
    widgetKey = created.widgetKey;
  });

  afterAll(async () => {
    if (app) await app.close();
    if (db) {
      await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
      if (orgId) await db.delete(schema.orgs).where(eq(schema.orgs.id, orgId));
    }
    if (storageDir) await rm(storageDir, { recursive: true, force: true });
  });

  async function withClient<T>(token: string, fn: (c: Client) => Promise<T>): Promise<T> {
    const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    });
    const c = new Client({ name: 'munin-widget-att-it', version: '0.0.0' });
    await c.connect(transport);
    try {
      return await fn(c);
    } finally {
      await transport.close();
      await c.close();
    }
  }

  function parseToolResult<T>(result: unknown): T {
    const content = (result as { content?: Array<{ type: string; text?: string }> }).content ?? [];
    const text = content.find((c) => c.type === 'text')?.text ?? '';
    return JSON.parse(text) as T;
  }

  async function post(
    path: string,
    body: unknown,
    token: string | null = widgetKey,
  ): Promise<{ status: number; json: unknown }> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Origin: ORIGIN,
    };
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    return { status: res.status, json: await safeJson(res) };
  }

  async function listMessages(sessionId: string): Promise<{
    status: number;
    json: { messages: Array<Record<string, unknown>> };
  }> {
    const res = await fetch(`${baseUrl}/v1/widget/messages?channelId=${channelId}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${widgetKey}`,
        Origin: ORIGIN,
        'x-munin-session-id': sessionId,
      },
    });
    return {
      status: res.status,
      json: (await safeJson(res)) as { messages: Array<Record<string, unknown>> },
    };
  }

  async function safeJson(res: Response): Promise<unknown> {
    const text = await res.text();
    try {
      return text ? JSON.parse(text) : null;
    } catch {
      return text;
    }
  }

  async function pngBytes(width = 320, height = 240): Promise<Buffer> {
    return sharp({
      create: { width, height, channels: 3, background: { r: 30, g: 110, b: 190 } },
    })
      .png()
      .toBuffer();
  }

  async function startSession(): Promise<{ sessionId: string; conversationId: string }> {
    const sessionId = `sess-${randomUUID()}`;
    const started = await post('/v1/widget/conversations', { channelId, sessionId });
    expect(started.status).toBe(201);
    const { conversationId } = started.json as { conversationId: string };
    return { sessionId, conversationId };
  }

  async function requestUpload(
    sessionId: string,
    conversationId: string,
    bytes: Buffer,
    name = 'shot.png',
    mime = 'image/png',
  ): Promise<{ status: number; json: unknown }> {
    return post('/v1/widget/attachments', {
      channelId,
      conversationId,
      sessionId,
      name,
      mime,
      sizeBytes: bytes.length,
    });
  }

  async function putBytes(uploadUrl: string, bytes: Buffer): Promise<number> {
    const res = await fetch(uploadUrl.replace(PRESIGN_HOST, baseUrl), {
      method: 'PUT',
      body: new Uint8Array(bytes),
      headers: { 'Content-Type': 'image/png' },
    });
    return res.status;
  }

  async function uploadAttachment(
    sessionId: string,
    conversationId: string,
  ): Promise<{ id: string; url: string | null; thumbnailUrl: string | null }> {
    const bytes = await pngBytes();
    const requested = await requestUpload(sessionId, conversationId, bytes);
    expect(requested.status).toBe(201);
    const handle = requested.json as { id: string; uploadUrl: string };
    expect(await putBytes(handle.uploadUrl, bytes)).toBeLessThan(300);
    const completed = await post(`/v1/widget/attachments/${handle.id}/complete`, {
      channelId,
      conversationId,
      sessionId,
    });
    expect(completed.status).toBe(201);
    return completed.json as { id: string; url: string | null; thumbnailUrl: string | null };
  }

  function asAdmin<T>(fn: () => Promise<T>): Promise<T> {
    const actor = new ActorIdentity('user', 'usr_att_test', orgId, ['*'], ['admin']);
    return appDb.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.bypass_rls', 'off', true)`);
      await tx.execute(sql`SELECT set_config('app.org_id', ${orgId}, true)`);
      const ctx: RequestContext = { db: tx, actor, correlationId: randomUUID() };
      return withContext(ctx, fn);
    });
  }

  it('carries an uploaded image from the composer to GET /v1/widget/messages', async () => {
    const { sessionId, conversationId } = await startSession();
    const attachment = await uploadAttachment(sessionId, conversationId);
    expect(attachment.url).toBeTruthy();
    expect(attachment.thumbnailUrl).toBeTruthy();

    const sent = await post('/v1/widget/messages', {
      channelId,
      sessionId,
      messages: [{ role: 'end_user', body: 'look at this', attachmentIds: [attachment.id] }],
    });
    expect(sent.status).toBe(201);
    expect((sent.json as { inserted: number }).inserted).toBe(1);

    const listed = await listMessages(sessionId);
    expect(listed.status).toBe(200);
    const withImage = listed.json.messages.find((m) => m.body === 'look at this');
    expect(withImage).toBeDefined();
    const attachments = withImage!.attachments as Array<Record<string, unknown>>;
    expect(attachments).toHaveLength(1);
    expect(attachments[0]!.id).toBe(attachment.id);
    expect(attachments[0]!.deleted).toBe(false);
    expect(attachments[0]!.url).toEqual(expect.stringContaining('/v1/c/a/'));

    await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
    const rows = await db
      .select({ attachments: schema.convMessages.attachments })
      .from(schema.convMessages)
      .where(eq(schema.convMessages.id, withImage!.id as string));
    expect(rows[0]!.attachments).toHaveLength(1);
  });

  it('accepts an image-only message with no body text', async () => {
    const { sessionId, conversationId } = await startSession();
    const attachment = await uploadAttachment(sessionId, conversationId);

    const sent = await post('/v1/widget/messages', {
      channelId,
      sessionId,
      messages: [{ role: 'end_user', body: '', attachmentIds: [attachment.id] }],
    });
    expect(sent.status).toBe(201);

    const listed = await listMessages(sessionId);
    const only = listed.json.messages.find(
      (m) => Array.isArray(m.attachments) && (m.attachments as unknown[]).length === 1,
    );
    expect(only).toBeDefined();
    expect(only!.body).toBe('');
  });

  it('refuses a message with neither body nor attachments', async () => {
    const { sessionId } = await startSession();
    const sent = await post('/v1/widget/messages', {
      channelId,
      sessionId,
      messages: [{ role: 'end_user', body: '   ' }],
    });
    expect(sent.status).toBe(403);
  });

  it('refuses to let one visitor complete another visitor session upload', async () => {
    const victim = await startSession();
    const thief = await startSession();

    const bytes = await pngBytes();
    const requested = await requestUpload(victim.sessionId, victim.conversationId, bytes);
    expect(requested.status).toBe(201);
    const handle = requested.json as { id: string; uploadUrl: string };
    expect(await putBytes(handle.uploadUrl, bytes)).toBeLessThan(300);

    const stolen = await post(`/v1/widget/attachments/${handle.id}/complete`, {
      channelId,
      conversationId: thief.conversationId,
      sessionId: thief.sessionId,
    });
    expect(stolen.status).toBe(404);

    const owned = await post(`/v1/widget/attachments/${handle.id}/complete`, {
      channelId,
      conversationId: victim.conversationId,
      sessionId: victim.sessionId,
    });
    expect(owned.status).toBe(201);
  });

  it('refuses to attach an upload that belongs to another session', async () => {
    const { sessionId, conversationId } = await startSession();

    await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
    const [foreign] = await db
      .insert(schema.convAttachments)
      .values({
        orgId,
        conversationId,
        name: 'someone-else.png',
        mime: 'image/png',
        sizeBytes: 1234,
        sessionId: 'sess-belongs-to-someone-else',
        storageProvider: 'local',
        storageKey: `conv/${orgId}/${conversationId}/foreign.png`,
        uploaded: true,
        createdByType: 'agent',
        createdById: 'test',
      })
      .returning({ id: schema.convAttachments.id });

    const sent = await post('/v1/widget/messages', {
      channelId,
      sessionId,
      messages: [{ role: 'end_user', body: 'mine now', attachmentIds: [foreign!.id] }],
    });
    expect(sent.status).toBe(404);

    const listed = await listMessages(sessionId);
    expect(listed.json.messages.some((m) => m.body === 'mine now')).toBe(false);
  });

  it('refuses to attach an upload from another conversation', async () => {
    const owner = await startSession();
    const other = await startSession();
    const attachment = await uploadAttachment(other.sessionId, other.conversationId);

    const sent = await post('/v1/widget/messages', {
      channelId,
      sessionId: owner.sessionId,
      messages: [{ role: 'end_user', body: 'cross conversation', attachmentIds: [attachment.id] }],
    });
    expect(sent.status).toBe(400);
  });

  it('refuses an unknown attachment id', async () => {
    const { sessionId } = await startSession();
    const sent = await post('/v1/widget/messages', {
      channelId,
      sessionId,
      messages: [{ role: 'end_user', body: 'ghost', attachmentIds: [randomUUID()] }],
    });
    expect(sent.status).toBe(404);
  });

  it('refuses an upload whose bytes were never confirmed', async () => {
    const { sessionId, conversationId } = await startSession();
    const bytes = await pngBytes();
    const requested = await requestUpload(sessionId, conversationId, bytes);
    expect(requested.status).toBe(201);
    const handle = requested.json as { id: string };

    const sent = await post('/v1/widget/messages', {
      channelId,
      sessionId,
      messages: [{ role: 'end_user', body: 'not yet', attachmentIds: [handle.id] }],
    });
    expect(sent.status).toBe(409);
  });

  it('refuses a mime type outside the allowlist', async () => {
    const { sessionId, conversationId } = await startSession();
    const rejected = await post('/v1/widget/attachments', {
      channelId,
      conversationId,
      sessionId,
      name: 'payload.svg',
      mime: 'image/svg+xml',
      sizeBytes: 900,
    });
    expect(rejected.status).toBe(400);
    expect((rejected.json as { code?: string }).code).toBe('conv_attachment_mime_rejected');
  });

  it('serializes a tombstoned attachment as deleted with null urls', async () => {
    const { sessionId, conversationId } = await startSession();
    const attachment = await uploadAttachment(sessionId, conversationId);
    const sent = await post('/v1/widget/messages', {
      channelId,
      sessionId,
      messages: [{ role: 'end_user', body: 'about to vanish', attachmentIds: [attachment.id] }],
    });
    expect(sent.status).toBe(201);

    const service = app.get(ConvAttachmentsService);
    await asAdmin(() => service.delete({ id: attachment.id }));

    const listed = await listMessages(sessionId);
    const message = listed.json.messages.find((m) => m.body === 'about to vanish');
    expect(message).toBeDefined();
    const attachments = message!.attachments as Array<Record<string, unknown>>;
    expect(attachments).toHaveLength(1);
    expect(attachments[0]!.deleted).toBe(true);
    expect(attachments[0]!.url).toBeNull();
    expect(attachments[0]!.thumbnailUrl).toBeNull();
    expect(attachments[0]!.name).toBe('shot.png');
  });
});
