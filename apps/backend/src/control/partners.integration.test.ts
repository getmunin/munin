import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import type { AddressInfo } from 'node:net';
import { buildApiKey, hashSecret, keyPrefix } from '@munin/core';
import { createDb, runMigrations, schema } from '@munin/db';
import { sql } from 'drizzle-orm';
import { AppModule } from '../app.module.js';

const TEST_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const skipReason = TEST_URL
  ? null
  : 'Set DATABASE_URL or TEST_DATABASE_URL to a Postgres URL to run partner integration tests.';

(skipReason ? describe.skip : describe)('Partner provisioning integration', () => {
  let app: INestApplication;
  let baseUrl: string;
  let db: ReturnType<typeof createDb>;
  let partnerAId: string;
  let partnerBId: string;
  let partnerAKey: string;
  let partnerBKey: string;
  const provisionedSlugs: string[] = [];

  beforeAll(async () => {
    process.env.MUNIN_AUTH_SECRET ??= 'test-secret-do-not-use-in-prod';
    process.env.MUNIN_KEY_PEPPER ??= 'test-pepper';
    process.env.MUNIN_EMBEDDING_PROVIDER = 'stub';

    await runMigrations(TEST_URL!);

    const appUrl = TEST_URL!.replace(/(postgres(?:ql)?:\/\/)[^:@]+:[^@]+@/, '$1munin_app:munin_app@');
    process.env.DATABASE_URL = appUrl;

    db = createDb(TEST_URL!, { serviceRole: true });
    await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);

    const ts = Date.now();
    const [partnerA] = await db
      .insert(schema.partners)
      .values({
        name: 'Threll',
        slug: `threll-${ts}`,
        partnerKeyHash: 'placeholder-not-used',
        scopes: ['*'],
      })
      .returning();
    partnerAId = partnerA!.id;

    const [partnerB] = await db
      .insert(schema.partners)
      .values({
        name: 'Other Partner',
        slug: `other-${ts}`,
        partnerKeyHash: 'placeholder-not-used',
        scopes: ['*'],
      })
      .returning();
    partnerBId = partnerB!.id;

    partnerAKey = buildApiKey('part');
    await db.insert(schema.apiKeys).values({
      partnerId: partnerAId,
      type: 'partner',
      name: 'partner-a-key',
      keyHash: hashSecret(partnerAKey),
      keyPrefix: keyPrefix(partnerAKey),
      scopes: ['*'],
    });
    partnerBKey = buildApiKey('part');
    await db.insert(schema.apiKeys).values({
      partnerId: partnerBId,
      type: 'partner',
      name: 'partner-b-key',
      keyHash: hashSecret(partnerBKey),
      keyPrefix: keyPrefix(partnerBKey),
      scopes: ['*'],
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
      for (const slug of provisionedSlugs) {
        await db.delete(schema.orgs).where(sql`slug = ${slug}`);
      }
      await db.delete(schema.partners).where(sql`id IN (${partnerAId}, ${partnerBId})`);
    }
  });

  async function call(
    method: 'GET' | 'POST' | 'PATCH',
    path: string,
    token: string,
    body?: unknown,
  ): Promise<{ status: number; json: unknown }> {
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
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

  it('partner provisions an org, lists it, and the admin key works', async () => {
    const slug = `pa-org-${Date.now()}`;
    provisionedSlugs.push(slug);
    const provision = await call('POST', '/api/partner/orgs', partnerAKey, {
      name: 'Customer A',
      slug,
      ownerEmail: 'owner@example.com',
    });
    expect(provision.status).toBe(201);
    const provisioned = provision.json as {
      org: { id: string; slug: string; partnerId: string };
      adminApiKey: string;
      ownerClaim: { token: string; email: string };
    };
    expect(provisioned.org.partnerId).toBe(partnerAId);
    expect(provisioned.adminApiKey).toMatch(/^mn_admin_/);
    expect(provisioned.ownerClaim.token).toBeTruthy();

    const list = await call('GET', '/api/partner/orgs', partnerAKey);
    expect(list.status).toBe(200);
    const orgs = list.json as Array<{ id: string; slug: string }>;
    expect(orgs.find((o) => o.slug === slug)).toBeTruthy();

    // The admin key minted for the new org actually authenticates against MCP.
    const ping = await fetch(`${baseUrl}/whoami`, {
      headers: { Authorization: `Bearer ${provisioned.adminApiKey}` },
    });
    expect(ping.status).toBe(200);
  }, 30_000);

  it('partner B cannot see partner A\'s orgs and cannot fetch them by id', async () => {
    const slugA = `iso-a-${Date.now()}`;
    provisionedSlugs.push(slugA);
    const provisioned = (
      await call('POST', '/api/partner/orgs', partnerAKey, {
        name: 'Iso A',
        slug: slugA,
        ownerEmail: 'iso-a@example.com',
      })
    ).json as { org: { id: string } };

    const list = await call('GET', '/api/partner/orgs', partnerBKey);
    expect(list.status).toBe(200);
    const orgs = list.json as Array<{ id: string }>;
    expect(orgs.find((o) => o.id === provisioned.org.id)).toBeFalsy();

    const get = await call('GET', `/api/partner/orgs/${provisioned.org.id}`, partnerBKey);
    expect(get.status).toBe(404);
    expect(JSON.stringify(get.json)).toMatch(/partner_not_found/);
  }, 30_000);

  it('admin key cannot reach /api/partner/orgs', async () => {
    // Mint an admin key tied to a fresh org for this test.
    const ts = Date.now();
    const [org] = await db
      .insert(schema.orgs)
      .values({ name: 'Adm Org', slug: `adm-${ts}` })
      .returning();
    const adminKey = buildApiKey('admin');
    await db.insert(schema.apiKeys).values({
      orgId: org!.id,
      type: 'admin',
      name: 'adm-test',
      keyHash: hashSecret(adminKey),
      keyPrefix: keyPrefix(adminKey),
      scopes: ['*'],
    });
    try {
      const list = await call('GET', '/api/partner/orgs', adminKey);
      expect(list.status).toBe(403);
    } finally {
      await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
      await db.delete(schema.orgs).where(sql`id = ${org!.id}`);
    }
  }, 30_000);

  it('owner-invite mints a fresh claim token without revoking the prior one', async () => {
    const slug = `inv-${Date.now()}`;
    provisionedSlugs.push(slug);
    const provisioned = (
      await call('POST', '/api/partner/orgs', partnerAKey, {
        name: 'Inv Org',
        slug,
        ownerEmail: 'inv@example.com',
      })
    ).json as { org: { id: string }; ownerClaim: { token: string } };

    const resend = await call(
      'POST',
      `/api/partner/orgs/${provisioned.org.id}/owner-invite`,
      partnerAKey,
      { email: 'inv@example.com' },
    );
    expect(resend.status).toBe(200);
    const second = resend.json as { token: string };
    expect(second.token).not.toBe(provisioned.ownerClaim.token);
  }, 30_000);
});
