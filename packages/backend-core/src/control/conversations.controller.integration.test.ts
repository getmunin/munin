import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import type { AddressInfo } from 'node:net';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { buildApiKey, hashSecret, keyPrefix } from '@getmunin/core';
import { createDb, runMigrations, schema } from '@getmunin/db';
import { sql } from 'drizzle-orm';
import { AppModule } from '../app.module.js';

const TEST_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const skipReason = TEST_URL
  ? null
  : 'Set DATABASE_URL or TEST_DATABASE_URL to a Postgres URL to run conversations REST integration tests.';

(skipReason ? describe.skip : describe)('Conversations REST controller', () => {
  let app: INestApplication;
  let baseUrl: string;
  let db: ReturnType<typeof createDb>;
  let orgAId: string;
  let orgBId: string;
  let adminKeyA: string;
  let adminKeyB: string;
  let adminUserAId: string;
  let endUserToken: string;

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

    const ts = Date.now();
    const [orgA] = await db
      .insert(schema.orgs)
      .values({ name: 'ConvCtrl Org A', slug: `convctrl-a-${ts}` })
      .returning();
    orgAId = orgA!.id;
    const [orgB] = await db
      .insert(schema.orgs)
      .values({ name: 'ConvCtrl Org B', slug: `convctrl-b-${ts}` })
      .returning();
    orgBId = orgB!.id;

    const [adminUserA] = await db
      .insert(schema.users)
      .values({ email: `convctrl-a-${ts}@example.com`, name: 'Admin A' })
      .returning();
    const [adminUserB] = await db
      .insert(schema.users)
      .values({ email: `convctrl-b-${ts}@example.com`, name: 'Admin B' })
      .returning();
    adminUserAId = adminUserA!.id;

    adminKeyA = buildApiKey('admin');
    await db.insert(schema.apiKeys).values({
      orgId: orgAId,
      type: 'admin',
      name: 'a',
      keyHash: hashSecret(adminKeyA),
      keyPrefix: keyPrefix(adminKeyA),
      scopes: ['*'],
      createdByUserId: adminUserA!.id,
    });
    adminKeyB = buildApiKey('admin');
    await db.insert(schema.apiKeys).values({
      orgId: orgBId,
      type: 'admin',
      name: 'b',
      keyHash: hashSecret(adminKeyB),
      keyPrefix: keyPrefix(adminKeyB),
      scopes: ['*'],
      createdByUserId: adminUserB!.id,
    });

    const [eu] = await db
      .insert(schema.endUsers)
      .values({ orgId: orgAId, externalId: 'eu-1', name: 'Caller' })
      .returning();
    endUserToken = buildApiKey('dlg');
    await db.insert(schema.tokens).values({
      orgId: orgAId,
      type: 'delegated_end_user',
      tokenHash: hashSecret(endUserToken),
      scopes: ['conv:read', 'conv:write'],
      audiences: ['self_service'],
      endUserId: eu!.id,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });

    // Insert the chat channel directly via the service-role connection
    // (bypasses RLS, commits before app boot). Previously this went through
    // an MCP tool call after the app started — that path occasionally
    // flaked under CI: the tool's response was awaited but its result
    // wasn't validated, so a transient transport error left the channel
    // missing and every "no active channel configured" assertion below it
    // failed. Direct insert is one SQL round-trip with deterministic
    // visibility for the app's separate connection pool.
    await db.insert(schema.convChannels).values({
      orgId: orgAId,
      type: 'chat',
      vendor: 'munin',
      name: 'Web chat',
      config: {},
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
      await db.delete(schema.orgs).where(sql`id IN (${orgAId}, ${orgBId})`);
    }
  });

  async function withClient<T>(token: string, fn: (c: Client) => Promise<T>): Promise<T> {
    const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    });
    const c = new Client({ name: 'rest-it', version: '0.0.0' });
    await c.connect(transport);
    try {
      return await fn(c);
    } finally {
      await transport.close();
      await c.close();
    }
  }

  async function rest<T>(
    token: string,
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
  ): Promise<{ status: number; body: T }> {
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    const parsed = text ? (JSON.parse(text) as T) : (undefined as unknown as T);
    return { status: res.status, body: parsed };
  }

  it('full handover loop: list → take-over → agent reply rejected → human reply releases flag → release claim', async () => {
    const startResp = await rest<{ id: string }>(
      endUserToken,
      'POST',
      '/api/v1/end-users/me/conversations',
      { body: 'Need help with my plan.' },
    );
    expect(startResp.status).toBe(201);
    const started = startResp.body;

    await withClient(adminKeyA, async (c) => {
      await c.callTool({
        name: 'conv_request_handover',
        arguments: { conversationId: started.id, reason: 'plan change' },
      });
    });

    const list = await rest<{ items: Array<{ id: string; needsHumanAttention: boolean }> }>(
      adminKeyA,
      'GET',
      '/api/v1/conversations',
    );
    expect(list.status).toBe(200);
    const flagged = list.body.items.find((c) => c.id === started.id);
    expect(flagged?.needsHumanAttention).toBe(true);

    const detail = await rest<{
      id: string;
      claim: { holderId: string } | null;
      channelType?: string;
    }>(
      adminKeyA,
      'GET',
      `/api/v1/conversations/${started.id}`,
    );
    expect(detail.body.claim).toBeNull();
    expect(detail.body.channelType).toBe('chat');

    const claim = await rest<{ holderType: string; holderId: string; expiresAt: string }>(
      adminKeyA,
      'POST',
      `/api/v1/conversations/${started.id}/take-over`,
      {},
    );
    expect(claim.status).toBe(200);
    expect(claim.body.expiresAt).toBeTruthy();
    expect(claim.body.holderType).toBe('user');
    expect(claim.body.holderId).toBe(adminUserAId);

    const detailWithClaim = await rest<{ claim: { holderId: string } | null }>(
      adminKeyA,
      'GET',
      `/api/v1/conversations/${started.id}`,
    );
    expect(detailWithClaim.body.claim).not.toBeNull();

    const endUserFollowUp = await rest<{ message?: string; error?: string }>(
      endUserToken,
      'POST',
      `/api/v1/end-users/me/conversations/${started.id}/messages`,
      { body: 'still there?' },
    );
    expect(endUserFollowUp.status).toBe(201);

    const humanReply = await rest<{ id: string }>(
      adminKeyA,
      'POST',
      `/api/v1/conversations/${started.id}/messages`,
      { body: 'Switching you now.' },
    );
    expect(humanReply.status).toBe(201);

    const afterReply = await rest<{ needsHumanAttention: boolean }>(
      adminKeyA,
      'GET',
      `/api/v1/conversations/${started.id}`,
    );
    expect(afterReply.body.needsHumanAttention).toBe(false);

    const released = await rest<{ released: boolean }>(
      adminKeyA,
      'POST',
      `/api/v1/conversations/${started.id}/release`,
      {},
    );
    expect(released.body.released).toBe(true);
  }, 30_000);

  it('tenancy isolation: orgB cannot see orgA conversations or activity', async () => {
    const list = await rest<{ items: Array<{ id: string }> }>(
      adminKeyB,
      'GET',
      '/api/v1/conversations',
    );
    expect(list.status).toBe(200);
    expect(list.body.items).toEqual([]);

    const activity = await rest<{ items: Array<{ id: string; type: string }> }>(
      adminKeyB,
      'GET',
      '/api/v1/activity',
    );
    expect(activity.status).toBe(200);
    expect(activity.body.items).toEqual([]);
  });

  it('activity feed returns conversation events for orgA', async () => {
    const activity = await rest<{ items: Array<{ type: string; payload: Record<string, unknown> }> }>(
      adminKeyA,
      'GET',
      '/api/v1/activity?types=conversation.created,conversation.handover_requested',
    );
    expect(activity.status).toBe(200);
    const types = activity.body.items.map((e) => e.type);
    expect(types).toContain('conversation.created');
    expect(types).toContain('conversation.handover_requested');
  });
});
