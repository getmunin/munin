import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import type { AddressInfo } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import sharp from 'sharp';
import { sql } from 'drizzle-orm';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { buildApiKey, hashSecret, keyPrefix } from '@getmunin/core';
import { createDb, runMigrations, schema } from '@getmunin/db';
import { createApp } from '../../../bootstrap-app.ts';
import { AppModule } from '../../../app.module.ts';

const TEST_URL = process.env.TEST_DATABASE_URL;
const skipReason = TEST_URL
  ? null
  : 'Set TEST_DATABASE_URL to a Postgres URL to run conv attachment dashboard tests.';

(skipReason ? describe.skip : describe)('conv attachments: operator send, read hydration, delete', () => {
  let app: INestApplication;
  let baseUrl: string;
  let db: ReturnType<typeof createDb>;
  let storageDir: string;
  let orgId: string;
  let adminKey: string;
  let conversationId: string;

  beforeAll(async () => {
    process.env.MUNIN_AUTH_SECRET ??= 'test-secret-do-not-use-in-prod';
    process.env.MUNIN_KEY_PEPPER ??= 'test-pepper';
    process.env.MUNIN_EMBEDDING_PROVIDER = 'stub';
    process.env.MUNIN_MAIL_PROVIDER = 'stub';
    process.env.MUNIN_WEBHOOK_WORKER_DISABLED = '1';
    process.env.MUNIN_STORAGE_PROVIDER = 'local';
    storageDir = await mkdtemp(join(tmpdir(), 'munin-att-dash-'));
    process.env.MUNIN_STORAGE_LOCAL_PATH = storageDir;
    process.env.MUNIN_STORAGE_LOCAL_BASE_URL = 'http://127.0.0.1:1/static/assets';

    await runMigrations(TEST_URL!);
    const appUrl = TEST_URL!.replace(/(postgres(?:ql)?:\/\/)[^:@]+:[^@]+@/, '$1munin_app:munin_app@');
    process.env.DATABASE_URL = appUrl;

    db = createDb(TEST_URL!, { serviceRole: true });
    await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);

    const [org] = await db.insert(schema.orgs).values({ name: 'Att Dash Org' }).returning();
    orgId = org!.id;
    adminKey = buildApiKey('admin');
    await db.insert(schema.apiKeys).values({
      orgId,
      type: 'admin',
      name: 'att-dash-admin',
      keyHash: hashSecret(adminKey),
      keyPrefix: keyPrefix(adminKey),
      scopes: ['*'],
    });

    const [channel] = await db
      .insert(schema.convChannels)
      .values({
        orgId,
        type: 'chat',
        vendor: 'widget',
        name: 'w',
        config: { provider: 'widget' },
        active: true,
      })
      .returning();
    const [contact] = await db
      .insert(schema.convContacts)
      .values({ orgId, email: 'dash@example.com', name: 'Dash' })
      .returning();
    const next = await db.execute<{ next: number } & Record<string, unknown>>(
      sql`SELECT conv_next_display_id(${orgId}) AS next`,
    );
    const [conv] = await db
      .insert(schema.convConversations)
      .values({
        orgId,
        displayId: next[0]!.next,
        channelId: channel!.id,
        contactId: contact!.id,
        status: 'open',
        lastMessageAt: new Date(),
      })
      .returning();
    conversationId = conv!.id;

    app = await createApp(AppModule, { logger: false });
    await app.listen(0, '127.0.0.1');
    const server = app.getHttpServer() as { address(): AddressInfo | string | null };
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('expected AddressInfo');
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    if (app) await app.close();
    if (db) {
      await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
      await db.delete(schema.orgs).where(sql`id = ${orgId}`);
    }
    if (storageDir) await rm(storageDir, { recursive: true, force: true });
  });

  async function withClient<T>(fn: (c: Client) => Promise<T>): Promise<T> {
    const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${adminKey}` } },
    });
    const c = new Client({ name: 'munin-it', version: '0.0.0' });
    await c.connect(transport);
    try {
      return await fn(c);
    } finally {
      await transport.close();
      await c.close();
    }
  }

  async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    return withClient(async (c) => {
      const res = (await c.callTool({ name, arguments: args })) as {
        content?: Array<{ type: string; text?: string }>;
        isError?: boolean;
      };
      const text = res.content?.[0]?.text ?? '';
      if (res.isError) throw new Error(text);
      return text ? (JSON.parse(text) as unknown) : null;
    });
  }

  async function api(path: string, init?: RequestInit): Promise<Response> {
    return fetch(`${baseUrl}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${adminKey}`,
        'Content-Type': 'application/json',
        ...(init?.headers ?? {}),
      },
    });
  }

  async function uploadImage(name: string, width = 1200): Promise<string> {
    const body = await sharp({
      create: { width, height: 400, channels: 3, background: { r: 10, g: 90, b: 160 } },
    })
      .png()
      .toBuffer();

    const reqRes = await api(`/v1/conversations/${conversationId}/attachments/upload-request`, {
      method: 'POST',
      body: JSON.stringify({ name, mime: 'image/png', sizeBytes: body.length }),
    });
    expect(reqRes.status).toBe(201);
    const handle = (await reqRes.json()) as { id: string; uploadUrl: string };

    const put = await fetch(handle.uploadUrl.replace(/^http:\/\/127\.0\.0\.1:1/, baseUrl), {
      method: 'PUT',
      body: new Uint8Array(body),
      headers: { 'Content-Type': 'image/png' },
    });
    expect(put.status).toBe(204);

    const done = await api(
      `/v1/conversations/${conversationId}/attachments/${handle.id}/complete`,
      { method: 'POST' },
    );
    expect(done.status).toBe(200);
    return handle.id;
  }

  interface ConvMessage {
    id: string;
    attachments: Array<{
      id: string;
      name: string;
      url: string | null;
      thumbnailUrl: string | null;
      deleted: boolean;
    }>;
  }

  async function messagesOf(): Promise<ConvMessage[]> {
    const detail = (await callTool('conv_get_conversation', { id: conversationId })) as {
      messages: ConvMessage[];
    };
    return detail.messages;
  }

  it('an operator reply carries its attachment, and the read path hydrates a url that actually resolves', async () => {
    const attachmentId = await uploadImage('operator.png');

    const res = await api(`/v1/conversations/${conversationId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ body: 'here is the diagram', attachmentIds: [attachmentId] }),
    });
    expect(res.status).toBe(201);
    const sent = (await res.json()) as ConvMessage;
    expect(sent.attachments).toHaveLength(1);
    expect(sent.attachments[0]!.url).toContain('/v1/c/a/');

    const [row] = await db.execute<Record<string, unknown>>(
      sql`SELECT attachments FROM conv_messages WHERE id = ${sent.id}`,
    );
    expect(JSON.stringify(row!.attachments)).not.toContain('/v1/c/a/');

    const messages = await messagesOf();
    const found = messages.find((m) => m.id === sent.id);
    expect(found?.attachments).toHaveLength(1);
    const url = found!.attachments[0]!.url!;
    expect(url).toContain('/v1/c/a/');
    const served = await fetch(url.replace(/^https?:\/\/[^/]+/, baseUrl));
    expect(served.status).toBe(200);
    expect(served.headers.get('content-type')).toBe('image/png');
  });

  it('rejects an attachment id from another conversation on send', async () => {
    const attachmentId = await uploadImage('wrong-conv.png', 400);
    const next = await db.execute<{ next: number } & Record<string, unknown>>(
      sql`SELECT conv_next_display_id(${orgId}) AS next`,
    );
    const [channel] = await db.select().from(schema.convChannels).where(sql`org_id = ${orgId}`);
    const [contact] = await db.select().from(schema.convContacts).where(sql`org_id = ${orgId}`);
    const [other] = await db
      .insert(schema.convConversations)
      .values({
        orgId,
        displayId: next[0]!.next,
        channelId: channel!.id,
        contactId: contact!.id,
        status: 'open',
        lastMessageAt: new Date(),
      })
      .returning();

    const res = await api(`/v1/conversations/${other!.id}/messages`, {
      method: 'POST',
      body: JSON.stringify({ body: 'nope', attachmentIds: [attachmentId] }),
    });
    expect(res.status).toBe(400);
    const err = (await res.json()) as { code?: string };
    expect(err.code).toBe('conv_attachment_conflict');
  });

  it('conv_delete_attachment tombstones a sent image and the thread keeps the record', async () => {
    const attachmentId = await uploadImage('to-delete.png');
    const res = await api(`/v1/conversations/${conversationId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ body: 'oops wrong file', attachmentIds: [attachmentId] }),
    });
    const sent = (await res.json()) as ConvMessage;
    const liveUrl = sent.attachments[0]!.url!;
    expect(await fetch(liveUrl.replace(/^https?:\/\/[^/]+/, baseUrl)).then((r) => r.status)).toBe(200);

    const deleted = await callTool('conv_delete_attachment', { attachmentId });
    expect(deleted).toEqual({ deleted: true, id: attachmentId, alreadyDeleted: false });

    expect(await fetch(liveUrl.replace(/^https?:\/\/[^/]+/, baseUrl)).then((r) => r.status)).toBe(404);

    const messages = await messagesOf();
    const found = messages.find((m) => m.id === sent.id);
    expect(found?.attachments).toHaveLength(1);
    expect(found!.attachments[0]!.deleted).toBe(true);
    expect(found!.attachments[0]!.name).toBe('to-delete.png');
    expect(found!.attachments[0]!.url).toBeNull();
    expect(found!.attachments[0]!.thumbnailUrl).toBeNull();
  });

  it('conv_delete_attachment is idempotent and never returns void', async () => {
    const attachmentId = await uploadImage('twice.png', 400);
    await api(`/v1/conversations/${conversationId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ body: 'x', attachmentIds: [attachmentId] }),
    });
    await callTool('conv_delete_attachment', { attachmentId });
    const again = await callTool('conv_delete_attachment', { attachmentId });
    expect(again).toEqual({ deleted: true, id: attachmentId, alreadyDeleted: true });
  });

  it('conv_delete_attachment reports a clean not-found rather than a 500', async () => {
    await expect(callTool('conv_delete_attachment', { attachmentId: 'cva_nope' })).rejects.toThrow(
      /conv_not_found/,
    );
  });

  it('the DELETE control-plane route removes a pending upload outright', async () => {
    const attachmentId = await uploadImage('pending.png', 400);
    const res = await api(`/v1/conversations/${conversationId}/attachments/${attachmentId}`, {
      method: 'DELETE',
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deleted: true, id: attachmentId, alreadyDeleted: false });

    const [row] = await db.execute<{ n: number } & Record<string, unknown>>(
      sql`SELECT count(*)::int AS n FROM conv_attachments WHERE id = ${attachmentId}`,
    );
    expect(row!.n).toBe(0);
  });
});
