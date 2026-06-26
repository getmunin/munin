import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import type { AddressInfo } from 'node:net';
import { WebSocket } from 'ws';
import { buildApiKey, hashSecret, keyPrefix, randomToken } from '@getmunin/core';
import { createDb, runMigrations, schema } from '@getmunin/db';
import { eq, inArray, sql } from 'drizzle-orm';
import { createApp } from '../bootstrap-app.ts';
import { AppModule } from '../app.module.ts';

const TEST_URL = process.env.TEST_DATABASE_URL;
const skipReason = TEST_URL
  ? null
  : 'Set TEST_DATABASE_URL to a Postgres URL to run control-plane controller tests.';

interface OrgFixture {
  id: string;
  adminKey: string;
  adminKeyId: string;
  endUserId: string;
  userId: string;
  sessionToken: string;
}

(skipReason ? describe.skip : describe)('Control plane controllers (HTTP integration)', () => {
  let app: INestApplication;
  let baseUrl: string;
  let db: ReturnType<typeof createDb>;
  let orgA: OrgFixture;
  let orgB: OrgFixture;

  beforeAll(async () => {
    process.env.MUNIN_AUTH_SECRET ??= 'test-secret-do-not-use-in-prod';
    process.env.MUNIN_KEY_PEPPER ??= 'test-pepper';
    process.env.MUNIN_EMBEDDING_PROVIDER = 'stub';
    process.env.MUNIN_MAIL_PROVIDER = 'stub';
    process.env.MUNIN_WEBHOOK_WORKER_DISABLED = '1';
    process.env.MUNIN_CMS_SCHEDULE_WORKER_DISABLED = '1';
    process.env.MUNIN_STORAGE_PROVIDER = 'local';

    await runMigrations(TEST_URL!);

    const appUrl = TEST_URL!.replace(/(postgres(?:ql)?:\/\/)[^:@]+:[^@]+@/, '$1munin_app:munin_app@');
    process.env.DATABASE_URL = appUrl;

    db = createDb(TEST_URL!, { serviceRole: true });
    await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);

    orgA = await seedOrg('cp-a');
    orgB = await seedOrg('cp-b');

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
      if (orgA) await db.delete(schema.orgs).where(eq(schema.orgs.id, orgA.id));
      if (orgB) await db.delete(schema.orgs).where(eq(schema.orgs.id, orgB.id));
    }
  });

  async function seedOrg(prefix: string): Promise<OrgFixture> {
    const ts = Date.now();
    const label = `${prefix}-${ts}-${Math.floor(Math.random() * 1e6)}`;
    const [org] = await db
      .insert(schema.orgs)
      .values({ name: `Org ${label}` })
      .returning();
    const orgId = org!.id;

    const adminKey = buildApiKey('admin');
    const [keyRow] = await db
      .insert(schema.apiKeys)
      .values({
        orgId,
        type: 'admin',
        name: `${prefix}-admin`,
        keyHash: hashSecret(adminKey),
        keyPrefix: keyPrefix(adminKey),
        scopes: ['*'],
      })
      .returning({ id: schema.apiKeys.id });

    const [eu] = await db
      .insert(schema.endUsers)
      .values({ orgId, externalId: `eu-${label}`, name: 'End User One' })
      .returning();

    const [user] = await db
      .insert(schema.users)
      .values({ email: `${label}@example.com`, name: 'Owner User' })
      .returning();
    await db
      .insert(schema.orgMembers)
      .values({ orgId, userId: user!.id, role: 'owner', isDefault: true });

    const sessionToken = randomToken(32);
    await db.insert(schema.sessions).values({
      userId: user!.id,
      token: sessionToken,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });

    return {
      id: orgId,
      adminKey,
      adminKeyId: keyRow!.id,
      endUserId: eu!.id,
      userId: user!.id,
      sessionToken,
    };
  }

  function authHeaders(key: string): Record<string, string> {
    return { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
  }

  function cookieHeaders(token: string): Record<string, string> {
    return {
      Cookie: `better-auth.session_token=${token}.placeholder-sig`,
      'Content-Type': 'application/json',
    };
  }


  describe('POST/GET/DELETE /v1/api-keys', () => {
    it('rejects unauthenticated request with 401', async () => {
      const res = await fetch(`${baseUrl}/v1/api-keys`);
      expect(res.status).toBe(401);
    });

    it('admin can create, list, and revoke keys', async () => {
      const create = await fetch(`${baseUrl}/v1/api-keys`, {
        method: 'POST',
        headers: authHeaders(orgA.adminKey),
        body: JSON.stringify({ name: 'extra-key', scopes: ['kb:read'] }),
      });
      expect(create.status).toBe(201);
      const created = (await create.json()) as { id: string; key: string; prefix: string };
      expect(created.key).toMatch(/^mn_admin_/);

      const list = await fetch(`${baseUrl}/v1/api-keys`, { headers: authHeaders(orgA.adminKey) });
      expect(list.status).toBe(200);
      const items = (await list.json()) as Array<{ id: string }>;
      expect(items.find((k) => k.id === created.id)).toBeTruthy();

      const revoke = await fetch(`${baseUrl}/v1/api-keys/${created.id}`, {
        method: 'DELETE',
        headers: authHeaders(orgA.adminKey),
      });
      expect(revoke.status).toBe(204);

      const afterList = await fetch(`${baseUrl}/v1/api-keys`, {
        headers: authHeaders(orgA.adminKey),
      });
      const afterItems = (await afterList.json()) as Array<{ id: string }>;
      expect(afterItems.find((k) => k.id === created.id)).toBeFalsy();
    });

    it('cross-org: org A cannot revoke org B\'s key', async () => {
      const res = await fetch(`${baseUrl}/v1/api-keys/${orgB.adminKeyId}`, {
        method: 'DELETE',
        headers: authHeaders(orgA.adminKey),
      });
      expect(res.status).toBe(404);
    });

    it('widget key cannot mint admin API keys', async () => {
      const widgetKey = buildApiKey('widget');
      const [channel] = await db
        .insert(schema.convChannels)
        .values({
          orgId: orgA.id,
          type: 'chat',
          vendor: 'munin',
          name: 'cp-widget-escalation-channel',
        })
        .returning();
      await db.insert(schema.apiKeys).values({
        orgId: orgA.id,
        type: 'widget',
        name: 'cp-widget-escalation-test',
        keyHash: hashSecret(widgetKey),
        keyPrefix: keyPrefix(widgetKey),
        scopes: ['conv:widget:write'],
        channelId: channel!.id,
      });

      const create = await fetch(`${baseUrl}/v1/api-keys`, {
        method: 'POST',
        headers: authHeaders(widgetKey),
        body: JSON.stringify({ name: 'pwned', scopes: ['*'] }),
      });
      expect(create.status).toBe(403);

      const list = await fetch(`${baseUrl}/v1/api-keys`, { headers: authHeaders(widgetKey) });
      expect(list.status).toBe(403);

      const revoke = await fetch(`${baseUrl}/v1/api-keys/${orgA.adminKeyId}`, {
        method: 'DELETE',
        headers: authHeaders(widgetKey),
      });
      expect(revoke.status).toBe(403);
    });

    it('scoped admin key (no "*") cannot mint, list, or revoke', async () => {
      const scopedKey = buildApiKey('admin');
      await db.insert(schema.apiKeys).values({
        orgId: orgA.id,
        type: 'admin',
        name: 'cp-scoped-admin',
        keyHash: hashSecret(scopedKey),
        keyPrefix: keyPrefix(scopedKey),
        scopes: ['kb:read'],
      });
      const create = await fetch(`${baseUrl}/v1/api-keys`, {
        method: 'POST',
        headers: authHeaders(scopedKey),
        body: JSON.stringify({ name: 'escalate', scopes: ['*'] }),
      });
      expect(create.status).toBe(403);
      const list = await fetch(`${baseUrl}/v1/api-keys`, { headers: authHeaders(scopedKey) });
      expect(list.status).toBe(403);
    });
  });

  describe('control-plane guard on other admin routes', () => {
    it('widget key cannot list channels or enqueue curator jobs', async () => {
      const widgetKey = buildApiKey('widget');
      const [channel] = await db
        .insert(schema.convChannels)
        .values({
          orgId: orgA.id,
          type: 'chat',
          vendor: 'munin',
          name: 'cp-widget-cross-route-channel',
        })
        .returning();
      await db.insert(schema.apiKeys).values({
        orgId: orgA.id,
        type: 'widget',
        name: 'cp-widget-cross-route',
        keyHash: hashSecret(widgetKey),
        keyPrefix: keyPrefix(widgetKey),
        scopes: ['conv:widget:write'],
        channelId: channel!.id,
      });
      const channels = await fetch(`${baseUrl}/v1/conversations/channels`, {
        headers: authHeaders(widgetKey),
      });
      expect(channels.status).toBe(403);
      const enq = await fetch(`${baseUrl}/v1/curator/jobs`, {
        method: 'POST',
        headers: authHeaders(widgetKey),
        body: JSON.stringify({ jobUri: 'skill://kb/review-content', userPrompt: 'try' }),
      });
      expect(enq.status).toBe(403);
    });

    it('scoped admin key cannot enqueue curator jobs', async () => {
      const scopedKey = buildApiKey('admin');
      await db.insert(schema.apiKeys).values({
        orgId: orgA.id,
        type: 'admin',
        name: 'cp-scoped-admin-curator',
        keyHash: hashSecret(scopedKey),
        keyPrefix: keyPrefix(scopedKey),
        scopes: ['kb:read'],
      });
      const enq = await fetch(`${baseUrl}/v1/curator/jobs`, {
        method: 'POST',
        headers: authHeaders(scopedKey),
        body: JSON.stringify({ jobUri: 'skill://kb/review-content', userPrompt: 'try' }),
      });
      expect(enq.status).toBe(403);
    });
  });


  describe('transfer endpoints enforce the control-plane guard', () => {
    const EXPORT_GETS = [
      '/v1/kb/export',
      '/v1/crm/export',
      '/v1/cms/transfer/export',
      '/v1/conv/export',
      '/v1/outreach/export',
      '/v1/analytics/export/config',
      '/v1/analytics/export/events',
    ] as const;
    const IMPORT_POSTS = [
      '/v1/kb/import',
      '/v1/crm/import',
      '/v1/cms/transfer/import',
      '/v1/conv/import',
      '/v1/outreach/import',
      '/v1/analytics/import',
    ] as const;

    let widgetKey: string;
    let scopedAdminKey: string;

    beforeAll(async () => {
      widgetKey = buildApiKey('widget');
      const [channel] = await db
        .insert(schema.convChannels)
        .values({
          orgId: orgA.id,
          type: 'chat',
          vendor: 'munin',
          name: 'cp-transfer-widget-channel',
        })
        .returning();
      await db.insert(schema.apiKeys).values({
        orgId: orgA.id,
        type: 'widget',
        name: 'cp-transfer-widget',
        keyHash: hashSecret(widgetKey),
        keyPrefix: keyPrefix(widgetKey),
        scopes: ['conv:widget:write'],
        channelId: channel!.id,
      });

      scopedAdminKey = buildApiKey('admin');
      await db.insert(schema.apiKeys).values({
        orgId: orgA.id,
        type: 'admin',
        name: 'cp-transfer-scoped-admin',
        keyHash: hashSecret(scopedAdminKey),
        keyPrefix: keyPrefix(scopedAdminKey),
        scopes: ['kb:read', 'crm:read', 'cms:read', 'conv:read', 'outreach:read', 'analytics:read'],
      });
    });

    for (const path of EXPORT_GETS) {
      it(`GET ${path} is 401 unauthenticated`, async () => {
        const res = await fetch(`${baseUrl}${path}`);
        expect(res.status).toBe(401);
      });

      it(`GET ${path} rejects a widget key (403)`, async () => {
        const res = await fetch(`${baseUrl}${path}`, { headers: authHeaders(widgetKey) });
        expect(res.status).toBe(403);
      });

      it(`GET ${path} rejects a scoped admin key without "*" (403)`, async () => {
        const res = await fetch(`${baseUrl}${path}`, { headers: authHeaders(scopedAdminKey) });
        expect(res.status).toBe(403);
      });
    }

    for (const path of IMPORT_POSTS) {
      it(`POST ${path} is 401 unauthenticated`, async () => {
        const res = await fetch(`${baseUrl}${path}`, {
          method: 'POST',
          body: JSON.stringify({}),
          headers: { 'Content-Type': 'application/json' },
        });
        expect(res.status).toBe(401);
      });

      it(`POST ${path} rejects a widget key (403)`, async () => {
        const res = await fetch(`${baseUrl}${path}`, {
          method: 'POST',
          headers: authHeaders(widgetKey),
          body: JSON.stringify({}),
        });
        expect(res.status).toBe(403);
      });

      it(`POST ${path} rejects a scoped admin key without "*" (403)`, async () => {
        const res = await fetch(`${baseUrl}${path}`, {
          method: 'POST',
          headers: authHeaders(scopedAdminKey),
          body: JSON.stringify({}),
        });
        expect(res.status).toBe(403);
      });
    }
  });


  describe('GET /v1/tokens, DELETE /v1/tokens/:id', () => {
    it('401 when unauthenticated', async () => {
      const res = await fetch(`${baseUrl}/v1/tokens`);
      expect(res.status).toBe(401);
    });

    it('returns tokens for the calling org only', async () => {
      const mint = await fetch(`${baseUrl}/v1/tokens/delegated`, {
        method: 'POST',
        headers: authHeaders(orgA.adminKey),
        body: JSON.stringify({ endUserId: orgA.endUserId, ttlSeconds: 600, scopes: ['kb:read'] }),
      });
      expect(mint.status).toBe(201);
      const minted = (await mint.json()) as { tokenId: string };

      const list = await fetch(`${baseUrl}/v1/tokens`, { headers: authHeaders(orgA.adminKey) });
      const tokens = (await list.json()) as Array<{ id: string; endUserId: string }>;
      expect(tokens.find((t) => t.id === minted.tokenId)).toBeTruthy();

      const listB = await fetch(`${baseUrl}/v1/tokens`, { headers: authHeaders(orgB.adminKey) });
      const tokensB = (await listB.json()) as Array<{ id: string }>;
      expect(tokensB.find((t) => t.id === minted.tokenId)).toBeFalsy();

      const rv = await fetch(`${baseUrl}/v1/tokens/${minted.tokenId}`, {
        method: 'DELETE',
        headers: authHeaders(orgA.adminKey),
      });
      expect(rv.status).toBe(204);

      const otherMint = await fetch(`${baseUrl}/v1/tokens/delegated`, {
        method: 'POST',
        headers: authHeaders(orgB.adminKey),
        body: JSON.stringify({ externalId: 'b-eu', ttlSeconds: 300, scopes: ['kb:read'] }),
      });
      const otherTok = (await otherMint.json()) as { tokenId: string };
      const wrongOrg = await fetch(`${baseUrl}/v1/tokens/${otherTok.tokenId}`, {
        method: 'DELETE',
        headers: authHeaders(orgA.adminKey),
      });
      expect(wrongOrg.status).toBe(404);
    });

    it('collapses an OAuth agent into one flock row per org, scoped by pinned reference_id, and revokes only the caller org', async () => {
      const label = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
      const name = `Claude Code ${label}`;
      const clientA = `oauth-client-a-${label}`;
      const clientB = `oauth-client-b-${label}`;
      const clientC = `oauth-client-c-${label}`;
      const allClients = [clientA, clientB, clientC];
      const live = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      const icon = 'https://example.com/icon.png';
      await db.insert(schema.oauthClient).values(
        allClients.map((clientId) => ({ clientId, name, icon, redirectUris: ['https://example.com/cb'] })),
      );
      await db.insert(schema.oauthRefreshToken).values([
        {
          token: `rt-a-${label}`,
          clientId: clientA,
          userId: orgA.userId,
          referenceId: orgA.id,
          expiresAt: live,
          scopes: ['mcp:admin', 'kb:read'],
        },
        {
          token: `rt-b-${label}`,
          clientId: clientB,
          userId: orgA.userId,
          referenceId: orgA.id,
          expiresAt: live,
          scopes: ['mcp:admin', 'crm:write'],
        },
        {
          token: `rt-c-${label}`,
          clientId: clientC,
          userId: orgA.userId,
          referenceId: orgB.id,
          expiresAt: live,
          scopes: ['mcp:admin'],
        },
        {
          token: `rt-expired-${label}`,
          clientId: clientA,
          userId: orgA.userId,
          referenceId: orgA.id,
          expiresAt: new Date(Date.now() - 60 * 1000),
          scopes: ['mcp:admin'],
        },
        {
          token: `rt-revoked-${label}`,
          clientId: clientA,
          userId: orgA.userId,
          referenceId: orgA.id,
          expiresAt: live,
          revoked: new Date(),
          scopes: ['mcp:admin'],
        },
      ]);

      const list = await fetch(`${baseUrl}/v1/tokens`, { headers: authHeaders(orgA.adminKey) });
      const tokens = (await list.json()) as Array<{
        id: string;
        type: string;
        origin: string | null;
        iconUrl: string | null;
        count: number;
        scopes: string[];
      }>;
      const oauthRows = tokens.filter((t) => t.origin === name);
      expect(oauthRows).toHaveLength(1);
      const agentRow = oauthRows[0]!;
      expect(agentRow.id.startsWith('orft_')).toBe(true);
      expect(agentRow.type).toBe('oauth_refresh');
      expect(agentRow.count).toBe(2);
      expect(agentRow.iconUrl).toBe(icon);
      expect(agentRow.scopes.sort()).toEqual(['crm:write', 'kb:read', 'mcp:admin']);

      const listB = await fetch(`${baseUrl}/v1/tokens`, { headers: authHeaders(orgB.adminKey) });
      const tokensB = (await listB.json()) as Array<{ id: string; origin: string | null; count: number }>;
      const oauthRowsB = tokensB.filter((t) => t.origin === name);
      expect(oauthRowsB).toHaveLength(1);
      expect(oauthRowsB[0]!.count).toBe(1);
      expect(tokensB.find((t) => t.id === agentRow.id)).toBeFalsy();
      const wrongOrg = await fetch(`${baseUrl}/v1/tokens/${agentRow.id}`, {
        method: 'DELETE',
        headers: authHeaders(orgB.adminKey),
      });
      expect(wrongOrg.status).toBe(404);

      const rv = await fetch(`${baseUrl}/v1/tokens/${agentRow.id}`, {
        method: 'DELETE',
        headers: authHeaders(orgA.adminKey),
      });
      expect(rv.status).toBe(204);
      const remaining = await db
        .select({
          clientId: schema.oauthRefreshToken.clientId,
          revoked: schema.oauthRefreshToken.revoked,
        })
        .from(schema.oauthRefreshToken)
        .where(inArray(schema.oauthRefreshToken.clientId, allClients));
      const revokedFor = (clientId: string) =>
        remaining.filter((r) => r.clientId === clientId).every((r) => r.revoked !== null);
      expect(revokedFor(clientA)).toBe(true);
      expect(revokedFor(clientB)).toBe(true);
      expect(remaining.find((r) => r.clientId === clientC)!.revoked).toBeNull();

      const afterA = await fetch(`${baseUrl}/v1/tokens`, { headers: authHeaders(orgA.adminKey) });
      const afterTokensA = (await afterA.json()) as Array<{ origin: string | null }>;
      expect(afterTokensA.find((t) => t.origin === name)).toBeFalsy();
      const afterB = await fetch(`${baseUrl}/v1/tokens`, { headers: authHeaders(orgB.adminKey) });
      const afterTokensB = (await afterB.json()) as Array<{ origin: string | null }>;
      expect(afterTokensB.find((t) => t.origin === name)).toBeTruthy();

      await db.delete(schema.oauthRefreshToken).where(inArray(schema.oauthRefreshToken.clientId, allClients));
      await db.delete(schema.oauthClient).where(inArray(schema.oauthClient.clientId, allClients));
    });
  });


  describe('POST /v1/tokens/delegated', () => {
    it('401 when unauthenticated', async () => {
      const res = await fetch(`${baseUrl}/v1/tokens/delegated`, {
        method: 'POST',
        body: JSON.stringify({ externalId: 'x' }),
        headers: { 'Content-Type': 'application/json' },
      });
      expect(res.status).toBe(401);
    });

    it('400 when no end-user identity supplied', async () => {
      const res = await fetch(`${baseUrl}/v1/tokens/delegated`, {
        method: 'POST',
        headers: authHeaders(orgA.adminKey),
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
    });

    it('mints a delegated token with audience+scopes and finds-or-creates an end-user', async () => {
      const res = await fetch(`${baseUrl}/v1/tokens/delegated`, {
        method: 'POST',
        headers: authHeaders(orgA.adminKey),
        body: JSON.stringify({
          externalId: `new-${Date.now()}`,
          name: 'Customer',
          ttlSeconds: 600,
          scopes: ['kb:read'],
          audiences: ['self_service'],
        }),
      });
      expect(res.status).toBe(201);
      const body = (await res.json()) as {
        accessToken: string;
        endUserId: string;
        scopes: string[];
        audiences: string[];
      };
      expect(body.accessToken).toMatch(/^mn_dlg_/);
      expect(body.scopes).toEqual(['kb:read']);
      expect(body.audiences).toEqual(['self_service']);
    });
  });


  describe('/v1/end-users', () => {
    it('401 unauthenticated', async () => {
      const res = await fetch(`${baseUrl}/v1/end-users`);
      expect(res.status).toBe(401);
    });

    it('lookup is idempotent (creates first, returns the same row second)', async () => {
      const ext = `eu-look-${Date.now()}`;
      const first = await fetch(`${baseUrl}/v1/end-users/lookup`, {
        method: 'POST',
        headers: authHeaders(orgA.adminKey),
        body: JSON.stringify({ externalId: ext }),
      });
      expect(first.status).toBe(200);
      const a = (await first.json()) as { id: string };
      const second = await fetch(`${baseUrl}/v1/end-users/lookup`, {
        method: 'POST',
        headers: authHeaders(orgA.adminKey),
        body: JSON.stringify({ externalId: ext }),
      });
      const b = (await second.json()) as { id: string };
      expect(a.id).toBe(b.id);
    });

    it('list is org-scoped; cross-org cannot see another org\'s end-users', async () => {
      const list = await fetch(`${baseUrl}/v1/end-users`, { headers: authHeaders(orgA.adminKey) });
      const items = (await list.json()) as Array<{ id: string }>;
      expect(items.find((u) => u.id === orgA.endUserId)).toBeTruthy();
      const cross = await fetch(`${baseUrl}/v1/end-users/${orgA.endUserId}`, {
        headers: authHeaders(orgB.adminKey),
      });
      expect(cross.status).toBe(404);
    });

    it('revoke-tokens revokes all active tokens for an end-user', async () => {
      for (let i = 0; i < 2; i++) {
        await fetch(`${baseUrl}/v1/tokens/delegated`, {
          method: 'POST',
          headers: authHeaders(orgA.adminKey),
          body: JSON.stringify({
            endUserId: orgA.endUserId,
            ttlSeconds: 300,
            scopes: ['kb:read'],
          }),
        });
      }
      const res = await fetch(`${baseUrl}/v1/end-users/${orgA.endUserId}/revoke-tokens`, {
        method: 'POST',
        headers: authHeaders(orgA.adminKey),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { revoked: number };
      expect(body.revoked).toBeGreaterThanOrEqual(2);
    });
  });


  describe('/v1/orgs/me', () => {
    it('401 unauthenticated', async () => {
      const res = await fetch(`${baseUrl}/v1/orgs/me`);
      expect(res.status).toBe(401);
    });

    it('returns the calling org', async () => {
      const res = await fetch(`${baseUrl}/v1/orgs/me`, { headers: authHeaders(orgA.adminKey) });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { id: string };
      expect(body.id).toBe(orgA.id);
    });

    it('updates name and settings', async () => {
      const res = await fetch(`${baseUrl}/v1/orgs/me`, {
        method: 'PATCH',
        headers: authHeaders(orgA.adminKey),
        body: JSON.stringify({ name: 'Updated Org A', settings: { foo: 'bar' } }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { name: string; settings: Record<string, unknown> };
      expect(body.name).toBe('Updated Org A');
      expect(body.settings).toEqual({ foo: 'bar' });
    });
  });


  describe('/v1/webhooks', () => {
    it('401 unauthenticated', async () => {
      const res = await fetch(`${baseUrl}/v1/webhooks`);
      expect(res.status).toBe(401);
    });

    it('CRUD with cross-org isolation', async () => {
      const create = await fetch(`${baseUrl}/v1/webhooks`, {
        method: 'POST',
        headers: authHeaders(orgA.adminKey),
        body: JSON.stringify({ url: 'https://example.com/hook', events: ['kb.document.created'] }),
      });
      expect(create.status).toBe(201);
      const wh = (await create.json()) as { id: string; secret: string };
      expect(wh.secret).toMatch(/^whsec_/);

      const patch = await fetch(`${baseUrl}/v1/webhooks/${wh.id}`, {
        method: 'PATCH',
        headers: authHeaders(orgA.adminKey),
        body: JSON.stringify({ active: false }),
      });
      expect(patch.status).toBe(200);
      const patched = (await patch.json()) as { active: boolean };
      expect(patched.active).toBe(false);

      const cross = await fetch(`${baseUrl}/v1/webhooks/${wh.id}`, {
        method: 'PATCH',
        headers: authHeaders(orgB.adminKey),
        body: JSON.stringify({ active: true }),
      });
      expect(cross.status).toBe(404);
      const crossDel = await fetch(`${baseUrl}/v1/webhooks/${wh.id}`, {
        method: 'DELETE',
        headers: authHeaders(orgB.adminKey),
      });
      expect(crossDel.status).toBe(404);

      const del = await fetch(`${baseUrl}/v1/webhooks/${wh.id}`, {
        method: 'DELETE',
        headers: authHeaders(orgA.adminKey),
      });
      expect(del.status).toBe(204);
    });
  });


  describe('GET /v1/audit-logs', () => {
    it('401 unauthenticated', async () => {
      const res = await fetch(`${baseUrl}/v1/audit-logs`);
      expect(res.status).toBe(401);
    });

    it('returns paginated audit entries for the calling org', async () => {
      await fetch(`${baseUrl}/v1/orgs/me`, { headers: authHeaders(orgA.adminKey) });
      const res = await fetch(`${baseUrl}/v1/audit-logs?limit=10`, {
        headers: authHeaders(orgA.adminKey),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { items: unknown[]; nextCursor: string | null };
      expect(Array.isArray(body.items)).toBe(true);
    });
  });


  describe('GET /v1/usage', () => {
    it('401 unauthenticated', async () => {
      const res = await fetch(`${baseUrl}/v1/usage`);
      expect(res.status).toBe(401);
    });

    it('returns usage payload for the calling org', async () => {
      const res = await fetch(`${baseUrl}/v1/usage`, { headers: authHeaders(orgA.adminKey) });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toBeTypeOf('object');
    });
  });


  describe('/v1/orgs/me/invitations (admin)', () => {
    it('401 unauthenticated', async () => {
      const res = await fetch(`${baseUrl}/v1/orgs/me/invitations`);
      expect(res.status).toBe(401);
    });

    it('admin API key cannot create invitations (owner-user session required)', async () => {
      const res = await fetch(`${baseUrl}/v1/orgs/me/invitations`, {
        method: 'POST',
        headers: authHeaders(orgA.adminKey),
        body: JSON.stringify({ email: `forbidden-${Date.now()}@example.com` }),
      });
      expect(res.status).toBe(403);
    });

    it('owner via session cookie issues, lists, and revokes invitations', async () => {
      const create = await fetch(`${baseUrl}/v1/orgs/me/invitations`, {
        method: 'POST',
        headers: cookieHeaders(orgA.sessionToken),
        body: JSON.stringify({ email: `invitee-${Date.now()}@example.com`, role: 'member' }),
      });
      expect(create.status).toBe(201);
      const inv = (await create.json()) as { id: string; token?: string };

      const list = await fetch(`${baseUrl}/v1/orgs/me/invitations`, {
        headers: cookieHeaders(orgA.sessionToken),
      });
      expect(list.status).toBe(200);
      const items = (await list.json()) as Array<{ id: string }>;
      expect(items.find((i) => i.id === inv.id)).toBeTruthy();

      const revoke = await fetch(`${baseUrl}/v1/orgs/me/invitations/${inv.id}`, {
        method: 'DELETE',
        headers: cookieHeaders(orgA.sessionToken),
      });
      expect(revoke.status).toBe(200);
    });
  });


  describe('/v1/invitations (lookup + accept)', () => {
    it('lookup is anonymous and returns 404 for unknown token', async () => {
      const res = await fetch(`${baseUrl}/v1/invitations/lookup?token=bogus`);
      expect(res.status).toBe(404);
    });

    it('lookup with a valid token returns invitation detail', async () => {
      const create = await fetch(`${baseUrl}/v1/orgs/me/invitations`, {
        method: 'POST',
        headers: cookieHeaders(orgA.sessionToken),
        body: JSON.stringify({ email: `lookup-${Date.now()}@example.com` }),
      });
      const inv = (await create.json()) as { id: string; token: string };
      const res = await fetch(
        `${baseUrl}/v1/invitations/lookup?token=${encodeURIComponent(inv.token)}`,
      );
      expect(res.status).toBe(200);
    });

    it('accept without session cookie is forbidden', async () => {
      const res = await fetch(`${baseUrl}/v1/invitations/accept`, {
        method: 'POST',
        body: JSON.stringify({ token: 'whatever' }),
        headers: { 'Content-Type': 'application/json' },
      });
      expect(res.status).toBe(403);
    });
  });


  describe('/v1/orgs/me/members', () => {
    it('401 without credentials', async () => {
      const res = await fetch(`${baseUrl}/v1/orgs/me/members`);
      expect(res.status).toBe(401);
    });

    it('admin API key can list members of its org', async () => {
      const res = await fetch(`${baseUrl}/v1/orgs/me/members`, {
        headers: authHeaders(orgA.adminKey),
      });
      expect(res.status).toBe(200);
      const items = (await res.json()) as Array<{ userId: string }>;
      expect(items.find((m) => m.userId === orgA.userId)).toBeTruthy();
      expect(items.find((m) => m.userId === orgB.userId)).toBeFalsy();
    });

    it('admin API key cannot demote/remove members (owner-user only)', async () => {
      const patch = await fetch(`${baseUrl}/v1/orgs/me/members/${orgA.userId}`, {
        method: 'PATCH',
        headers: authHeaders(orgA.adminKey),
        body: JSON.stringify({ role: 'member' }),
      });
      expect(patch.status).toBe(403);
    });
  });


  describe('/v1/me/memberships', () => {
    it('user session can list its memberships', async () => {
      const res = await fetch(`${baseUrl}/v1/me/memberships`, {
        headers: cookieHeaders(orgA.sessionToken),
      });
      expect(res.status).toBe(200);
      const items = (await res.json()) as Array<{ orgId: string }>;
      expect(items.find((m) => m.orgId === orgA.id)).toBeTruthy();
    });

    it('admin API key cannot list memberships (user session required)', async () => {
      const res = await fetch(`${baseUrl}/v1/me/memberships`, {
        headers: authHeaders(orgA.adminKey),
      });
      expect(res.status).toBe(403);
    });
  });


  describe('settings endpoints role gating (user session)', () => {
    let memberCookie: Record<string, string>;
    let adminCookie: Record<string, string>;

    beforeAll(async () => {
      const memberSlug = `cp-a-member-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
      const adminSlug = `cp-a-admin-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
      const [member] = await db
        .insert(schema.users)
        .values({ email: `${memberSlug}@example.com`, name: 'Member User' })
        .returning();
      const [admin] = await db
        .insert(schema.users)
        .values({ email: `${adminSlug}@example.com`, name: 'Admin User' })
        .returning();
      await db
        .insert(schema.orgMembers)
        .values({ orgId: orgA.id, userId: member!.id, role: 'member' });
      await db
        .insert(schema.orgMembers)
        .values({ orgId: orgA.id, userId: admin!.id, role: 'admin' });

      const memberToken = randomToken(32);
      const adminToken = randomToken(32);
      await db.insert(schema.sessions).values([
        {
          userId: member!.id,
          token: memberToken,
          expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        },
        {
          userId: admin!.id,
          token: adminToken,
          expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        },
      ]);
      memberCookie = cookieHeaders(memberToken);
      adminCookie = cookieHeaders(adminToken);
    });

    const READ_ENDPOINTS = [
      ['/v1/api-keys', 'GET'],
      ['/v1/audit-logs', 'GET'],
      ['/v1/usage', 'GET'],
      ['/v1/end-users', 'GET'],
      ['/v1/tokens', 'GET'],
      ['/v1/orgs/me/members', 'GET'],
      ['/v1/orgs/me/invitations', 'GET'],
    ] as const;

    for (const [path] of READ_ENDPOINTS) {
      it(`member role is forbidden from GET ${path}`, async () => {
        const res = await fetch(`${baseUrl}${path}`, { headers: memberCookie });
        expect(res.status).toBe(403);
      });

      it(`admin role can GET ${path}`, async () => {
        const res = await fetch(`${baseUrl}${path}`, { headers: adminCookie });
        expect(res.status).toBe(200);
      });
    }

    it('member cannot create API keys (403)', async () => {
      const res = await fetch(`${baseUrl}/v1/api-keys`, {
        method: 'POST',
        headers: memberCookie,
        body: JSON.stringify({ name: 'member-attempt', scopes: [] }),
      });
      expect(res.status).toBe(403);
    });

    it('admin can create API keys (201)', async () => {
      const res = await fetch(`${baseUrl}/v1/api-keys`, {
        method: 'POST',
        headers: adminCookie,
        body: JSON.stringify({ name: `admin-${Date.now()}`, scopes: [] }),
      });
      expect(res.status).toBe(201);
    });

    it('admin cannot invite members (owner-only) — 403', async () => {
      const res = await fetch(`${baseUrl}/v1/orgs/me/invitations`, {
        method: 'POST',
        headers: adminCookie,
        body: JSON.stringify({ email: `admin-cannot-invite-${Date.now()}@example.com` }),
      });
      expect(res.status).toBe(403);
    });

    it('admin cannot change another member\'s role (owner-only) — 403', async () => {
      const res = await fetch(`${baseUrl}/v1/orgs/me/members/${orgA.userId}`, {
        method: 'PATCH',
        headers: adminCookie,
        body: JSON.stringify({ role: 'member' }),
      });
      expect(res.status).toBe(403);
    });

    const WEBHOOK_MEMBER_DENIED = [
      ['GET', '/v1/webhooks', undefined],
      ['POST', '/v1/webhooks', { url: 'https://hook.example/x', events: [] }],
    ] as const;
    for (const [method, path, body] of WEBHOOK_MEMBER_DENIED) {
      it(`member cannot ${method} ${path} (403)`, async () => {
        const res = await fetch(`${baseUrl}${path}`, {
          method,
          headers: memberCookie,
          body: body ? JSON.stringify(body) : undefined,
        });
        expect(res.status).toBe(403);
      });
    }

    it('admin can list /v1/webhooks (200)', async () => {
      const res = await fetch(`${baseUrl}/v1/webhooks`, { headers: adminCookie });
      expect(res.status).toBe(200);
    });

    it('member cannot PATCH /v1/orgs/me (403)', async () => {
      const res = await fetch(`${baseUrl}/v1/orgs/me`, {
        method: 'PATCH',
        headers: memberCookie,
        body: JSON.stringify({ name: 'member-rename' }),
      });
      expect(res.status).toBe(403);
    });

    it('member cannot PATCH /v1/assistants/me (403)', async () => {
      const res = await fetch(`${baseUrl}/v1/assistants/me`, {
        method: 'PATCH',
        headers: memberCookie,
        body: JSON.stringify({ name: 'Hacky Hal' }),
      });
      expect(res.status).toBe(403);
    });

    const CONV_CHANNEL_MEMBER_DENIED = [
      ['POST', '/v1/conversations/channels/widget', { name: 'w' }],
      ['POST', '/v1/conversations/channels/widget/c_x/rotate-key', undefined],
      ['POST', '/v1/conversations/channels/widget/c_x/rotate-identity-secret', undefined],
    ] as const;
    for (const [method, path, body] of CONV_CHANNEL_MEMBER_DENIED) {
      it(`member cannot ${method} ${path} (403)`, async () => {
        const res = await fetch(`${baseUrl}${path}`, {
          method,
          headers: memberCookie,
          body: body ? JSON.stringify(body) : undefined,
        });
        expect(res.status).toBe(403);
      });
    }
  });


  describe('GET /v1/realtime (websocket)', () => {
    function wsUrl(): string {
      return baseUrl.replace(/^http/, 'ws') + '/v1/realtime';
    }

    function awaitOpen(ws: WebSocket): Promise<{ subprotocol: string }> {
      return new Promise((resolve, reject) => {
        const onError = (err: Error): void => {
          ws.removeAllListeners();
          reject(err);
        };
        ws.once('open', () => {
          ws.removeListener('error', onError);
          resolve({ subprotocol: ws.protocol });
        });
        ws.once('error', onError);
        ws.once('unexpected-response', (_req, res) => {
          ws.removeAllListeners();
          reject(new Error(`unexpected ${res.statusCode}`));
        });
      });
    }

    it('accepts the admin API key via Authorization header (existing path)', async () => {
      const ws = new WebSocket(wsUrl(), {
        headers: { authorization: `Bearer ${orgA.adminKey}` },
      });
      const result = await awaitOpen(ws);
      expect(result.subprotocol).toBe('');
      ws.close();
    });

    it('accepts the admin API key via Sec-WebSocket-Protocol (browser path)', async () => {
      const ws = new WebSocket(wsUrl(), ['bearer', orgA.adminKey]);
      const result = await awaitOpen(ws);
      expect(result.subprotocol).toBe('bearer');
      ws.close();
    });

    it('rejects bogus subprotocol token with 401', async () => {
      const ws = new WebSocket(wsUrl(), ['bearer', 'mn_admin_obviouslyfake']);
      await expect(awaitOpen(ws)).rejects.toThrow(/401/);
    });

    it('rejects upgrade with no credentials (401)', async () => {
      const ws = new WebSocket(wsUrl());
      await expect(awaitOpen(ws)).rejects.toThrow(/401/);
    });
  });


  describe('GET /v1/cms/:orgSlug/...', () => {
    it('returns 404 for unknown org id', async () => {
      const res = await fetch(`${baseUrl}/v1/cms/org_no_such/collections`);
      expect(res.status).toBe(404);
    });

    it('returns the org\'s collections without auth (public delivery)', async () => {
      const res = await fetch(`${baseUrl}/v1/cms/${orgA.id}/collections`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(Array.isArray(body)).toBe(true);
    });
  });
});
