import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, writeFileSync, rmSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { buildApiKey, hashSecret, keyPrefix, signHmac } from '@getmunin/core';
import { createDb, runMigrations, schema } from '@getmunin/db';
import { sql, eq, and } from 'drizzle-orm';
import { AppModule } from '../../../app.module.ts';
import { createApp } from '../../../bootstrap-app.ts';

const TEST_URL = process.env.TEST_DATABASE_URL;
const skipReason = TEST_URL
  ? null
  : 'Set TEST_DATABASE_URL to a Postgres URL to run widget integration tests.';

(skipReason ? describe.skip : describe)('Chat-widget channel integration', () => {
  let app: INestApplication;
  let baseUrl: string;
  let db: ReturnType<typeof createDb>;
  let orgId: string;
  let adminKey: string;
  let widgetKey: string;
  let channelId: string;
  let identityVerificationSecret: string;
  let widgetAssetDir: string;
  const FIXTURE_SHA = 'abcdef012345';
  const FIXTURE_BUNDLE = `widget.${FIXTURE_SHA}.js`;
  const FIXTURE_BUNDLE_BODY = '/* munin widget test fixture */ console.log("fixture");';

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
      .values({ name: 'Widget IT Org' })
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

    // Stage a fake widget bundle + manifest in a tmp dir so the static-
    // asset routes have something to serve from createApp().
    widgetAssetDir = mkdtempSync(join(tmpdir(), 'munin-widget-asset-'));
    writeFileSync(join(widgetAssetDir, FIXTURE_BUNDLE), FIXTURE_BUNDLE_BODY);
    writeFileSync(
      join(widgetAssetDir, `${FIXTURE_BUNDLE}.map`),
      JSON.stringify({ version: 3, sources: ['fixture.ts'] }),
    );
    writeFileSync(
      join(widgetAssetDir, 'manifest.json'),
      JSON.stringify({ current: FIXTURE_BUNDLE, sha: FIXTURE_SHA, builtAt: new Date().toISOString() }),
    );

    app = await createApp(AppModule, { logger: false, widgetAssetDir });
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
    if (widgetAssetDir) {
      rmSync(widgetAssetDir, { recursive: true, force: true });
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
    method: 'POST' | 'GET' | 'PATCH',
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
    const res = await call('POST', '/v1/widget/messages', widgetKey, {
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
    const first = await call('POST', '/v1/widget/messages', widgetKey, body);
    expect(first.status).toBe(201);
    expect((first.json as { inserted: number }).inserted).toBe(1);

    const second = await call('POST', '/v1/widget/messages', widgetKey, body);
    expect(second.status).toBe(201);
    expect((second.json as { inserted: number; skipped: number }).inserted).toBe(0);
    expect((second.json as { skipped: number }).skipped).toBe(1);
  });

  it('separates conversations across sessionIds on the same channel', async () => {
    const a = await call('POST', '/v1/widget/messages', widgetKey, {
      channelId,
      sessionId: 'vis_multi_a',
      messages: [{ role: 'end_user', body: 'session A' }],
    });
    const b = await call('POST', '/v1/widget/messages', widgetKey, {
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
    const res = await call('POST', '/v1/widget/messages', widgetKey, {
      channelId: 'cch_nonexistent',
      sessionId: 'vis_mismatch',
      messages: [{ role: 'end_user', body: 'should be rejected' }],
    });
    expect(res.status).toBe(403);
  });

  it('rejects an admin key with no channel binding', async () => {
    const res = await call('POST', '/v1/widget/messages', adminKey, {
      channelId,
      sessionId: 'vis_admin_attempt',
      messages: [{ role: 'end_user', body: 'admin should not ingest' }],
    });
    expect(res.status).toBe(403);
  });

  it('rejects unauthenticated requests', async () => {
    const res = await call('POST', '/v1/widget/messages', null, {
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
      const r = await call('POST', '/v1/widget/messages', oldKey, {
        channelId,
        sessionId: 'vis_post_rotation',
        messages: [{ role: 'end_user', body: 'old key should fail' }],
      });
      staleStatus = r.status;
      return r.status === 401;
    });
    expect(staleStatus).toBe(401);

    // New key works.
    const fresh = await call('POST', '/v1/widget/messages', rotated.widgetKey, {
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
    // waitFor absorbs commit-visibility races between the MCP tool's
    // commit and this separate connection's snapshot.
    await waitFor(async () => {
      await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
      const rows = await db
        .select({ config: schema.convChannels.config })
        .from(schema.convChannels)
        .where(eq(schema.convChannels.id, channelId));
      const c = rows[0]!.config as {
        identityVerificationSecret?: string;
        requireVerifiedIdentity?: boolean;
      };
      return (
        c.identityVerificationSecret === identityVerificationSecret &&
        c.requireVerifiedIdentity === false
      );
    });

    // An update never echoes the secret back through the response.
    const updated = await withClient(adminKey, async (c) => {
      return parseToolResult<{
        config: Record<string, unknown> & { hasIdentityVerificationSecret: boolean };
      }>(
        await c.callTool({
          name: 'conv_widget_update_channel',
          arguments: { channelId, originAllowlist: ['https://customer.example/v2'] },
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

    // Update the closure's secret BEFORE asserting DB persistence, so a
    // transient stale-read on this separate connection (commit visibility
    // can lag the MCP tool response by a tick under load) doesn't poison
    // every subsequent test that signs with this secret. We then waitFor
    // the DB to converge.
    identityVerificationSecret = rotated.identityVerificationSecret;
    await waitFor(async () => {
      await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
      const rows = await db
        .select({ config: schema.convChannels.config })
        .from(schema.convChannels)
        .where(eq(schema.convChannels.id, channelId));
      const config = rows[0]!.config as { identityVerificationSecret?: string };
      return config.identityVerificationSecret === rotated.identityVerificationSecret;
    });
  });

  it('rejects identity rotation across tenants', async () => {
    // Mint a fresh org with its own admin key, channel, and secret.
    await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
    const ts = Date.now();
    const [otherOrg] = await db
      .insert(schema.orgs)
      .values({ name: 'Widget IT Org B' })
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
      '/v1/widget/messages',
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

    const r1 = await call('POST', '/v1/widget/messages', widgetKey, {
      channelId,
      sessionId: 'vis_multi_a',
      verifiedExternalId: externalId,
      userHash,
      messages: [{ role: 'end_user', body: 'hi from device A' }],
    });
    const r2 = await call('POST', '/v1/widget/messages', widgetKey, {
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
    const res = await call('POST', '/v1/widget/messages', widgetKey, {
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
            originAllowlist: ['https://customer.example'],
          },
        }),
      );
    });
    // Sign with channel-2 secret, send to channel-1.
    const externalId = 'user_replay';
    const cross = signHmac(externalId, second.identityVerificationSecret);
    const res = await call('POST', '/v1/widget/messages', widgetKey, {
      channelId,
      sessionId: 'vis_cross',
      verifiedExternalId: externalId,
      userHash: cross,
      messages: [{ role: 'end_user', body: 'should not land' }],
    });
    expect(res.status).toBe(403);
  });

  it('rejects partial identity attributes (one without the other)', async () => {
    const onlyExt = await call('POST', '/v1/widget/messages', widgetKey, {
      channelId,
      sessionId: 'vis_partial_a',
      verifiedExternalId: 'user_partial',
      messages: [{ role: 'end_user', body: 'no hash' }],
    });
    expect(onlyExt.status).toBe(403);

    const onlyHash = await call('POST', '/v1/widget/messages', widgetKey, {
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
    await waitFor(async () => {
      await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
      const rows = await db
        .select({ config: schema.convChannels.config })
        .from(schema.convChannels)
        .where(eq(schema.convChannels.id, channelId));
      const c = rows[0]!.config as { requireVerifiedIdentity?: boolean };
      return c.requireVerifiedIdentity === true;
    });
    try {
      const anon = await call('POST', '/v1/widget/messages', widgetKey, {
        channelId,
        sessionId: 'vis_required_anon',
        messages: [{ role: 'end_user', body: 'anon should fail' }],
      });
      expect(anon.status).toBe(403);

      const externalId = 'user_required';
      const userHash = signHmac(externalId, identityVerificationSecret);
      const verified = await call('POST', '/v1/widget/messages', widgetKey, {
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
      await waitFor(async () => {
        await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
        const rows = await db
          .select({ config: schema.convChannels.config })
          .from(schema.convChannels)
          .where(eq(schema.convChannels.id, channelId));
        const c = rows[0]!.config as { requireVerifiedIdentity?: boolean };
        return c.requireVerifiedIdentity === false;
      });
    }
  });

  it('rejects requests with a non-allowlisted Origin and accepts allowlisted ones', async () => {
    const denied = await call(
      'POST',
      '/v1/widget/messages',
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
      '/v1/widget/messages',
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
    const noOrigin = await call('POST', '/v1/widget/messages', widgetKey, {
      channelId,
      sessionId: 'vis_origin_none',
      messages: [{ role: 'end_user', body: 'no origin' }],
    });
    expect(noOrigin.status).toBe(201);
  });

  it('lists messages ordered ascending and filters by since', async () => {
    const sessionId = 'vis_list_basic';
    const t0 = await call('POST', '/v1/widget/messages', widgetKey, {
      channelId,
      sessionId,
      messages: [
        { role: 'end_user', body: 'one' },
        { role: 'agent', body: 'two' },
        { role: 'end_user', body: 'three' },
      ],
    });
    expect(t0.status).toBe(201);

    const all = await call(
      'GET',
      `/v1/widget/messages?${qs({ channelId, sessionId })}`,
      widgetKey,
    );
    expect(all.status).toBe(200);
    const allBody = all.json as { messages: Array<{ body: string; role: string; at: string }>; hasMore: boolean };
    expect(allBody.hasMore).toBe(false);
    expect(allBody.messages.map((m) => m.body)).toEqual(['one', 'two', 'three']);
    expect(allBody.messages.map((m) => m.role)).toEqual(['end_user', 'agent', 'end_user']);
    // Strictly ascending timestamps (or equal — they were inserted in one tx).
    const times = allBody.messages.map((m) => Date.parse(m.at));
    for (let i = 1; i < times.length; i++) {
      expect(times[i]).toBeGreaterThanOrEqual(times[i - 1]!);
    }

    // since filter: exclude rows with createdAt <= since.
    const since = allBody.messages[0]!.at;
    const after = await call(
      'GET',
      `/v1/widget/messages?${qs({ channelId, sessionId, since })}`,
      widgetKey,
    );
    expect(after.status).toBe(200);
    const afterBody = after.json as { messages: Array<{ body: string }> };
    expect(afterBody.messages.map((m) => m.body)).not.toContain('one');
  });

  it('returns hasMore: true when the conversation has > 100 messages', async () => {
    const sessionId = 'vis_list_hasmore';
    const batch = Array.from({ length: 50 }, (_, i) => ({
      role: 'end_user' as const,
      body: `m${i}`,
    }));
    await call('POST', '/v1/widget/messages', widgetKey, {
      channelId,
      sessionId,
      messages: batch,
    });
    await call('POST', '/v1/widget/messages', widgetKey, {
      channelId,
      sessionId,
      messages: batch,
    });
    await call('POST', '/v1/widget/messages', widgetKey, {
      channelId,
      sessionId,
      messages: [{ role: 'end_user', body: 'final' }],
    });

    const res = await call(
      'GET',
      `/v1/widget/messages?${qs({ channelId, sessionId })}`,
      widgetKey,
    );
    expect(res.status).toBe(200);
    const body = res.json as { messages: unknown[]; hasMore: boolean };
    expect(body.messages).toHaveLength(100);
    expect(body.hasMore).toBe(true);
  });

  it('isolates GET responses by sessionId', async () => {
    const a = 'vis_list_isolate_a';
    const b = 'vis_list_isolate_b';
    await call('POST', '/v1/widget/messages', widgetKey, {
      channelId,
      sessionId: a,
      messages: [{ role: 'end_user', body: 'a-only' }],
    });
    await call('POST', '/v1/widget/messages', widgetKey, {
      channelId,
      sessionId: b,
      messages: [{ role: 'end_user', body: 'b-only' }],
    });
    const resA = await call(
      'GET',
      `/v1/widget/messages?${qs({ channelId, sessionId: a })}`,
      widgetKey,
    );
    const bodyA = resA.json as { messages: Array<{ body: string }> };
    expect(bodyA.messages.map((m) => m.body)).not.toContain('b-only');
    expect(bodyA.messages.map((m) => m.body)).toContain('a-only');
  });

  it('returns empty when GET is verified but the contact is bound to a different externalId', async () => {
    const sessionId = 'vis_list_verified_mismatch';
    const otherExt = 'user_other';
    const otherHash = signHmac(otherExt, identityVerificationSecret);

    // Bind the conversation/contact via verified ingest as user_other.
    await call('POST', '/v1/widget/messages', widgetKey, {
      channelId,
      sessionId,
      verifiedExternalId: otherExt,
      userHash: otherHash,
      messages: [{ role: 'end_user', body: 'belongs to other' }],
    });

    // Now request as a different verified user — same sessionId but
    // different externalId. Empty response (don't leak that the session
    // exists for someone else).
    const requesterExt = 'user_requester';
    const requesterHash = signHmac(requesterExt, identityVerificationSecret);
    const res = await call(
      'GET',
      `/v1/widget/messages?${qs({
        channelId,
        sessionId,
        verifiedExternalId: requesterExt,
        userHash: requesterHash,
      })}`,
      widgetKey,
    );
    expect(res.status).toBe(200);
    const body = res.json as { messages: unknown[] };
    expect(body.messages).toEqual([]);
  });

  it('rejects GET on partial / tampered identity attributes', async () => {
    const sessionId = 'vis_list_identity_bad';
    const partial = await call(
      'GET',
      `/v1/widget/messages?${qs({
        channelId,
        sessionId,
        verifiedExternalId: 'user_x',
      })}`,
      widgetKey,
    );
    expect(partial.status).toBe(403);

    const tampered = await call(
      'GET',
      `/v1/widget/messages?${qs({
        channelId,
        sessionId,
        verifiedExternalId: 'user_x',
        userHash: '0'.repeat(64),
      })}`,
      widgetKey,
    );
    expect(tampered.status).toBe(403);
  });

  it('rejects GET with a non-allowlisted Origin', async () => {
    const res = await call(
      'GET',
      `/v1/widget/messages?${qs({ channelId, sessionId: 'vis_list_origin_bad' })}`,
      widgetKey,
      undefined,
      { Origin: 'https://attacker.example' },
    );
    expect(res.status).toBe(403);
  });

  it('rejects GET when channelId in query does not match the widget keys binding', async () => {
    const second = await withClient(adminKey, async (c) => {
      return parseToolResult<{ id: string; widgetKey: string }>(
        await c.callTool({
          name: 'conv_widget_create_channel',
          arguments: {
            name: 'storefront-bot-list-other',
            originAllowlist: ['https://customer.example'],
          },
        }),
      );
    });
    const res = await call(
      'GET',
      `/v1/widget/messages?${qs({ channelId: second.id, sessionId: 'vis_other' })}`,
      widgetKey, // wrong key for that channel
    );
    expect(res.status).toBe(403);
  });

  it('rejects GET with no auth or with admin key', async () => {
    const noAuth = await call(
      'GET',
      `/v1/widget/messages?${qs({ channelId, sessionId: 'vis_list_no_auth' })}`,
      null,
    );
    expect(noAuth.status).toBe(401);
    const admin = await call(
      'GET',
      `/v1/widget/messages?${qs({ channelId, sessionId: 'vis_list_admin' })}`,
      adminKey,
    );
    expect(admin.status).toBe(403);
  });

  it('accepts an end_user body of exactly 1000 chars and rejects 1001', async () => {
    const ok = await call('POST', '/v1/widget/messages', widgetKey, {
      channelId,
      sessionId: 'vis_charcap_ok',
      messages: [{ role: 'end_user', body: 'a'.repeat(1000) }],
    });
    expect(ok.status).toBe(201);

    const tooBig = await call('POST', '/v1/widget/messages', widgetKey, {
      channelId,
      sessionId: 'vis_charcap_over',
      messages: [{ role: 'end_user', body: 'a'.repeat(1001) }],
    });
    expect(tooBig.status).toBe(403);
    expect(JSON.stringify(tooBig.json)).toMatch(/exceeds 1000 chars|too_big/i);
  });

  it('still accepts long agent bodies (operator-pushed messages keep the 50K cap)', async () => {
    const res = await call('POST', '/v1/widget/messages', widgetKey, {
      channelId,
      sessionId: 'vis_charcap_agent',
      messages: [{ role: 'agent', body: 'b'.repeat(20_000) }],
    });
    expect(res.status).toBe(201);
  });

  it('rejects an end_user bodyHtml over 4000 chars', async () => {
    const tooBig = await call('POST', '/v1/widget/messages', widgetKey, {
      channelId,
      sessionId: 'vis_charcap_html',
      messages: [
        { role: 'end_user', body: 'short', bodyHtml: '<p>' + 'x'.repeat(4001) + '</p>' },
      ],
    });
    expect(tooBig.status).toBe(403);
  });

  it('lists conversations for an identity-verified visitor across sessions', async () => {
    const externalId = `user_listconv_${Date.now()}`;
    const userHash = signHmac(externalId, identityVerificationSecret);
    const sidA = `vis_listconv_a_${Date.now()}`;
    const sidB = `vis_listconv_b_${Date.now()}`;
    await call('POST', '/v1/widget/messages', widgetKey, {
      channelId,
      sessionId: sidA,
      verifiedExternalId: externalId,
      userHash,
      messages: [{ role: 'end_user', body: 'first thread' }],
    });
    await call('POST', '/v1/widget/messages', widgetKey, {
      channelId,
      sessionId: sidB,
      verifiedExternalId: externalId,
      userHash,
      messages: [{ role: 'end_user', body: 'second thread' }],
    });

    const res = await call(
      'GET',
      `/v1/widget/conversations?${qs({
        channelId,
        verifiedExternalId: externalId,
        userHash,
      })}`,
      widgetKey,
    );
    expect(res.status).toBe(200);
    const body = res.json as { conversations: Array<{ sessionId: string; preview: string }> };
    const sids = body.conversations.map((c) => c.sessionId).sort();
    expect(sids).toEqual([sidA, sidB].sort());
    expect(body.conversations.find((c) => c.sessionId === sidA)!.preview).toBe('first thread');
  });

  it('lists conversations by anonymous sessionIds passed in the query', async () => {
    const sid = `vis_listconv_anon_${Date.now()}`;
    await call('POST', '/v1/widget/messages', widgetKey, {
      channelId,
      sessionId: sid,
      messages: [{ role: 'end_user', body: 'anonymous thread' }],
    });

    const res = await call(
      'GET',
      `/v1/widget/conversations?${qs({ channelId, sessionIds: sid })}`,
      widgetKey,
    );
    expect(res.status).toBe(200);
    const body = res.json as { conversations: Array<{ sessionId: string }> };
    expect(body.conversations.map((c) => c.sessionId)).toContain(sid);
  });

  it('returns empty when an anonymous caller passes no sessionIds', async () => {
    const res = await call(
      'GET',
      `/v1/widget/conversations?${qs({ channelId })}`,
      widgetKey,
    );
    expect(res.status).toBe(200);
    expect((res.json as { conversations: unknown[] }).conversations).toEqual([]);
  });

  it('patches the visitor email on the contact bound to the session', async () => {
    const sid = `vis_setemail_${Date.now()}`;
    await call('POST', '/v1/widget/messages', widgetKey, {
      channelId,
      sessionId: sid,
      messages: [{ role: 'end_user', body: 'pre-email' }],
    });

    const res = await call('PATCH', '/v1/widget/visitor', widgetKey, {
      channelId,
      sessionId: sid,
      email: 'set-mid-convo@example.com',
    });
    expect(res.status).toBe(200);
    const body = res.json as { email: string | null };
    expect(body.email).toBe('set-mid-convo@example.com');

    await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
    const contacts = await db
      .select({ email: schema.convContacts.email })
      .from(schema.convContacts)
      .where(
        and(
          eq(schema.convContacts.orgId, orgId),
          sql`${schema.convContacts.metadata}->>'sessionId' = ${sid}`,
        ),
      );
    expect(contacts[0]?.email).toBe('set-mid-convo@example.com');
  });

  it('rejects PATCH /visitor with mismatched channelId', async () => {
    const res = await call('PATCH', '/v1/widget/visitor', widgetKey, {
      channelId: 'cch_nonexistent',
      sessionId: 'sid_x',
      email: 'x@example.com',
    });
    expect(res.status).toBe(403);
  });

  it('returns authorKind and authorName on listed agent messages', async () => {
    const sid = `vis_author_${Date.now()}`;
    await call('POST', '/v1/widget/messages', widgetKey, {
      channelId,
      sessionId: sid,
      messages: [
        { role: 'end_user', body: 'help' },
        { role: 'agent', body: 'sure thing' },
      ],
    });
    const res = await call(
      'GET',
      `/v1/widget/messages?${qs({ channelId, sessionId: sid })}`,
      widgetKey,
    );
    expect(res.status).toBe(200);
    const body = res.json as {
      messages: Array<{ role: string; authorKind: string | null; authorName: string | null }>;
      conversation: { status: string } | null;
    };
    const agent = body.messages.find((m) => m.role === 'agent')!;
    expect(agent.authorKind).toBe('ai');
    // No assistants row for this org → falls back to 'Munin'.
    expect(agent.authorName).toBe('Munin');
    expect(body.conversation?.status).toBe('open');
  });

  it('uses the configured assistants.name for agent authorName when set', async () => {
    await db
      .insert(schema.assistants)
      .values({ orgId, name: 'Jens' })
      .onConflictDoUpdate({
        target: schema.assistants.orgId,
        set: { name: 'Jens', updatedAt: new Date() },
      });
    try {
      const sid = `vis_assistant_${Date.now()}`;
      await call('POST', '/v1/widget/messages', widgetKey, {
        channelId,
        sessionId: sid,
        messages: [
          { role: 'end_user', body: 'hi' },
          { role: 'agent', body: 'hello there' },
        ],
      });
      const res = await call(
        'GET',
        `/v1/widget/messages?${qs({ channelId, sessionId: sid })}`,
        widgetKey,
      );
      const body = res.json as {
        messages: Array<{ role: string; authorName: string | null }>;
      };
      const agent = body.messages.find((m) => m.role === 'agent')!;
      expect(agent.authorName).toBe('Jens');
    } finally {
      await db.delete(schema.assistants).where(eq(schema.assistants.orgId, orgId));
    }
  });

  it('returns first-name only for human-author messages', async () => {
    const [op] = await db
      .insert(schema.users)
      .values({ email: `widget-op-${Date.now()}@example.test`, name: 'Maja Hansen' })
      .returning();
    const opId = op!.id;
    try {
      const sid = `vis_human_${Date.now()}`;
      await call('POST', '/v1/widget/messages', widgetKey, {
        channelId,
        sessionId: sid,
        messages: [{ role: 'end_user', body: 'hi' }],
      });
      const conv = (
        await db
          .select({ id: schema.convConversations.id })
          .from(schema.convConversations)
          .where(
            and(
              eq(schema.convConversations.orgId, orgId),
              sql`${schema.convConversations.metadata}->>'sessionId' = ${sid}`,
            ),
          )
          .limit(1)
      )[0]!;
      await db.insert(schema.convMessages).values({
        orgId,
        conversationId: conv.id,
        authorType: 'user',
        authorId: opId,
        body: 'Hi — Maja here, let me look.',
      });

      const res = await call(
        'GET',
        `/v1/widget/messages?${qs({ channelId, sessionId: sid })}`,
        widgetKey,
      );
      const body = res.json as {
        messages: Array<{ role: string; authorKind: string | null; authorName: string | null }>;
      };
      const human = body.messages.find((m) => m.authorKind === 'human')!;
      expect(human.authorName).toBe('Maja');
    } finally {
      await db
        .delete(schema.convMessages)
        .where(and(eq(schema.convMessages.orgId, orgId), eq(schema.convMessages.authorId, opId)));
      await db.delete(schema.users).where(eq(schema.users.id, opId));
    }
  });

  it('returns readAt on listed messages, null until a conv_message_reads row exists', async () => {
    const sid = `vis_read_${Date.now()}`;
    await call('POST', '/v1/widget/messages', widgetKey, {
      channelId,
      sessionId: sid,
      messages: [
        { role: 'end_user', body: 'hello there' },
        { role: 'agent', body: 'an agent reply for read-state test' },
      ],
    });

    const firstRes = await call(
      'GET',
      `/v1/widget/messages?${qs({ channelId, sessionId: sid })}`,
      widgetKey,
    );
    const firstBody = firstRes.json as {
      messages: Array<{ id: string; role: string; readAt: string | null }>;
    };
    for (const m of firstBody.messages) expect(m.readAt).toBeNull();

    const agent = firstBody.messages.find((m) => m.role === 'agent')!;
    expect(agent).toBeDefined();

    const conv = (
      await db
        .select({ id: schema.convConversations.id, endUserId: schema.convConversations.endUserId })
        .from(schema.convConversations)
        .where(
          and(
            eq(schema.convConversations.orgId, orgId),
            sql`${schema.convConversations.metadata}->>'sessionId' = ${sid}`,
          ),
        )
        .limit(1)
    )[0]!;
    await db.insert(schema.convMessageReads).values({
      orgId,
      conversationId: conv.id,
      messageId: agent.id,
      endUserId: conv.endUserId!,
    });

    const secondRes = await call(
      'GET',
      `/v1/widget/messages?${qs({ channelId, sessionId: sid })}`,
      widgetKey,
    );
    const secondBody = secondRes.json as {
      messages: Array<{ id: string; role: string; readAt: string | null }>;
    };
    const markedAgent = secondBody.messages.find((m) => m.id === agent.id)!;
    expect(markedAgent.readAt).not.toBeNull();
    const visitorMsg = secondBody.messages.find((m) => m.role === 'end_user')!;
    expect(visitorMsg.readAt).toBeNull();
  });

  it('redirects GET /widget.js to the current hashed bundle with a short revalidate cache', async () => {
    const res = await fetch(`${baseUrl}/widget.js`, { method: 'GET', redirect: 'manual' });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(`/widget/${FIXTURE_BUNDLE}`);
    expect(res.headers.get('cache-control')).toContain('max-age=300');
    expect(res.headers.get('cache-control')).toContain('must-revalidate');
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('serves /widget/<sha>.js with immutable cache and JS content-type', async () => {
    const res = await fetch(`${baseUrl}/widget/${FIXTURE_BUNDLE}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/javascript');
    expect(res.headers.get('cache-control')).toContain('immutable');
    expect(res.headers.get('cache-control')).toContain('max-age=31536000');
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    const body = await res.text();
    expect(body).toBe(FIXTURE_BUNDLE_BODY);
  });

  it('serves the sourcemap with a JSON content-type', async () => {
    const res = await fetch(`${baseUrl}/widget/${FIXTURE_BUNDLE}.map`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
  });

  it('rejects non-hex hashed paths with 404', async () => {
    const res = await fetch(`${baseUrl}/widget/widget.zzzzzzzzzzzz.js`);
    expect(res.status).toBe(404);
  });

  it('rejects path traversal under /widget/', async () => {
    const res = await fetch(`${baseUrl}/widget/..%2Fmanifest.json`);
    expect(res.status).toBe(404);
  });

  it('serves 503 on /widget.js when the manifest is removed', async () => {
    const manifestPath = join(widgetAssetDir, 'manifest.json');
    unlinkSync(manifestPath);
    try {
      const res = await fetch(`${baseUrl}/widget.js`, { method: 'GET', redirect: 'manual' });
      expect(res.status).toBe(503);
      expect(res.headers.get('cache-control')).toBe('no-store');
    } finally {
      writeFileSync(
        manifestPath,
        JSON.stringify({
          current: FIXTURE_BUNDLE,
          sha: FIXTURE_SHA,
          builtAt: new Date().toISOString(),
        }),
      );
    }
  });
});

function qs(params: Record<string, string | undefined>): string {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) u.set(k, v);
  }
  return u.toString();
}

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
