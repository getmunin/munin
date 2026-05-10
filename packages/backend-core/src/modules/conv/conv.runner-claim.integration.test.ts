import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import type { AddressInfo } from 'node:net';
import { buildApiKey, hashSecret, keyPrefix } from '@getmunin/core';
import { createDb, runMigrations, schema } from '@getmunin/db';
import { eq, sql } from 'drizzle-orm';
import { AppModule } from '../../app.module.js';

const TEST_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const skipReason = TEST_URL
  ? null
  : 'Set DATABASE_URL or TEST_DATABASE_URL to run conv runner-claim integration tests.';

(skipReason ? describe.skip : describe)('conv runner-claim ownership', () => {
  let app: INestApplication;
  let baseUrl: string;
  let db: ReturnType<typeof createDb>;
  let orgId: string;
  let adminKey: string;
  let convId: string;

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
      .values({ name: 'Runner Claim Org', slug: `rc-${ts}` })
      .returning();
    orgId = org!.id;

    adminKey = buildApiKey('admin');
    await db.insert(schema.apiKeys).values({
      orgId,
      type: 'admin',
      name: 'rc-admin',
      keyHash: hashSecret(adminKey),
      keyPrefix: keyPrefix(adminKey),
      scopes: ['*'],
    });

    const [channel] = await db
      .insert(schema.convChannels)
      .values({
        orgId,
        type: 'chat',
        name: 'rc-chat',
        config: { provider: 'widget', originAllowlist: [] },
      })
      .returning();

    const [eu] = await db
      .insert(schema.endUsers)
      .values({ orgId, externalId: 'rc-eu', name: 'EU' })
      .returning();

    const [contact] = await db
      .insert(schema.convContacts)
      .values({ orgId, endUserId: eu!.id, name: 'EU' })
      .returning();

    const [conv] = await db
      .insert(schema.convConversations)
      .values({
        orgId,
        channelId: channel!.id,
        contactId: contact!.id,
        endUserId: eu!.id,
        displayId: 1,
        status: 'open',
      })
      .returning();
    convId = conv!.id;

    app = await NestFactory.create(AppModule, { logger: false });
    await app.listen(0, '127.0.0.1');
    const server = app.getHttpServer() as { address(): AddressInfo | string | null };
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('expected AddressInfo');
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await app?.close();
    if (db) {
      await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
      await db.delete(schema.orgs).where(sql`id = ${orgId}`);
    }
  });

  beforeEach(async () => {
    await db
      .update(schema.convConversations)
      .set({ runnerHolder: null, runnerLeaseExpiresAt: null, status: 'open' })
      .where(eq(schema.convConversations.id, convId));
  });

  async function call(
    path: string,
    init: { method?: string; body?: unknown; key?: string } = {},
  ): Promise<{ status: number; body: unknown }> {
    const res = await fetch(`${baseUrl}${path}`, {
      method: init.method ?? 'GET',
      headers: {
        authorization: `Bearer ${init.key ?? adminKey}`,
        'content-type': 'application/json',
      },
      body: init.body ? JSON.stringify(init.body) : undefined,
    });
    const text = await res.text();
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }
    return { status: res.status, body };
  }

  it('first runner claims; second runner is rejected', async () => {
    const first = await call(`/api/v1/conversations/${convId}/runner-claim`, {
      method: 'POST',
      body: { holder: 'sidecar-A', leaseSeconds: 3600 },
    });
    expect(first.status).toBe(200);
    expect((first.body as { acquired: boolean }).acquired).toBe(true);

    const second = await call(`/api/v1/conversations/${convId}/runner-claim`, {
      method: 'POST',
      body: { holder: 'sidecar-B', leaseSeconds: 3600 },
    });
    expect(second.status).toBe(200);
    const secondBody = second.body as { acquired: boolean; heldBy: string };
    expect(secondBody.acquired).toBe(false);
    expect(secondBody.heldBy).toBe('sidecar-A');
  });

  it('current holder can refresh its own lease', async () => {
    await call(`/api/v1/conversations/${convId}/runner-claim`, {
      method: 'POST',
      body: { holder: 'sidecar-A', leaseSeconds: 60 },
    });
    const refresh = await call(`/api/v1/conversations/${convId}/runner-claim`, {
      method: 'POST',
      body: { holder: 'sidecar-A', leaseSeconds: 3600 },
    });
    expect((refresh.body as { acquired: boolean }).acquired).toBe(true);
  });

  it('expired lease can be taken over by another holder', async () => {
    await call(`/api/v1/conversations/${convId}/runner-claim`, {
      method: 'POST',
      body: { holder: 'sidecar-A', leaseSeconds: 60 },
    });
    await db
      .update(schema.convConversations)
      .set({ runnerLeaseExpiresAt: new Date(Date.now() - 60_000) })
      .where(eq(schema.convConversations.id, convId));

    const takeover = await call(`/api/v1/conversations/${convId}/runner-claim`, {
      method: 'POST',
      body: { holder: 'sidecar-B', leaseSeconds: 3600 },
    });
    expect((takeover.body as { acquired: boolean }).acquired).toBe(true);

    const [row] = await db
      .select({
        runnerHolder: schema.convConversations.runnerHolder,
      })
      .from(schema.convConversations)
      .where(eq(schema.convConversations.id, convId));
    expect(row?.runnerHolder).toBe('sidecar-B');
  });

  it('release works only for the current holder', async () => {
    await call(`/api/v1/conversations/${convId}/runner-claim`, {
      method: 'POST',
      body: { holder: 'sidecar-A', leaseSeconds: 3600 },
    });
    const wrongRelease = await call(`/api/v1/conversations/${convId}/runner-release`, {
      method: 'POST',
      body: { holder: 'sidecar-B' },
    });
    expect((wrongRelease.body as { released: boolean }).released).toBe(false);

    const correctRelease = await call(`/api/v1/conversations/${convId}/runner-release`, {
      method: 'POST',
      body: { holder: 'sidecar-A' },
    });
    expect((correctRelease.body as { released: boolean }).released).toBe(true);

    const [row] = await db
      .select({ runnerHolder: schema.convConversations.runnerHolder })
      .from(schema.convConversations)
      .where(eq(schema.convConversations.id, convId));
    expect(row?.runnerHolder).toBeNull();
  });

  it('closing a conversation auto-clears the runner claim', async () => {
    await call(`/api/v1/conversations/${convId}/runner-claim`, {
      method: 'POST',
      body: { holder: 'sidecar-A', leaseSeconds: 3600 },
    });
    const close = await call(`/api/v1/conversations/${convId}/status`, {
      method: 'POST',
      body: { status: 'closed' },
    });
    expect(close.status).toBe(200);
    const [row] = await db
      .select({ runnerHolder: schema.convConversations.runnerHolder })
      .from(schema.convConversations)
      .where(eq(schema.convConversations.id, convId));
    expect(row?.runnerHolder).toBeNull();
  });

  it('agent post with stale sinceMessageId is rejected as race', async () => {
    const [m1] = await db
      .insert(schema.convMessages)
      .values({
        orgId,
        conversationId: convId,
        authorType: 'end_user',
        authorId: 'eu-1',
        body: 'hello',
        internal: false,
      })
      .returning();
    await db
      .insert(schema.convMessages)
      .values({
        orgId,
        conversationId: convId,
        authorType: 'agent',
        authorId: 'agent-1',
        body: 'racing reply',
        internal: false,
      });

    const racePost = await call(`/api/v1/conversations/${convId}/messages`, {
      method: 'POST',
      body: { body: 'late reply from second runner', sinceMessageId: m1!.id },
    });
    expect(racePost.status).toBe(409);
    expect(JSON.stringify(racePost.body)).toContain('agent_reply_race');
  });
});
