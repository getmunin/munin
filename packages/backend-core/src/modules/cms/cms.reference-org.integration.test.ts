import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import type { AddressInfo } from 'node:net';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { buildApiKey, hashSecret, keyPrefix } from '@getmunin/core';
import { createDb, runMigrations, schema } from '@getmunin/db';
import { sql } from 'drizzle-orm';
import { AppModule } from '../../app.module.ts';

const TEST_URL = process.env.TEST_DATABASE_URL;
const skipReason = TEST_URL
  ? null
  : 'Set TEST_DATABASE_URL to a Postgres URL to run CMS cross-org reference tests.';

const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

const PAGE_FIELDS = [
  { name: 'title', type: 'text', required: true },
  { name: 'slug', type: 'text', required: true },
  { name: 'hero', type: 'asset' },
  { name: 'gallery', type: 'array', options: { items: { name: 'item', type: 'asset' } } },
  { name: 'related', type: 'reference' },
  { name: 'body', type: 'markdown' },
];

type ToolResult = { isError?: boolean; content?: Array<{ type: string; text?: string }> };

(skipReason ? describe.skip : describe)('CMS references must stay inside the caller org', () => {
  let app: INestApplication;
  let baseUrl: string;
  let db: ReturnType<typeof createDb>;
  let orgAId: string;
  let orgBId: string;
  let adminKeyA: string;
  let adminKeyB: string;
  let foreignAssetId: string;
  let foreignEntryId: string;
  let foreignAssetUrl: string;
  let ownAssetId: string;
  let ownEntryId: string;
  let ownCollectionId: string;

  beforeAll(async () => {
    process.env.MUNIN_AUTH_SECRET ??= 'test-secret-do-not-use-in-prod';
    process.env.MUNIN_KEY_PEPPER ??= 'test-pepper';
    process.env.MUNIN_EMBEDDING_PROVIDER = 'stub';
    process.env.MUNIN_MAIL_PROVIDER = 'stub';
    process.env.MUNIN_WEBHOOK_WORKER_DISABLED = '1';
    process.env.MUNIN_STORAGE_PROVIDER = 'local';
    process.env.MUNIN_STORAGE_LOCAL_PATH = mkdtempSync(join(tmpdir(), 'munin-cms-ref-org-'));

    await runMigrations(TEST_URL!);
    const appUrl = TEST_URL!.replace(/(postgres(?:ql)?:\/\/)[^:@]+:[^@]+@/, '$1munin_app:munin_app@');
    process.env.DATABASE_URL = appUrl;

    db = createDb(TEST_URL!, { serviceRole: true });
    await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);

    const [orgA] = await db.insert(schema.orgs).values({ name: 'CMS Ref Victim Org' }).returning();
    const [orgB] = await db.insert(schema.orgs).values({ name: 'CMS Ref Caller Org' }).returning();
    orgAId = orgA!.id;
    orgBId = orgB!.id;
    adminKeyA = buildApiKey('admin');
    adminKeyB = buildApiKey('admin');
    await db.insert(schema.apiKeys).values([
      { orgId: orgAId, type: 'admin', name: 'cms-ref-a', keyHash: hashSecret(adminKeyA), keyPrefix: keyPrefix(adminKeyA), scopes: ['*'] },
      { orgId: orgBId, type: 'admin', name: 'cms-ref-b', keyHash: hashSecret(adminKeyB), keyPrefix: keyPrefix(adminKeyB), scopes: ['*'] },
    ]);

    app = await NestFactory.create(AppModule, { logger: false });
    await app.listen(0, '127.0.0.1');
    const server = app.getHttpServer() as { address(): AddressInfo | string | null };
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('expected AddressInfo');
    baseUrl = `http://127.0.0.1:${address.port}`;

    const seed = async (key: string, title: string) =>
      withClient(key, async (c) => {
        const collection = json<{ id: string }>(
          await c.callTool({
            name: 'cms_create_collection',
            arguments: { name: 'Pages', slug: 'pages', fields: PAGE_FIELDS },
          }),
        );
        const asset = json<{ id: string; publicUrl: string }>(
          await c.callTool({
            name: 'cms_upload_asset_from_base64',
            arguments: { name: 'pixel.png', mime: 'image/png', base64Body: PNG_BASE64 },
          }),
        );
        const entry = json<{ id: string }>(
          await c.callTool({
            name: 'cms_create_entry',
            arguments: {
              collection: 'pages',
              slug: 'target',
              data: { title, slug: 'target', hero: asset.id },
              status: 'published',
            },
          }),
        );
        return { collection, asset, entry };
      });

    const victim = await seed(adminKeyA, 'Victim secret page');
    foreignAssetId = victim.asset.id;
    foreignAssetUrl = victim.asset.publicUrl;
    foreignEntryId = victim.entry.id;
    const own = await seed(adminKeyB, 'Own target');
    ownAssetId = own.asset.id;
    ownEntryId = own.entry.id;
    ownCollectionId = own.collection.id;
  });

  afterAll(async () => {
    if (app) await app.close();
    if (db) {
      await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
      await db.delete(schema.orgs).where(sql`id in (${orgAId}, ${orgBId})`);
    }
  });

  async function withClient<T>(token: string, fn: (c: Client) => Promise<T>): Promise<T> {
    const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    });
    const c = new Client({ name: 'cms-ref-org-it', version: '0.0.0' });
    await c.connect(transport);
    try {
      return await fn(c);
    } finally {
      await transport.close();
      await c.close();
    }
  }

  function json<T>(result: unknown): T {
    const item = (result as ToolResult).content?.find((i) => i.type === 'text');
    return JSON.parse(item!.text!) as T;
  }

  function errorText(result: unknown): string {
    const r = result as ToolResult;
    expect(r.isError).toBe(true);
    return r.content?.[0]?.text ?? '';
  }

  function callB(name: string, args: Record<string, unknown>) {
    return withClient(adminKeyB, (c) => c.callTool({ name, arguments: args }));
  }

  async function countEntriesInB(): Promise<number> {
    await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
    const rows = await db.execute<{ n: number }>(
      sql`SELECT count(*)::int AS n FROM cms_entries WHERE org_id = ${orgBId}`,
    );
    return rows[0]!.n;
  }

  it.each([
    ['hero', 'asset', () => ({ hero: foreignAssetId }), () => foreignAssetId],
    ['gallery', 'asset', () => ({ gallery: [foreignAssetId] }), () => foreignAssetId],
    ['related', 'entry', () => ({ related: foreignEntryId }), () => foreignEntryId],
    ['body', 'entry', () => ({ body: `see [it](ref://${foreignEntryId})` }), () => foreignEntryId],
  ])(
    'refuses to create an entry whose %s field points at another org’s %s',
    async (field, kind, data, id) => {
      const before = await countEntriesInB();
      const text = errorText(
        await callB('cms_create_entry', {
          collection: 'pages',
          slug: `planted-${field}`,
          data: { title: 'Planted', slug: `planted-${field}`, ...data() },
        }),
      );
      expect(text).toContain(
        `cms_invalid_reference: field "${field}" points at ${kind} ${id()}, which does not exist in this organization`,
      );
      expect(await countEntriesInB()).toBe(before);
    },
  );

  it('accepts assets and entries from the caller’s own org', async () => {
    const created = json<{ id: string }>(
      await callB('cms_create_entry', {
        collection: 'pages',
        slug: 'own-refs',
        data: {
          title: 'Own refs',
          slug: 'own-refs',
          hero: ownAssetId,
          gallery: [ownAssetId],
          related: ownEntryId,
          body: `see [it](ref://${ownEntryId})`,
        },
      }),
    );
    expect(created.id).toBeTruthy();
  });

  it('refuses an update that introduces a foreign ref, but still saves an entry whose own ref went stale', async () => {
    const doomed = json<{ id: string; version: number }>(
      await callB('cms_create_entry', {
        collection: 'pages',
        slug: 'doomed',
        data: { title: 'Doomed', slug: 'doomed' },
      }),
    );
    const linker = json<{ id: string; version: number }>(
      await callB('cms_create_entry', {
        collection: 'pages',
        slug: 'linker',
        data: { title: 'Linker', slug: 'linker', related: doomed.id },
      }),
    );
    await callB('cms_delete_entry', { id: doomed.id, ifVersion: doomed.version });

    const retitled = json<{ version: number }>(
      await callB('cms_update_entry', {
        id: linker.id,
        ifVersion: linker.version,
        data: { title: 'Linker, renamed' },
      }),
    );

    const text = errorText(
      await callB('cms_update_entry', {
        id: linker.id,
        ifVersion: retitled.version,
        data: { related: foreignEntryId },
      }),
    );
    expect(text).toContain(`field "related" points at entry ${foreignEntryId}`);
  });

  it('refuses an import whose idMap points at another org, and drops foreign ids written straight into the data', async () => {
    const collection = {
      id: 'src_pages',
      name: 'Pages',
      slug: 'pages',
      fields: PAGE_FIELDS,
      localized: false,
      settings: {},
    };
    const entry = (data: Record<string, unknown>) => ({
      id: 'src_entry',
      collectionId: 'src_pages',
      slug: 'imported',
      locale: 'en',
      status: 'draft',
      data: { title: 'Imported', slug: 'imported', ...data },
    });

    const before = await countEntriesInB();
    const refused = errorText(
      await callB('cms_import', {
        records: {
          locales: [],
          collections: [collection],
          assets: [],
          entries: [entry({ related: 'src_victim' })],
        },
        idMap: { src_victim: foreignEntryId },
      }),
    );
    expect(refused).toContain('cms_import_invalid');
    expect(refused).toContain('src_victim');
    expect(await countEntriesInB()).toBe(before);

    const imported = json<{ idMap: Record<string, string>; warnings: string[] }>(
      await callB('cms_import', {
        records: {
          locales: [],
          collections: [collection],
          assets: [],
          entries: [entry({ related: foreignEntryId, hero: foreignAssetId, gallery: [foreignAssetId] })],
        },
      }),
    );
    expect(imported.idMap['src_pages']).toBe(ownCollectionId);
    expect(imported.warnings.some((w) => w.includes(foreignEntryId) && w.includes('related'))).toBe(true);
    expect(imported.warnings.some((w) => w.includes(foreignAssetId) && w.includes('hero'))).toBe(true);
    const stored = json<{ data: Record<string, unknown> }>(
      await callB('cms_get_entry', { id: imported.idMap['src_entry'] }),
    );
    expect(stored.data.related ?? null).toBeNull();
    expect(stored.data.hero ?? null).toBeNull();
    expect(stored.data.gallery).toEqual([]);
  });

  it('delivery never resolves a foreign id planted before this check existed', async () => {
    const planted = json<{ id: string }>(
      await callB('cms_create_entry', {
        collection: 'pages',
        slug: 'planted-earlier',
        data: { title: 'Planted earlier', slug: 'planted-earlier' },
        status: 'published',
      }),
    );
    await db.execute(sql`
      UPDATE cms_entries
      SET data = data || jsonb_build_object(
        'hero', ${foreignAssetId}::text,
        'gallery', jsonb_build_array(${foreignAssetId}::text),
        'related', ${foreignEntryId}::text,
        'body', ${`see [it](ref://${foreignEntryId})`}::text
      )
      WHERE id = ${planted.id}
    `);

    const res = await fetch(`${baseUrl}/v1/cms/${orgBId}/pages/planted-earlier?include=references`);
    expect(res.status).toBe(200);
    const raw = await res.text();
    const body = JSON.parse(raw) as {
      data: Record<string, unknown>;
      _refs?: Record<string, unknown>;
    };
    expect(body.data.hero).toBeNull();
    expect(body.data.gallery).toEqual([null]);
    expect(body.data.related).toBeNull();
    expect(body._refs?.[foreignEntryId]).toBeUndefined();
    expect(raw).not.toContain('Victim secret page');
    expect(raw).not.toContain(foreignAssetUrl);

    const viaMcp = await callB('cms_get_entry', { id: planted.id, include: ['references'] });
    const mcpText = JSON.stringify(viaMcp);
    expect(mcpText).not.toContain('Victim secret page');
    expect(mcpText).not.toContain(foreignAssetUrl);
  });
});
