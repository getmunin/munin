import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import type { AddressInfo } from 'node:net';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { buildApiKey, hashSecret, keyPrefix, signHmac } from '@getmunin/core';
import { createDb, runMigrations, schema } from '@getmunin/db';
import { sql, eq, and } from 'drizzle-orm';
import { AppModule } from '../../../app.module.js';

const TEST_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const skipReason = TEST_URL
  ? null
  : 'Set DATABASE_URL or TEST_DATABASE_URL to a Postgres URL to run widget integration tests.';

(skipReason ? describe.skip : describe)('Chat-widget channel integration', () => {
  let app: INestApplication;
  let baseUrl: string;
  let db: ReturnType<typeof createDb>;
  let orgId: string;
  let adminKey: string;
  let widgetKey: string;
  let channelId: string;
  let identityVerificationSecret: string;

  beforeAll(async () => {
    process.env.MUNIN_AUTH_SECRET ??= 'test-secret-do-not-use-in-prod-it-must-be-32-chars';
    process.env.MUNIN_KEY_PEPPER ??= 'test-pepper';
    process.env.MUNIN_EMBEDDING_PROVIDER = 'stub';
    process.env.MUNIN_MAIL_PROVIDER = 'stub';
    process.env.MUNIN_STORAGE_PROVIDER = 'local';
    process.env.MUNIN_STORAGE_LOCAL_PATH = '/tmp/munin-widget-test';
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
      .values({ name: 'Widget IT Org', slug: `widget-it-${ts}` })
      .returning();
    orgId = org!.id;

    adminKey = buildApiKey('admin');
    await db.insert(schema.apiKeys).values({
      orgId,
      type: 'admin',
      name: 'widget-it-admin',
      keyHash: hashSecret(adminKey),
      keyPrefix: keyPrefix(adminKey),
      scopes: ['*'],
    });

    app = await NestFactory.create(AppModule, { logger: false });
    await app.listen(0, '127.0.0.1');
    const server = app.getHttpServer() as { address(): AddressInfo | string | null };
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('expected AddressInfo');
    baseUrl = `http://127.0.0.1:${address.port}`;

    // Mint a widget channel + key via the admin MCP tool.
    const created = await withClient(adminKey, async (c) => {
      return parseToolResult<{
        id: string;
        widgetKey: string;
        identityVerificationSecret: string;
        config: { hasIdentityVerificationSecret: boolean; requireVerifiedIdentity: boolean };
      }>(
        await c.callTool({
          name: 'conv_widget_create_channel',
          arguments: {
            name: 'storefront-bot',
            displayName: 'Storefront Bot',
            originAllowlist: ['https://customer.example'],
          },
        }),
      );
    });
    channelId = created.id;
    widgetKey = created.widgetKey;
    identityVerificationSecret = created.identityVerificationSecret;
  });

  afterAll(async () => {
    if (app) await app.close();
    if (db) {
      await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
      await db.delete(schema.orgs).where(sql`id = ${orgId}`);
    }
  });

  async function withClient<T>(token: string, fn: (c: Client) => Promise<T>): Promise<T> {
    const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    });
    const c = new Client({ name: 'munin-widget-it', version: '0.0.0' });
    await c.connect(transport);
    try {
      return await fn(c);
    } finally {
      await transport.close();
      await c.close();
    }
  }

  async function call(
    method: 'POST' | 'GET',
    path: string,
    token: string | null,
    body?: unknown,
    extraHeaders: Record<string, string> = {},
  ): Promise<{ status: number; json: unknown }> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...extraHeaders,
    };
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = text;
    }
    return { status: res.status, json };
  }

  it('mints a widget key bound to a chat channel', async () => {
    expect(widgetKey).toMatch(/^mn_widget_/);
    await waitFor(async () => {
      await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
      const rows = await db
        .select()
        .from(schema.apiKeys)
        .where(and(eq(schema.apiKeys.channelId, channelId), eq(schema.apiKeys.type, 'widget')));
      return rows.length === 1;
    });
    await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
    const rows = await db
      .select()
      .from(schema.apiKeys)
      .where(and(eq(schema.apiKeys.channelId, channelId), eq(schema.apiKeys.type, 'widget')));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.scopes).toContain('conv:widget:write');
  });

  it('ingests a transcript and creates a conversation + contact + messages', async () => {
    const sessionId = 'vis_happy_path';
    const res = await call('POST', '/api/v1/widget/messages', widgetKey, {
      channelId,
      sessionId,
      visitor: { name: 'Vita', email: 'vita@example.com' },
      messages: [
        { role: 'end_user', body: 'Where is my order?', providerMessageId: 'evt_1' },
        { role: 'agent', body: 'Let me check…', providerMessageId: 'evt_2' },
      ],
    });
    expect(res.status).toBe(201);
    const out = res.json as { conversationId: string; inserted: number; skipped: number };
    expect(out.inserted).toBe(2);
    expect(out.skipped).toBe(0);

    await waitFor(async () => {
      await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
      const rows = await db
        .select()
        .from(schema.convMessages)
        .where(eq(schema.convMessages.conversationId, out.conversationId));
      return rows.length === 2;
    });
    await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
    const messages = await db
      .select()
      .from(schema.convMessages)
      .where(eq(schema.convMessages.conversationId, out.conversationId));
    expect(messages).toHaveLength(2);
    expect(messages.map((m) => m.authorType).sort()).toEqual(['agent', 'end_user']);
    const first = messages.find((m) => m.authorType === 'end_user')!;
    expect((first.metadata).sessionId).toBe(sessionId);
    expect((first.metadata).providerMessageId).toBe('evt_1');
  });

  it('is idempotent on providerMessageId', async () => {
    const sessionId = 'vis_idempotent';
    const body = {
      channelId,
      sessionId,
      messages: [{ role: 'end_user', body: 'first', providerMessageId: 'idem_1' }],
    };
    const first = await call('POST', '/api/v1/widget/messages', widgetKey, body);
    expect(first.status).toBe(201);
    expect((first.json as { inserted: number }).inserted).toBe(1);

    const second = await call('POST', '/api/v1/widget/messages', widgetKey, body);
    expect(second.status).toBe(201);
    expect((second.json as { inserted: number; skipped: number }).inserted).toBe(0);
    expect((second.json as { skipped: number }).skipped).toBe(1);
  });

  it('separates conversations across sessionIds on the same channel', async () => {
    const a = await call('POST', '/api/v1/widget/messages', widgetKey, {
      channelId,
      sessionId: 'vis_multi_a',
      messages: [{ role: 'end_user', body: 'session A' }],
    });
    const b = await call('POST', '/api/v1/widget/messages', widgetKey, {
      channelId,
      sessionId: 'vis_multi_b',
      messages: [{ role: 'end_user', body: 'session B' }],
    });
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    const aId = (a.json as { conversationId: string }).conversationId;
    const bId = (b.json as { conversationId: string }).conversationId;
    expect(aId).not.toEqual(bId);
  });

  it('rejects a body whose channelId does not match the bound key', async () => {
    const res = await call('POST', '/api/v1/widget/messages', widgetKey, {
      channelId: 'cch_nonexistent',
      sessionId: 'vis_mismatch',
      messages: [{ role: 'end_user', body: 'should be rejected' }],
    });
    expect(res.status).toBe(403);
  });

  it('rejects an admin key with no channel binding', async () => {
    const res = await call('POST', '/api/v1/widget/messages', adminKey, {
      channelId,
      sessionId: 'vis_admin_attempt',
      messages: [{ role: 'end_user', body: 'admin should not ingest' }],
    });
    expect(res.status).toBe(403);
  });

  it('rejects unauthenticated requests', async () => {
    const res = await call('POST', '/api/v1/widget/messages', null, {
      channelId,
      sessionId: 'vis_no_auth',
      messages: [{ role: 'end_user', body: 'no key' }],
    });
    expect(res.status).toBe(401);
  });

  it('rotates the widget key', async () => {
    const oldKey = widgetKey;
    const rotated = await withClient(adminKey, async (c) => {
      return parseToolResult<{ widgetKey: string }>(
        await c.callTool({
          name: 'conv_widget_rotate_key',
          arguments: { channelId },
        }),
      );
    });
    expect(rotated.widgetKey).toMatch(/^mn_widget_/);
    expect(rotated.widgetKey).not.toEqual(oldKey);

    // Old key revoked. Retry briefly: revocation visibility through the
    // server's connection pool can lag the rotate tx's commit by a tick.
    let staleStatus = 0;
    await waitFor(async () => {
      const r = await call('POST', '/api/v1/widget/messages', oldKey, {
        channelId,
        sessionId: 'vis_post_rotation',
        messages: [{ role: 'end_user', body: 'old key should fail' }],
      });
      staleStatus = r.status;
      return r.status === 401;
    });
    expect(staleStatus).toBe(401);

    // New key works.
    const fresh = await call('POST', '/api/v1/widget/messages', rotated.widgetKey, {
      channelId,
      sessionId: 'vis_post_rotation',
      messages: [{ role: 'end_user', body: 'new key should pass' }],
    });
    expect(fresh.status).toBe(201);
    widgetKey = rotated.widgetKey;
  });

  it('returns an identity-verification secret on create and never re-surfaces it', async () => {
    expect(identityVerificationSecret).toBeTruthy();
    expect(identityVerificationSecret.length).toBeGreaterThanOrEqual(32);

    // The secret persists in the channel config (RLS-protected JSONB).
    await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
    const rows = await db
      .select({ config: schema.convChannels.config })
      .from(schema.convChannels)
      .where(eq(schema.convChannels.id, channelId));
    const config = rows[0]!.config as {
      identityVerificationSecret?: string;
      requireVerifiedIdentity?: boolean;
    };
    expect(config.identityVerificationSecret).toEqual(identityVerificationSecret);
    expect(config.requireVerifiedIdentity).toBe(false);

    // An update never echoes the secret back through the response.
    const updated = await withClient(adminKey, async (c) => {
      return parseToolResult<{
        config: Record<string, unknown> & { hasIdentityVerificationSecret: boolean };
      }>(
        await c.callTool({
          name: 'conv_widget_update_channel',
          arguments: { channelId, displayName: 'Storefront Bot v2' },
        }),
      );
    });
    expect(updated.config.hasIdentityVerificationSecret).toBe(true);
    expect(updated.config).not.toHaveProperty('identityVerificationSecret');
  });

  it('toggles requireVerifiedIdentity via update', async () => {
    const enabled = await withClient(adminKey, async (c) => {
      return parseToolResult<{ config: { requireVerifiedIdentity: boolean } }>(
        await c.callTool({
          name: 'conv_widget_update_channel',
          arguments: { channelId, requireVerifiedIdentity: true },
        }),
      );
    });
    expect(enabled.config.requireVerifiedIdentity).toBe(true);

    const disabled = await withClient(adminKey, async (c) => {
      return parseToolResult<{ config: { requireVerifiedIdentity: boolean } }>(
        await c.callTool({
          name: 'conv_widget_update_channel',
          arguments: { channelId, requireVerifiedIdentity: false },
        }),
      );
    });
    expect(disabled.config.requireVerifiedIdentity).toBe(false);
  });

  it('rotates the identity secret to a fresh distinct value', async () => {
    const oldSecret = identityVerificationSecret;
    const rotated = await withClient(adminKey, async (c) => {
      return parseToolResult<{ channelId: string; identityVerificationSecret: string }>(
        await c.callTool({
          name: 'conv_widget_rotate_identity_secret',
          arguments: { channelId },
        }),
      );
    });
    expect(rotated.channelId).toBe(channelId);
    expect(rotated.identityVerificationSecret).toBeTruthy();
    expect(rotated.identityVerificationSecret.length).toBeGreaterThanOrEqual(32);
    expect(rotated.identityVerificationSecret).not.toEqual(oldSecret);

    await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
    const rows = await db
      .select({ config: schema.convChannels.config })
      .from(schema.convChannels)
      .where(eq(schema.convChannels.id, channelId));
    const config = rows[0]!.config as { identityVerificationSecret?: string };
    expect(config.identityVerificationSecret).toEqual(rotated.identityVerificationSecret);

    identityVerificationSecret = rotated.identityVerificationSecret;
  });

  it('rejects identity rotation across tenants', async () => {
    // Mint a fresh org with its own admin key, channel, and secret.
    await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
    const ts = Date.now();
    const [otherOrg] = await db
      .insert(schema.orgs)
      .values({ name: 'Widget IT Org B', slug: `widget-it-b-${ts}` })
      .returning();
    const otherAdminKey = buildApiKey('admin');
    await db.insert(schema.apiKeys).values({
      orgId: otherOrg!.id,
      type: 'admin',
      name: 'widget-it-admin-b',
      keyHash: hashSecret(otherAdminKey),
      keyPrefix: keyPrefix(otherAdminKey),
      scopes: ['*'],
    });

    // Org B's admin attempts to rotate Org A's channel secret. NotFound (404)
    // because the channel lookup is org-scoped — we must never leak the
    // existence of another tenant's channel via a different status code.
    let threw: unknown = null;
    try {
      await withClient(otherAdminKey, async (c) => {
        return parseToolResult(
          await c.callTool({
            name: 'conv_widget_rotate_identity_secret',
            arguments: { channelId },
          }),
        );
      });
    } catch (err) {
      threw = err;
    }
    expect(threw).toBeTruthy();
    expect(String(threw)).toMatch(/not found|tool error/i);

    // Secret on Org A's channel must be unchanged.
    await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
    const rows = await db
      .select({ config: schema.convChannels.config })
      .from(schema.convChannels)
      .where(eq(schema.convChannels.id, channelId));
    const config = rows[0]!.config as { identityVerificationSecret?: string };
    expect(config.identityVerificationSecret).toEqual(identityVerificationSecret);

    await db.delete(schema.orgs).where(sql`id = ${otherOrg!.id}`);
  });

  it('accepts a verified visitor and binds the contact to externalId', async () => {
    const externalId = 'user_42';
    const userHash = signHmac(externalId, identityVerificationSecret);
    const res = await call(
      'POST',
      '/api/v1/widget/messages',
      widgetKey,
      {
        channelId,
        sessionId: 'vis_verified_a',
        verifiedExternalId: externalId,
        userHash,
        visitor: { name: 'Ada' },
        messages: [{ role: 'end_user', body: 'verified hello' }],
      },
      { Origin: 'https://customer.example' },
    );
    expect(res.status).toBe(201);

    await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
    const contacts = await db
      .select()
      .from(schema.convContacts)
      .where(
        and(
          eq(schema.convContacts.orgId, orgId),
          sql`${schema.convContacts.metadata}->>'externalId' = ${externalId}`,
        ),
      );
    expect(contacts).toHaveLength(1);
    expect(contacts[0]!.name).toBe('Ada');
  });

  it('collapses one externalId across multiple sessions to a single contact', async () => {
    const externalId = 'user_multi_sess';
    const userHash = signHmac(externalId, identityVerificationSecret);

    const r1 = await call('POST', '/api/v1/widget/messages', widgetKey, {
      channelId,
      sessionId: 'vis_multi_a',
      verifiedExternalId: externalId,
      userHash,
      messages: [{ role: 'end_user', body: 'hi from device A' }],
    });
    const r2 = await call('POST', '/api/v1/widget/messages', widgetKey, {
      channelId,
      sessionId: 'vis_multi_b',
      verifiedExternalId: externalId,
      userHash,
      messages: [{ role: 'end_user', body: 'hi from device B' }],
    });
    expect(r1.status).toBe(201);
    expect(r2.status).toBe(201);
    const r1Body = r1.json as { contactId: string; conversationId: string };
    const r2Body = r2.json as { contactId: string; conversationId: string };
    expect(r1Body.contactId).toBe(r2Body.contactId);
    expect(r1Body.conversationId).not.toBe(r2Body.conversationId);
  });

  it('rejects a tampered userHash with 403', async () => {
    const externalId = 'user_tamper';
    const good = signHmac(externalId, identityVerificationSecret);
    // Flip the last hex char.
    const last = good[good.length - 1]!;
    const flipped = last === 'a' ? 'b' : 'a';
    const tampered = good.slice(0, -1) + flipped;
    const res = await call('POST', '/api/v1/widget/messages', widgetKey, {
      channelId,
      sessionId: 'vis_tampered',
      verifiedExternalId: externalId,
      userHash: tampered,
      messages: [{ role: 'end_user', body: 'should not land' }],
    });
    expect(res.status).toBe(403);
  });

  it('rejects a userHash signed with a different channels secret (cross-channel replay)', async () => {
    // Mint a second widget channel within the same org.
    const second = await withClient(adminKey, async (c) => {
      return parseToolResult<{
        id: string;
        widgetKey: string;
        identityVerificationSecret: string;
      }>(
        await c.callTool({
          name: 'conv_widget_create_channel',
          arguments: {
            name: 'storefront-bot-2',
            displayName: 'Storefront Bot 2',
            originAllowlist: ['https://customer.example'],
          },
        }),
      );
    });
    // Sign with channel-2 secret, send to channel-1.
    const externalId = 'user_replay';
    const cross = signHmac(externalId, second.identityVerificationSecret);
    const res = await call('POST', '/api/v1/widget/messages', widgetKey, {
      channelId,
      sessionId: 'vis_cross',
      verifiedExternalId: externalId,
      userHash: cross,
      messages: [{ role: 'end_user', body: 'should not land' }],
    });
    expect(res.status).toBe(403);
  });

  it('rejects partial identity attributes (one without the other)', async () => {
    const onlyExt = await call('POST', '/api/v1/widget/messages', widgetKey, {
      channelId,
      sessionId: 'vis_partial_a',
      verifiedExternalId: 'user_partial',
      messages: [{ role: 'end_user', body: 'no hash' }],
    });
    expect(onlyExt.status).toBe(403);

    const onlyHash = await call('POST', '/api/v1/widget/messages', widgetKey, {
      channelId,
      sessionId: 'vis_partial_b',
      userHash: '0'.repeat(64),
      messages: [{ role: 'end_user', body: 'no externalId' }],
    });
    expect(onlyHash.status).toBe(403);
  });

  it('rejects anonymous when requireVerifiedIdentity is on; verified passes', async () => {
    await withClient(adminKey, async (c) => {
      await c.callTool({
        name: 'conv_widget_update_channel',
        arguments: { channelId, requireVerifiedIdentity: true },
      });
    });
    try {
      const anon = await call('POST', '/api/v1/widget/messages', widgetKey, {
        channelId,
        sessionId: 'vis_required_anon',
        messages: [{ role: 'end_user', body: 'anon should fail' }],
      });
      expect(anon.status).toBe(403);

      const externalId = 'user_required';
      const userHash = signHmac(externalId, identityVerificationSecret);
      const verified = await call('POST', '/api/v1/widget/messages', widgetKey, {
        channelId,
        sessionId: 'vis_required_ok',
        verifiedExternalId: externalId,
        userHash,
        messages: [{ role: 'end_user', body: 'verified ok' }],
      });
      expect(verified.status).toBe(201);
    } finally {
      await withClient(adminKey, async (c) => {
        await c.callTool({
          name: 'conv_widget_update_channel',
          arguments: { channelId, requireVerifiedIdentity: false },
        });
      });
    }
  });

  it('rejects requests with a non-allowlisted Origin and accepts allowlisted ones', async () => {
    const denied = await call(
      'POST',
      '/api/v1/widget/messages',
      widgetKey,
      {
        channelId,
        sessionId: 'vis_origin_bad',
        messages: [{ role: 'end_user', body: 'bad origin' }],
      },
      { Origin: 'https://attacker.example' },
    );
    expect(denied.status).toBe(403);

    const allowed = await call(
      'POST',
      '/api/v1/widget/messages',
      widgetKey,
      {
        channelId,
        sessionId: 'vis_origin_ok',
        messages: [{ role: 'end_user', body: 'allowlisted origin' }],
      },
      { Origin: 'https://customer.example' },
    );
    expect(allowed.status).toBe(201);

    // No Origin (server-to-server) still passes the allowlist gate.
    const noOrigin = await call('POST', '/api/v1/widget/messages', widgetKey, {
      channelId,
      sessionId: 'vis_origin_none',
      messages: [{ role: 'end_user', body: 'no origin' }],
    });
    expect(noOrigin.status).toBe(201);
  });
});

function parseToolResult<T>(result: unknown): T {
  const r = result as { content?: Array<{ type: string; text?: string }>; isError?: boolean };
  if (r.isError) throw new Error(`tool error: ${JSON.stringify(r)}`);
  const text = r.content?.find((c) => c.type === 'text')?.text;
  if (!text) throw new Error('tool result had no text content');
  return JSON.parse(text) as T;
}

async function waitFor(check: () => Promise<boolean>, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`waitFor timeout after ${timeoutMs}ms`);
}
