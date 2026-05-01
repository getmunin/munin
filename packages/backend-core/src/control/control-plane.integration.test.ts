import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import type { AddressInfo } from 'node:net';
import { buildApiKey, hashSecret, keyPrefix, randomToken } from '@getmunin/core';
import { createDb, runMigrations, schema } from '@getmunin/db';
import { eq, sql } from 'drizzle-orm';
import { createApp } from '../bootstrap-app.js';
import { AppModule } from '../app.module.js';

const TEST_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const skipReason = TEST_URL
  ? null
  : 'Set DATABASE_URL or TEST_DATABASE_URL to a Postgres URL to run control-plane controller tests.';

interface OrgFixture {
  id: string;
  slug: string;
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
    const slug = `${prefix}-${ts}-${Math.floor(Math.random() * 1e6)}`;
    const [org] = await db
      .insert(schema.orgs)
      .values({ name: `Org ${slug}`, slug })
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
      .values({ orgId, externalId: `eu-${slug}`, name: 'End User One' })
      .returning();

    const [user] = await db
      .insert(schema.users)
      .values({ email: `${slug}@example.com`, name: 'Owner User' })
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
      slug,
      adminKey,
      adminKeyId: keyRow!.id,
      endUserId: eu!.id,
      userId: user!.id,
      sessionToken,
    };
  }

  function authHeaders(key: string): HeadersInit {
    return { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
  }

  function cookieHeaders(token: string): HeadersInit {
    return {
      Cookie: `better-auth.session_token=${token}.placeholder-sig`,
      'Content-Type': 'application/json',
    };
  }

  // ─── api-keys ────────────────────────────────────────────────────────

  describe('POST/GET/DELETE /api/api-keys', () => {
    it('rejects unauthenticated request with 401', async () => {
      const res = await fetch(`${baseUrl}/api/api-keys`);
      expect(res.status).toBe(401);
    });

    it('admin can create, list, and revoke keys', async () => {
      const create = await fetch(`${baseUrl}/api/api-keys`, {
        method: 'POST',
        headers: authHeaders(orgA.adminKey),
        body: JSON.stringify({ name: 'extra-key', scopes: ['kb:read'] }),
      });
      expect(create.status).toBe(201);
      const created = (await create.json()) as { id: string; key: string; prefix: string };
      expect(created.key).toMatch(/^mn_admin_/);

      const list = await fetch(`${baseUrl}/api/api-keys`, { headers: authHeaders(orgA.adminKey) });
      expect(list.status).toBe(200);
      const items = (await list.json()) as Array<{ id: string }>;
      expect(items.find((k) => k.id === created.id)).toBeTruthy();

      const revoke = await fetch(`${baseUrl}/api/api-keys/${created.id}`, {
        method: 'DELETE',
        headers: authHeaders(orgA.adminKey),
      });
      expect(revoke.status).toBe(204);

      const afterList = await fetch(`${baseUrl}/api/api-keys`, {
        headers: authHeaders(orgA.adminKey),
      });
      const afterItems = (await afterList.json()) as Array<{ id: string }>;
      expect(afterItems.find((k) => k.id === created.id)).toBeFalsy();
    });

    it('cross-org: org A cannot revoke org B\'s key', async () => {
      const res = await fetch(`${baseUrl}/api/api-keys/${orgB.adminKeyId}`, {
        method: 'DELETE',
        headers: authHeaders(orgA.adminKey),
      });
      expect(res.status).toBe(404);
    });
  });

  // ─── tokens ──────────────────────────────────────────────────────────

  describe('GET /api/tokens, POST /api/tokens/:id/revoke', () => {
    it('401 when unauthenticated', async () => {
      const res = await fetch(`${baseUrl}/api/tokens`);
      expect(res.status).toBe(401);
    });

    it('returns tokens for the calling org only', async () => {
      // Mint a delegated token for org A.
      const mint = await fetch(`${baseUrl}/api/delegated-token`, {
        method: 'POST',
        headers: authHeaders(orgA.adminKey),
        body: JSON.stringify({ endUserId: orgA.endUserId, ttlSeconds: 600, scopes: ['kb:read'] }),
      });
      expect(mint.status).toBe(201);
      const minted = (await mint.json()) as { tokenId: string };

      const list = await fetch(`${baseUrl}/api/tokens`, { headers: authHeaders(orgA.adminKey) });
      const tokens = (await list.json()) as Array<{ id: string; endUserId: string }>;
      expect(tokens.find((t) => t.id === minted.tokenId)).toBeTruthy();

      // Org B's listing should not include org A's token.
      const listB = await fetch(`${baseUrl}/api/tokens`, { headers: authHeaders(orgB.adminKey) });
      const tokensB = (await listB.json()) as Array<{ id: string }>;
      expect(tokensB.find((t) => t.id === minted.tokenId)).toBeFalsy();

      // Revoke from org A.
      const rv = await fetch(`${baseUrl}/api/tokens/${minted.tokenId}/revoke`, {
        method: 'POST',
        headers: authHeaders(orgA.adminKey),
      });
      expect(rv.status).toBe(204);

      // Cross-org revoke from B is 404.
      const otherMint = await fetch(`${baseUrl}/api/delegated-token`, {
        method: 'POST',
        headers: authHeaders(orgB.adminKey),
        body: JSON.stringify({ externalId: 'b-eu', ttlSeconds: 300, scopes: ['kb:read'] }),
      });
      const otherTok = (await otherMint.json()) as { tokenId: string };
      const wrongOrg = await fetch(`${baseUrl}/api/tokens/${otherTok.tokenId}/revoke`, {
        method: 'POST',
        headers: authHeaders(orgA.adminKey),
      });
      expect(wrongOrg.status).toBe(404);
    });
  });

  // ─── delegated-token ─────────────────────────────────────────────────

  describe('POST /api/delegated-token', () => {
    it('401 when unauthenticated', async () => {
      const res = await fetch(`${baseUrl}/api/delegated-token`, {
        method: 'POST',
        body: JSON.stringify({ externalId: 'x' }),
        headers: { 'Content-Type': 'application/json' },
      });
      expect(res.status).toBe(401);
    });

    it('400 when no end-user identity supplied', async () => {
      const res = await fetch(`${baseUrl}/api/delegated-token`, {
        method: 'POST',
        headers: authHeaders(orgA.adminKey),
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
    });

    it('mints a delegated token with audience+scopes and finds-or-creates an end-user', async () => {
      const res = await fetch(`${baseUrl}/api/delegated-token`, {
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

  // ─── end-users ───────────────────────────────────────────────────────

  describe('/api/end-users', () => {
    it('401 unauthenticated', async () => {
      const res = await fetch(`${baseUrl}/api/end-users`);
      expect(res.status).toBe(401);
    });

    it('lookup is idempotent (creates first, returns the same row second)', async () => {
      const ext = `eu-look-${Date.now()}`;
      const first = await fetch(`${baseUrl}/api/end-users/lookup`, {
        method: 'POST',
        headers: authHeaders(orgA.adminKey),
        body: JSON.stringify({ externalId: ext }),
      });
      expect(first.status).toBe(200);
      const a = (await first.json()) as { id: string };
      const second = await fetch(`${baseUrl}/api/end-users/lookup`, {
        method: 'POST',
        headers: authHeaders(orgA.adminKey),
        body: JSON.stringify({ externalId: ext }),
      });
      const b = (await second.json()) as { id: string };
      expect(a.id).toBe(b.id);
    });

    it('list is org-scoped; cross-org cannot see another org\'s end-users', async () => {
      const list = await fetch(`${baseUrl}/api/end-users`, { headers: authHeaders(orgA.adminKey) });
      const items = (await list.json()) as Array<{ id: string }>;
      expect(items.find((u) => u.id === orgA.endUserId)).toBeTruthy();
      const cross = await fetch(`${baseUrl}/api/end-users/${orgA.endUserId}`, {
        headers: authHeaders(orgB.adminKey),
      });
      expect(cross.status).toBe(404);
    });

    it('revoke-tokens revokes all active tokens for an end-user', async () => {
      // Mint two tokens for the same end-user.
      for (let i = 0; i < 2; i++) {
        await fetch(`${baseUrl}/api/delegated-token`, {
          method: 'POST',
          headers: authHeaders(orgA.adminKey),
          body: JSON.stringify({
            endUserId: orgA.endUserId,
            ttlSeconds: 300,
            scopes: ['kb:read'],
          }),
        });
      }
      const res = await fetch(`${baseUrl}/api/end-users/${orgA.endUserId}/revoke-tokens`, {
        method: 'POST',
        headers: authHeaders(orgA.adminKey),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { revoked: number };
      expect(body.revoked).toBeGreaterThanOrEqual(2);
    });
  });

  // ─── orgs ────────────────────────────────────────────────────────────

  describe('/api/orgs/me', () => {
    it('401 unauthenticated', async () => {
      const res = await fetch(`${baseUrl}/api/orgs/me`);
      expect(res.status).toBe(401);
    });

    it('returns the calling org', async () => {
      const res = await fetch(`${baseUrl}/api/orgs/me`, { headers: authHeaders(orgA.adminKey) });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { id: string; slug: string };
      expect(body.id).toBe(orgA.id);
      expect(body.slug).toBe(orgA.slug);
    });

    it('updates name and settings', async () => {
      const res = await fetch(`${baseUrl}/api/orgs/me`, {
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

  // ─── webhooks ────────────────────────────────────────────────────────

  describe('/api/webhooks', () => {
    it('401 unauthenticated', async () => {
      const res = await fetch(`${baseUrl}/api/webhooks`);
      expect(res.status).toBe(401);
    });

    it('CRUD with cross-org isolation', async () => {
      const create = await fetch(`${baseUrl}/api/webhooks`, {
        method: 'POST',
        headers: authHeaders(orgA.adminKey),
        body: JSON.stringify({ url: 'https://example.com/hook', events: ['kb.document.created'] }),
      });
      expect(create.status).toBe(201);
      const wh = (await create.json()) as { id: string; secret: string };
      expect(wh.secret).toMatch(/^whsec_/);

      const patch = await fetch(`${baseUrl}/api/webhooks/${wh.id}`, {
        method: 'PATCH',
        headers: authHeaders(orgA.adminKey),
        body: JSON.stringify({ active: false }),
      });
      expect(patch.status).toBe(200);
      const patched = (await patch.json()) as { active: boolean };
      expect(patched.active).toBe(false);

      // Org B can't see or patch.
      const cross = await fetch(`${baseUrl}/api/webhooks/${wh.id}`, {
        method: 'PATCH',
        headers: authHeaders(orgB.adminKey),
        body: JSON.stringify({ active: true }),
      });
      expect(cross.status).toBe(404);
      const crossDel = await fetch(`${baseUrl}/api/webhooks/${wh.id}`, {
        method: 'DELETE',
        headers: authHeaders(orgB.adminKey),
      });
      expect(crossDel.status).toBe(404);

      const del = await fetch(`${baseUrl}/api/webhooks/${wh.id}`, {
        method: 'DELETE',
        headers: authHeaders(orgA.adminKey),
      });
      expect(del.status).toBe(204);
    });
  });

  // ─── audit-log ───────────────────────────────────────────────────────

  describe('GET /api/audit-log', () => {
    it('401 unauthenticated', async () => {
      const res = await fetch(`${baseUrl}/api/audit-log`);
      expect(res.status).toBe(401);
    });

    it('returns paginated audit entries for the calling org', async () => {
      // Generate at least one audit entry by hitting an audited endpoint.
      await fetch(`${baseUrl}/api/orgs/me`, { headers: authHeaders(orgA.adminKey) });
      const res = await fetch(`${baseUrl}/api/audit-log?limit=10`, {
        headers: authHeaders(orgA.adminKey),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { items: unknown[]; nextCursor: string | null };
      expect(Array.isArray(body.items)).toBe(true);
    });
  });

  // ─── usage ───────────────────────────────────────────────────────────

  describe('GET /api/usage', () => {
    it('401 unauthenticated', async () => {
      const res = await fetch(`${baseUrl}/api/usage`);
      expect(res.status).toBe(401);
    });

    it('returns usage payload for the calling org', async () => {
      const res = await fetch(`${baseUrl}/api/usage`, { headers: authHeaders(orgA.adminKey) });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toBeTypeOf('object');
    });
  });

  // ─── export ──────────────────────────────────────────────────────────

  describe('GET /api/export', () => {
    it('401 unauthenticated', async () => {
      const res = await fetch(`${baseUrl}/api/export`);
      expect(res.status).toBe(401);
    });

    it('returns the org\'s domain rows in JSON, scoped to the calling org', async () => {
      const res = await fetch(`${baseUrl}/api/export`, { headers: authHeaders(orgA.adminKey) });
      expect(res.status).toBe(200);
      expect(res.headers.get('content-disposition')).toContain('munin-export.json');
      const body = (await res.json()) as {
        org: { id: string };
        endUsers: Array<{ id: string }>;
      };
      expect(body.org.id).toBe(orgA.id);
      expect(body.endUsers.find((u) => u.id === orgA.endUserId)).toBeTruthy();
      expect(body.endUsers.find((u) => u.id === orgB.endUserId)).toBeFalsy();
    });
  });

  // ─── invitations (admin-issue) ───────────────────────────────────────

  describe('/api/orgs/me/invitations (admin)', () => {
    it('401 unauthenticated', async () => {
      const res = await fetch(`${baseUrl}/api/orgs/me/invitations`);
      expect(res.status).toBe(401);
    });

    it('admin API key cannot create invitations (owner-user session required)', async () => {
      const res = await fetch(`${baseUrl}/api/orgs/me/invitations`, {
        method: 'POST',
        headers: authHeaders(orgA.adminKey),
        body: JSON.stringify({ email: `forbidden-${Date.now()}@example.com` }),
      });
      expect(res.status).toBe(403);
    });

    it('owner via session cookie issues, lists, and revokes invitations', async () => {
      const create = await fetch(`${baseUrl}/api/orgs/me/invitations`, {
        method: 'POST',
        headers: cookieHeaders(orgA.sessionToken),
        body: JSON.stringify({ email: `invitee-${Date.now()}@example.com`, role: 'member' }),
      });
      expect(create.status).toBe(201);
      const inv = (await create.json()) as { id: string; token?: string };

      const list = await fetch(`${baseUrl}/api/orgs/me/invitations`, {
        headers: cookieHeaders(orgA.sessionToken),
      });
      expect(list.status).toBe(200);
      const items = (await list.json()) as Array<{ id: string }>;
      expect(items.find((i) => i.id === inv.id)).toBeTruthy();

      const revoke = await fetch(`${baseUrl}/api/orgs/me/invitations/${inv.id}`, {
        method: 'DELETE',
        headers: cookieHeaders(orgA.sessionToken),
      });
      expect(revoke.status).toBe(200);
    });
  });

  // ─── accept-invitation (anonymous lookup, session-cookie accept) ─────

  describe('/api/invitations (lookup + accept)', () => {
    it('lookup is anonymous and returns 404 for unknown token', async () => {
      const res = await fetch(`${baseUrl}/api/invitations/lookup?token=bogus`);
      expect(res.status).toBe(404);
    });

    it('lookup with a valid token returns invitation detail', async () => {
      const create = await fetch(`${baseUrl}/api/orgs/me/invitations`, {
        method: 'POST',
        headers: cookieHeaders(orgA.sessionToken),
        body: JSON.stringify({ email: `lookup-${Date.now()}@example.com` }),
      });
      const inv = (await create.json()) as { id: string; token: string };
      const res = await fetch(
        `${baseUrl}/api/invitations/lookup?token=${encodeURIComponent(inv.token)}`,
      );
      expect(res.status).toBe(200);
    });

    it('accept without session cookie is forbidden', async () => {
      const res = await fetch(`${baseUrl}/api/invitations/accept`, {
        method: 'POST',
        body: JSON.stringify({ token: 'whatever' }),
        headers: { 'Content-Type': 'application/json' },
      });
      expect(res.status).toBe(403);
    });
  });

  // ─── members (owner-only patch/delete) ──────────────────────────────

  describe('/api/orgs/me/members', () => {
    it('401 without credentials', async () => {
      const res = await fetch(`${baseUrl}/api/orgs/me/members`);
      expect(res.status).toBe(401);
    });

    it('admin API key can list members of its org', async () => {
      const res = await fetch(`${baseUrl}/api/orgs/me/members`, {
        headers: authHeaders(orgA.adminKey),
      });
      expect(res.status).toBe(200);
      const items = (await res.json()) as Array<{ userId: string }>;
      expect(items.find((m) => m.userId === orgA.userId)).toBeTruthy();
      // Must not include other org's user.
      expect(items.find((m) => m.userId === orgB.userId)).toBeFalsy();
    });

    it('admin API key cannot demote/remove members (owner-user only)', async () => {
      const patch = await fetch(`${baseUrl}/api/orgs/me/members/${orgA.userId}`, {
        method: 'PATCH',
        headers: authHeaders(orgA.adminKey),
        body: JSON.stringify({ role: 'member' }),
      });
      expect(patch.status).toBe(403);
    });
  });

  // ─── memberships (user-session only) ─────────────────────────────────

  describe('/api/orgs/me/memberships', () => {
    it('user session can list its memberships', async () => {
      const res = await fetch(`${baseUrl}/api/orgs/me/memberships`, {
        headers: cookieHeaders(orgA.sessionToken),
      });
      expect(res.status).toBe(200);
      const items = (await res.json()) as Array<{ orgId: string }>;
      expect(items.find((m) => m.orgId === orgA.id)).toBeTruthy();
    });

    it('admin API key cannot list memberships (user session required)', async () => {
      const res = await fetch(`${baseUrl}/api/orgs/me/memberships`, {
        headers: authHeaders(orgA.adminKey),
      });
      expect(res.status).toBe(403);
    });
  });

  // ─── cms-delivery (anonymous) ────────────────────────────────────────

  describe('GET /api/cms/v1/:orgSlug/...', () => {
    it('returns 404 for unknown org slug', async () => {
      const res = await fetch(`${baseUrl}/api/cms/v1/no-such-org/collections`);
      expect(res.status).toBe(404);
    });

    it('returns the org\'s collections without auth (public delivery)', async () => {
      const res = await fetch(`${baseUrl}/api/cms/v1/${orgA.slug}/collections`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(Array.isArray(body)).toBe(true);
    });
  });
});
