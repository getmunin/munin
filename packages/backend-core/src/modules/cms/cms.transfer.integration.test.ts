import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import type { AddressInfo } from 'node:net';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { buildApiKey, hashSecret, keyPrefix } from '@getmunin/core';
import { createDb, runMigrations, schema } from '@getmunin/db';
import { sql } from 'drizzle-orm';
import { AppModule } from '../../app.module.ts';

const TEST_URL = process.env.TEST_DATABASE_URL;
const skipReason = TEST_URL
  ? null
  : 'Set TEST_DATABASE_URL to a Postgres URL to run CMS transfer integration tests.';

// 1x1 transparent PNG.
const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

(skipReason ? describe.skip : describe)('CMS transfer: export org A → import org B via /mcp', () => {
  let app: INestApplication;
  let baseUrl: string;
  let db: ReturnType<typeof createDb>;
  let orgAId: string;
  let orgBId: string;
  let adminKeyA: string;
  let adminKeyB: string;

  beforeAll(async () => {
    process.env.MUNIN_AUTH_SECRET ??= 'test-secret-do-not-use-in-prod';
    process.env.MUNIN_KEY_PEPPER ??= 'test-pepper';
    process.env.MUNIN_EMBEDDING_PROVIDER = 'stub';
    process.env.MUNIN_MAIL_PROVIDER = 'stub';
    process.env.MUNIN_WEBHOOK_WORKER_DISABLED = '1';
    process.env.MUNIN_STORAGE_PROVIDER = 'local';
    process.env.MUNIN_STORAGE_LOCAL_PATH = mkdtempSync(join(tmpdir(), 'munin-cms-transfer-'));

    await runMigrations(TEST_URL!);
    const appUrl = TEST_URL!.replace(/(postgres(?:ql)?:\/\/)[^:@]+:[^@]+@/, '$1munin_app:munin_app@');
    process.env.DATABASE_URL = appUrl;

    db = createDb(TEST_URL!, { serviceRole: true });
    await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);

    const [orgA] = await db.insert(schema.orgs).values({ name: 'CMS Transfer Source Org' }).returning();
    const [orgB] = await db.insert(schema.orgs).values({ name: 'CMS Transfer Target Org' }).returning();
    orgAId = orgA!.id;
    orgBId = orgB!.id;

    adminKeyA = buildApiKey('admin');
    adminKeyB = buildApiKey('admin');
    await db.insert(schema.apiKeys).values([
      {
        orgId: orgAId,
        type: 'admin',
        name: 'cms-transfer-admin-a',
        keyHash: hashSecret(adminKeyA),
        keyPrefix: keyPrefix(adminKeyA),
        scopes: ['*'],
      },
      {
        orgId: orgBId,
        type: 'admin',
        name: 'cms-transfer-admin-b',
        keyHash: hashSecret(adminKeyB),
        keyPrefix: keyPrefix(adminKeyB),
        scopes: ['*'],
      },
    ]);

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
      await db.delete(schema.orgs).where(sql`id in (${orgAId}, ${orgBId})`);
    }
  });

  async function withClient<T>(token: string, fn: (c: Client) => Promise<T>): Promise<T> {
    const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    });
    const c = new Client({ name: 'cms-transfer-it', version: '0.0.0' });
    await c.connect(transport);
    try {
      return await fn(c);
    } finally {
      await transport.close();
      await c.close();
    }
  }

  function firstJson(result: { content: Array<{ type: string; text?: string }> }): unknown {
    for (const item of result.content) {
      if (item.type === 'text' && typeof item.text === 'string') {
        try {
          return JSON.parse(item.text);
        } catch {
          return item.text;
        }
      }
    }
    return null;
  }

  interface CmsExportData {
    locales: Array<{ id: string; code: string }>;
    collections: Array<{ id: string; slug: string }>;
    entries: Array<{ id: string; collectionId: string; slug: string; locale: string }>;
    assets: Array<{ id: string; name: string; base64Body: string | null }>;
  }
  interface ImportResult {
    created: number;
    updated: number;
    skipped: number;
    idMap: Record<string, string>;
    warnings: string[];
  }

  it('moves locales + collections + entries + assets to a different org, remaps ids, re-embeds, and re-imports idempotently', async () => {
    const seeded = await withClient(adminKeyA, async (c) => {
      await c.callTool({
        name: 'cms_create_locale',
        arguments: { code: 'en', name: 'English', isDefault: true },
      });

      const asset = firstJson(
        (await c.callTool({
          name: 'cms_upload_asset_from_base64',
          arguments: { name: 'pixel.png', mime: 'image/png', base64Body: PNG_BASE64 },
        })) as never,
      ) as { id: string };

      const collection = firstJson(
        (await c.callTool({
          name: 'cms_create_collection',
          arguments: {
            name: 'Articles',
            slug: 'articles',
            fields: [
              { name: 'title', type: 'text', required: true },
              { name: 'body', type: 'markdown' },
              { name: 'hero', type: 'asset' },
            ],
          },
        })) as never,
      ) as { id: string };

      await c.callTool({
        name: 'cms_create_entry',
        arguments: {
          collection: 'articles',
          slug: 'refund-policy',
          data: {
            title: 'Refund policy',
            body: 'Refunds are processed within 30 days of purchase.',
            hero: asset.id,
          },
          status: 'published',
        },
      });
      await c.callTool({
        name: 'cms_create_entry',
        arguments: {
          collection: 'articles',
          slug: 'onboarding',
          data: { title: 'Onboarding checklist', body: 'Step one: set up your workstation.' },
        },
      });

      const exported = firstJson((await c.callTool({ name: 'cms_export', arguments: {} })) as never) as CmsExportData;
      return { asset, collection, exported };
    });

    expect(seeded.exported.locales.length).toBe(1);
    expect(seeded.exported.collections.length).toBe(1);
    expect(seeded.exported.entries.length).toBe(2);
    expect(seeded.exported.assets.length).toBe(1);
    expect(seeded.exported.assets[0]!.base64Body).toBeTruthy();

    const srcLocaleId = seeded.exported.locales[0]!.id;
    const srcCollectionId = seeded.exported.collections[0]!.id;
    const srcEntryIds = seeded.exported.entries.map((e) => e.id);
    const srcAssetId = seeded.exported.assets[0]!.id;

    const firstImport = await withClient(adminKeyB, async (c) => {
      const res = await c.callTool({ name: 'cms_import', arguments: { records: seeded.exported } });
      const result = firstJson(res as never) as ImportResult;

      const searched = await c.callTool({
        name: 'cms_search',
        arguments: { query: 'refund processed' },
      });
      const hits = firstJson(searched as never) as Array<{ entryId?: string; id?: string }>;
      const collections = firstJson(
        (await c.callTool({ name: 'cms_list_collections', arguments: {} })) as never,
      ) as Array<{ id: string; slug: string }>;
      const entries = firstJson(
        (await c.callTool({ name: 'cms_list_entries', arguments: {} })) as never,
      ) as Array<{ id: string; slug: string; data: Record<string, unknown> }>;
      return { result, hits, collections, entries };
    });

    // 1 locale + 1 collection + 1 asset + 2 entries.
    expect(firstImport.result.created).toBe(5);
    expect(firstImport.result.idMap[srcLocaleId]).toMatch(/^cml_/);
    expect(firstImport.result.idMap[srcCollectionId]).toMatch(/^cmc_/);
    expect(firstImport.result.idMap[srcCollectionId]).not.toBe(srcCollectionId);
    expect(firstImport.result.idMap[srcAssetId]).toMatch(/^cma_/);
    for (const srcEntryId of srcEntryIds) {
      expect(firstImport.result.idMap[srcEntryId]).toMatch(/^cme_/);
    }
    expect(firstImport.collections.some((col) => col.slug === 'articles')).toBe(true);
    expect(firstImport.hits.length).toBeGreaterThanOrEqual(1);

    // The hero asset id inside entry data was remapped to the new asset id.
    const newAssetId = firstImport.result.idMap[srcAssetId];
    const refundEntry = firstImport.entries.find((e) => e.slug === 'refund-policy');
    expect(refundEntry).toBeTruthy();
    const hero = (refundEntry!.data as { hero?: unknown }).hero;
    const heroId = typeof hero === 'string' ? hero : (hero as { id?: string } | null)?.id;
    expect(heroId).toBe(newAssetId);

    const secondImport = await withClient(adminKeyB, async (c) => {
      const res = await c.callTool({ name: 'cms_import', arguments: { records: seeded.exported } });
      const result = firstJson(res as never) as ImportResult;
      const collections = firstJson(
        (await c.callTool({ name: 'cms_list_collections', arguments: {} })) as never,
      ) as Array<unknown>;
      const entries = firstJson(
        (await c.callTool({ name: 'cms_list_entries', arguments: {} })) as never,
      ) as Array<unknown>;
      const locales = firstJson(
        (await c.callTool({ name: 'cms_list_locales', arguments: {} })) as never,
      ) as Array<unknown>;
      const assets = firstJson(
        (await c.callTool({ name: 'cms_list_assets', arguments: {} })) as never,
      ) as Array<unknown>;
      return {
        result,
        collectionCount: collections.length,
        entryCount: entries.length,
        localeCount: locales.length,
        assetCount: assets.length,
      };
    });

    expect(secondImport.result.created).toBe(0);
    expect(secondImport.result.skipped).toBe(5);
    expect(secondImport.collectionCount).toBe(1);
    expect(secondImport.entryCount).toBe(2);
    expect(secondImport.localeCount).toBe(1);
    expect(secondImport.assetCount).toBe(1);
  });
});
