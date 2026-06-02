import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import type { AddressInfo } from 'node:net';
import { buildApiKey, hashSecret, keyPrefix } from '@getmunin/core';
import { createDb, runMigrations, schema } from '@getmunin/db';
import { sql } from 'drizzle-orm';
import { AppModule } from '../app.module.ts';

const TEST_URL = process.env.TEST_DATABASE_URL;
const skipReason = TEST_URL
  ? null
  : 'Set TEST_DATABASE_URL to a Postgres URL to run end-user conversations REST integration tests.';

(skipReason ? describe.skip : describe)('End-user conversations REST controller', () => {
  let app: INestApplication;
  let baseUrl: string;
  let db: ReturnType<typeof createDb>;
  let orgId: string;
  let adminKey: string;
  let aliceToken: string;
  let bobToken: string;

  beforeAll(async () => {
    process.env.MUNIN_AUTH_SECRET ??= 'test-secret-do-not-use-in-prod-it-must-be-32-chars';
    process.env.MUNIN_KEY_PEPPER ??= 'test-pepper';
    process.env.MUNIN_EMBEDDING_PROVIDER = 'stub';
    process.env.MUNIN_MAIL_PROVIDER = 'stub';
    process.env.MUNIN_WEBHOOK_WORKER_DISABLED = '1';

    await runMigrations(TEST_URL!);
    const appUrl = TEST_URL!.replace(/(postgres(?:ql)?:\/\/)[^:@]+:[^@]+@/, '$1munin_app:munin_app@');
    process.env.DATABASE_URL = appUrl;

    db = createDb(TEST_URL!, { serviceRole: true });
    await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);

    const [org] = await db
      .insert(schema.orgs)
      .values({ name: 'EndUser Conv Org' })
      .returning();
    orgId = org!.id;

    adminKey = buildApiKey('admin');
    await db.insert(schema.apiKeys).values({
      orgId,
      type: 'admin',
      name: 'eu-conv-admin',
      keyHash: hashSecret(adminKey),
      keyPrefix: keyPrefix(adminKey),
      scopes: ['*'],
    });

    const [alice] = await db
      .insert(schema.endUsers)
      .values({ orgId, externalId: 'eu-alice', name: 'Alice' })
      .returning();
    const [bob] = await db
      .insert(schema.endUsers)
      .values({ orgId, externalId: 'eu-bob', name: 'Bob' })
      .returning();

    aliceToken = buildApiKey('dlg');
    await db.insert(schema.tokens).values({
      orgId,
      type: 'delegated_end_user',
      tokenHash: hashSecret(aliceToken),
      scopes: ['conv:read', 'conv:write'],
      audiences: ['self_service'],
      endUserId: alice!.id,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });
    bobToken = buildApiKey('dlg');
    await db.insert(schema.tokens).values({
      orgId,
      type: 'delegated_end_user',
      tokenHash: hashSecret(bobToken),
      scopes: ['conv:read', 'conv:write'],
      audiences: ['self_service'],
      endUserId: bob!.id,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });

    await db.insert(schema.convChannels).values({
      orgId,
      type: 'chat',
      vendor: 'munin',
      name: 'Web chat',
    });

    app = await NestFactory.create(AppModule, { logger: false });
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
  });

  async function rest<T>(
    token: string,
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
  ): Promise<{ status: number; body: T }> {
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    const parsed = text ? (JSON.parse(text) as T) : (undefined as unknown as T);
    return { status: res.status, body: parsed };
  }

  it('happy path: end-user starts, lists, gets, replies', async () => {
    const start = await rest<{ id: string; messages: { body: string; authorType: string }[] }>(
      aliceToken,
      'POST',
      '/v1/end-users/me/conversations',
      { body: 'I need help with my plan.' },
    );
    expect(start.status).toBe(201);
    expect(start.body.messages).toHaveLength(1);
    expect(start.body.messages[0]!.authorType).toBe('end_user');

    const list = await rest<{ items: Array<{ id: string }> }>(
      aliceToken,
      'GET',
      '/v1/end-users/me/conversations',
    );
    expect(list.status).toBe(200);
    expect(list.body.items.find((c) => c.id === start.body.id)).toBeTruthy();

    const detail = await rest<{ id: string; messages: Array<{ body: string }> }>(
      aliceToken,
      'GET',
      `/v1/end-users/me/conversations/${start.body.id}`,
    );
    expect(detail.status).toBe(200);
    expect(detail.body.id).toBe(start.body.id);

    const reply = await rest<{ authorType: string }>(
      aliceToken,
      'POST',
      `/v1/end-users/me/conversations/${start.body.id}/messages`,
      { body: 'Actually, my account is also locked.' },
    );
    expect(reply.status).toBe(201);
    expect(reply.body.authorType).toBe('end_user');
  }, 30_000);

  it('admin token is rejected with 403 on every endpoint', async () => {
    const start = await rest(adminKey, 'POST', '/v1/end-users/me/conversations', { body: 'hi' });
    expect(start.status).toBe(403);

    const list = await rest(adminKey, 'GET', '/v1/end-users/me/conversations');
    expect(list.status).toBe(403);

    const get = await rest(adminKey, 'GET', '/v1/end-users/me/conversations/some-id');
    expect(get.status).toBe(403);

    const reply = await rest(
      adminKey,
      'POST',
      '/v1/end-users/me/conversations/some-id/messages',
      { body: 'hi' },
    );
    expect(reply.status).toBe(403);
  });

  it('cross-end-user isolation: bob cannot see or write to alice\'s thread', async () => {
    const aliceStart = await rest<{ id: string }>(
      aliceToken,
      'POST',
      '/v1/end-users/me/conversations',
      { body: 'private message from Alice' },
    );
    expect(aliceStart.status).toBe(201);

    const bobList = await rest<{ items: Array<{ id: string }> }>(
      bobToken,
      'GET',
      '/v1/end-users/me/conversations',
    );
    expect(bobList.body.items.find((c) => c.id === aliceStart.body.id)).toBeFalsy();

    const bobGet = await rest(
      bobToken,
      'GET',
      `/v1/end-users/me/conversations/${aliceStart.body.id}`,
    );
    expect(bobGet.status).toBe(404);

    const bobReply = await rest(
      bobToken,
      'POST',
      `/v1/end-users/me/conversations/${aliceStart.body.id}/messages`,
      { body: 'sneak attempt' },
    );
    expect(bobReply.status).toBe(404);
  }, 30_000);

  it('a second end-user can start a conversation after the first (display_id sequence is org-wide, not RLS-filtered)', async () => {
    const aliceStart = await rest<{ id: string; displayId: number }>(
      aliceToken,
      'POST',
      '/v1/end-users/me/conversations',
      { body: 'first conversation' },
    );
    expect(aliceStart.status).toBe(201);

    const bobStart = await rest<{ id: string; displayId: number }>(
      bobToken,
      'POST',
      '/v1/end-users/me/conversations',
      { body: 'second conversation, different end-user' },
    );
    expect(bobStart.status).toBe(201);
    expect(bobStart.body.displayId).toBeGreaterThan(aliceStart.body.displayId);
  }, 30_000);

  it('POST /messages always stores authorType=end_user, ignoring any client field', async () => {
    const start = await rest<{ id: string }>(
      aliceToken,
      'POST',
      '/v1/end-users/me/conversations',
      { body: 'starting' },
    );
    const reply = await rest<{ authorType: string }>(
      aliceToken,
      'POST',
      `/v1/end-users/me/conversations/${start.body.id}/messages`,
      // Even if the client tries to spoof the author type, the server forces 'end_user'.
      { body: 'second message', authorType: 'agent' },
    );
    expect(reply.status).toBe(201);
    expect(reply.body.authorType).toBe('end_user');
  }, 30_000);
});
