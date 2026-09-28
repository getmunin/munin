import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import type { AddressInfo } from 'node:net';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildApiKey, hashSecret, keyPrefix } from '@getmunin/core';
import { createDb, runMigrations, schema } from '@getmunin/db';
import { sql } from 'drizzle-orm';
import { createApp } from '../bootstrap-app.ts';
import { AppModule } from '../app.module.ts';
import { ORG_LOGO_MAX_BYTES } from './org-logo.service.ts';
import { ORG_LOGO_CSP } from './org-logo-public.controller.ts';

const TEST_URL = process.env.TEST_DATABASE_URL;
const skipReason = TEST_URL
  ? null
  : 'Set TEST_DATABASE_URL to a Postgres URL to run org logo integration tests.';

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('png-body'),
]);
const SVG = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><script>alert(1)</script></svg>',
);

interface OrgDto {
  id: string;
  logoUrl: string | null;
}

async function listFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  return entries.filter((e) => e.isFile()).map((e) => e.name);
}

(skipReason ? describe.skip : describe)('Org logo', () => {
  let app: INestApplication;
  let baseUrl: string;
  let db: ReturnType<typeof createDb>;
  let storageDir: string;
  let orgId: string;
  let otherOrgId: string;
  let adminKey: string;

  beforeAll(async () => {
    process.env.MUNIN_AUTH_SECRET ??= 'test-secret-do-not-use-in-prod-it-must-be-32-chars';
    process.env.MUNIN_KEY_PEPPER ??= 'test-pepper';
    process.env.MUNIN_EMBEDDING_PROVIDER = 'stub';
    process.env.MUNIN_MAIL_PROVIDER = 'stub';
    process.env.MUNIN_WEBHOOK_WORKER_DISABLED = '1';
    process.env.MUNIN_CMS_SCHEDULE_WORKER_DISABLED = '1';
    process.env.MUNIN_BUILTIN_AGENT = '0';
    process.env.MUNIN_STORAGE_PROVIDER = 'local';
    storageDir = await mkdtemp(join(tmpdir(), 'munin-org-logo-test-'));
    process.env.MUNIN_STORAGE_LOCAL_PATH = storageDir;
    process.env.MUNIN_STORAGE_LOCAL_BASE_URL = 'http://127.0.0.1:1/static/assets';

    await runMigrations(TEST_URL!);
    const appUrl = TEST_URL!.replace(/(postgres(?:ql)?:\/\/)[^:@]+:[^@]+@/, '$1munin_app:munin_app@');
    process.env.DATABASE_URL = appUrl;

    db = createDb(TEST_URL!, { serviceRole: true });
    await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);

    const [org] = await db.insert(schema.orgs).values({ name: 'Logo Org' }).returning();
    orgId = org!.id;
    const [other] = await db.insert(schema.orgs).values({ name: 'Logo Other Org' }).returning();
    otherOrgId = other!.id;

    adminKey = buildApiKey('admin');
    await db.insert(schema.apiKeys).values({
      orgId,
      type: 'admin',
      name: 'Logo key',
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
  });

  afterAll(async () => {
    if (app) await app.close();
    if (db) {
      await db.delete(schema.orgs).where(sql`id in (${orgId}, ${otherOrgId})`);
      void db.$client.end();
    }
    if (storageDir) await rm(storageDir, { recursive: true, force: true });
  });

  function putLogo(body: Buffer, contentType: string): Promise<Response> {
    return fetch(`${baseUrl}/v1/orgs/me/logo`, {
      method: 'PUT',
      headers: { authorization: `Bearer ${adminKey}`, 'content-type': contentType },
      body,
    });
  }

  function publicPath(logoUrl: string): string {
    const url = new URL(logoUrl);
    return `${url.pathname}${url.search}`;
  }

  it('reports no logo before one is uploaded and 404s the public endpoint', async () => {
    const res = await fetch(`${baseUrl}/v1/orgs/me`, {
      headers: { authorization: `Bearer ${adminKey}` },
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as OrgDto).logoUrl).toBeNull();

    const pub = await fetch(`${baseUrl}/v1/public/orgs/${orgId}/logo`);
    expect(pub.status).toBe(404);
  });

  it('uploads a png and serves the same bytes anonymously', async () => {
    const res = await putLogo(PNG, 'image/png');
    expect(res.status).toBe(200);
    const body = (await res.json()) as OrgDto;
    expect(body.logoUrl).toContain(`/v1/public/orgs/${orgId}/logo?v=`);

    const pub = await fetch(`${baseUrl}${publicPath(body.logoUrl!)}`);
    expect(pub.status).toBe(200);
    expect(pub.headers.get('content-type')).toBe('image/png');
    expect(Buffer.from(await pub.arrayBuffer()).equals(PNG)).toBe(true);
  });

  it('serves svg logos under a sandboxing csp so embedded scripts cannot run', async () => {
    const res = await putLogo(SVG, 'image/svg+xml');
    expect(res.status).toBe(200);
    const body = (await res.json()) as OrgDto;

    const pub = await fetch(`${baseUrl}${publicPath(body.logoUrl!)}`);
    expect(pub.status).toBe(200);
    expect(pub.headers.get('content-type')).toBe('image/svg+xml');
    expect(pub.headers.get('content-security-policy')).toBe(ORG_LOGO_CSP);
    expect(pub.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('deletes the replaced object from storage so only the current logo remains', async () => {
    await putLogo(PNG, 'image/png');
    await putLogo(PNG, 'image/png');
    expect(await listFiles(storageDir)).toHaveLength(1);
  });

  it('rejects a content type outside the allow-list with a translatable code', async () => {
    const res = await putLogo(Buffer.from('GIF89a'), 'image/gif');
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe('org_logo_unsupported_type');
  });

  it('rejects bytes that do not match the declared content type', async () => {
    const res = await putLogo(Buffer.from('<html>not a png</html>'), 'image/png');
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe('org_logo_unsupported_type');
  });

  it('rejects an upload over the size cap with a translatable code', async () => {
    const res = await putLogo(Buffer.concat([PNG, Buffer.alloc(ORG_LOGO_MAX_BYTES)]), 'image/png');
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe('org_logo_too_large');
  });

  it('removes the logo, clears logoUrl and deletes the stored object', async () => {
    await putLogo(PNG, 'image/png');
    const res = await fetch(`${baseUrl}/v1/orgs/me/logo`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${adminKey}` },
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as OrgDto).logoUrl).toBeNull();
    expect(await listFiles(storageDir)).toHaveLength(0);

    const pub = await fetch(`${baseUrl}/v1/public/orgs/${orgId}/logo`);
    expect(pub.status).toBe(404);
  });

  it('keeps logo writes scoped to the calling org', async () => {
    await putLogo(PNG, 'image/png');
    const pub = await fetch(`${baseUrl}/v1/public/orgs/${otherOrgId}/logo`);
    expect(pub.status).toBe(404);
  });
});
