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
import { eq, sql } from 'drizzle-orm';
import { AppModule } from '../../app.module.ts';

const TEST_URL = process.env.TEST_DATABASE_URL;
const skipReason = TEST_URL
  ? null
  : 'Set TEST_DATABASE_URL to a Postgres URL to run CMS transfer integration tests.';

const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

const ORIGINAL_PUBLISHED_AT = '2019-04-12T08:30:00.000Z';

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
    entries: Array<{
      id: string;
      collectionId: string;
      slug: string;
      locale: string;
      publishedAt: string | null;
      translationGroupId: string;
    }>;
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
        })),
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
        })),
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
          publishedAt: ORIGINAL_PUBLISHED_AT,
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

      const exported = firstJson((await c.callTool({ name: 'cms_export', arguments: {} }))) as CmsExportData;
      return { asset, collection, exported };
    });

    expect(seeded.exported.locales.length).toBe(1);
    expect(seeded.exported.collections.length).toBe(1);
    expect(seeded.exported.entries.length).toBe(2);
    expect(seeded.exported.assets.length).toBe(1);
    expect(seeded.exported.assets[0]!.base64Body).toBeTruthy();
    expect(
      seeded.exported.entries.find((e) => e.slug === 'refund-policy')!.publishedAt,
    ).toBe(ORIGINAL_PUBLISHED_AT);

    const srcLocaleId = seeded.exported.locales[0]!.id;
    const srcCollectionId = seeded.exported.collections[0]!.id;
    const srcEntryIds = seeded.exported.entries.map((e) => e.id);
    const srcAssetId = seeded.exported.assets[0]!.id;

    const firstImport = await withClient(adminKeyB, async (c) => {
      const res = await c.callTool({ name: 'cms_import', arguments: { records: seeded.exported } });
      const result = firstJson(res) as ImportResult;

      const searched = await c.callTool({
        name: 'cms_search_entries',
        arguments: { query: 'refund processed' },
      });
      const hits = firstJson(searched) as Array<{ entryId?: string; id?: string }>;
      const collections = firstJson(
        (await c.callTool({ name: 'cms_list_collections', arguments: {} })),
      ) as Array<{ id: string; slug: string }>;
      const entries = firstJson(
        (await c.callTool({ name: 'cms_list_entries', arguments: {} })),
      ) as {
        entries: Array<{
          id: string;
          slug: string;
          data: Record<string, unknown>;
          publishedAt: string | null;
        }>;
      };
      return { result, hits, collections, entries: entries.entries };
    });

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

    const newAssetId = firstImport.result.idMap[srcAssetId];
    const refundEntry = firstImport.entries.find((e) => e.slug === 'refund-policy');
    expect(refundEntry).toBeTruthy();
    expect(refundEntry!.publishedAt).toBe(ORIGINAL_PUBLISHED_AT);
    const hero = (refundEntry!.data as { hero?: unknown }).hero;
    const heroId = typeof hero === 'string' ? hero : (hero as { id?: string } | null)?.id;
    expect(heroId).toBe(newAssetId);

    const secondImport = await withClient(adminKeyB, async (c) => {
      const res = await c.callTool({ name: 'cms_import', arguments: { records: seeded.exported } });
      const result = firstJson(res) as ImportResult;
      const collections = firstJson(
        (await c.callTool({ name: 'cms_list_collections', arguments: {} })),
      ) as Array<unknown>;
      const entries = firstJson(
        (await c.callTool({ name: 'cms_list_entries', arguments: {} })),
      ) as { entries: Array<unknown> };
      const locales = firstJson(
        (await c.callTool({ name: 'cms_list_locales', arguments: {} })),
      ) as Array<unknown>;
      const assets = firstJson(
        (await c.callTool({ name: 'cms_list_assets', arguments: {} })),
      ) as Array<unknown>;
      return {
        result,
        collectionCount: collections.length,
        entryCount: entries.entries.length,
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

  it('restores scheduled and archived entries instead of collapsing them into drafts', async () => {
    const futureAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const pastAt = '2020-01-01T00:00:00.000Z';
    const records = {
      locales: [],
      collections: [
        {
          id: 'cmc_src_states',
          name: 'States',
          slug: 'states',
          description: null,
          fields: [{ name: 'title', type: 'text', required: true }],
          localized: false,
          settings: {},
        },
      ],
      entries: [
        {
          id: 'cme_src_future',
          collectionId: 'cmc_src_states',
          slug: 'future-launch',
          locale: 'en',
          status: 'scheduled',
          data: { title: 'Future launch' },
          publishedAt: null,
          scheduledAt: futureAt,
        },
        {
          id: 'cme_src_stale',
          collectionId: 'cmc_src_states',
          slug: 'stale-schedule',
          locale: 'en',
          status: 'scheduled',
          data: { title: 'Stale schedule' },
          publishedAt: null,
          scheduledAt: pastAt,
        },
        {
          id: 'cme_src_archived',
          collectionId: 'cmc_src_states',
          slug: 'retired-notice',
          locale: 'en',
          status: 'archived',
          data: { title: 'Retired notice' },
          publishedAt: null,
          scheduledAt: null,
        },
      ],
      assets: [],
    };

    const imported = await withClient(adminKeyB, async (c) => {
      const res = await c.callTool({ name: 'cms_import', arguments: { records } });
      const result = firstJson(res) as ImportResult;
      const entries = firstJson(
        (await c.callTool({ name: 'cms_list_entries', arguments: { collection: 'states' } })),
      ) as { entries: Array<{ slug: string; status: string }> };
      return { result, entries: entries.entries };
    });

    const byStatus = new Map(imported.entries.map((e) => [e.slug, e.status]));
    expect(byStatus.get('future-launch')).toBe('scheduled');
    expect(byStatus.get('retired-notice')).toBe('archived');
    expect(byStatus.get('stale-schedule')).toBe('draft');
    expect(
      imported.result.warnings.some(
        (w) => w.includes('stale-schedule') && w.includes('not in the future'),
      ),
    ).toBe(true);

    const scheduledRow = await db
      .select()
      .from(schema.cmsEntries)
      .where(eq(schema.cmsEntries.id, imported.result.idMap['cme_src_future']!));
    expect(scheduledRow[0]!.scheduledAt?.toISOString()).toBe(futureAt);
  });

  it('locale variants with different slugs stay one translation group across export → import', async () => {
    const exported = await withClient(adminKeyA, async (c) => {
      await c.callTool({ name: 'cms_create_locale', arguments: { code: 'nb', name: 'Norsk' } });
      await c.callTool({
        name: 'cms_create_collection',
        arguments: {
          name: 'Guides',
          slug: 'guides',
          fields: [{ name: 'title', type: 'text', required: true }],
        },
      });
      const base = firstJson(
        await c.callTool({
          name: 'cms_create_entry',
          arguments: {
            collection: 'guides',
            slug: 'getting-started',
            locale: 'en',
            data: { title: 'Getting started' },
          },
        }),
      ) as { id: string; translationGroupId: string };
      await c.callTool({
        name: 'cms_create_entry',
        arguments: {
          collection: 'guides',
          slug: 'kom-i-gang',
          locale: 'nb',
          translationOf: base.id,
          data: { title: 'Kom i gang' },
        },
      });
      return firstJson(await c.callTool({ name: 'cms_export', arguments: {} })) as CmsExportData;
    });

    const guideEntries = exported.entries.filter((e) => ['getting-started', 'kom-i-gang'].includes(e.slug));
    expect(guideEntries).toHaveLength(2);
    expect(new Set(guideEntries.map((e) => e.translationGroupId)).size).toBe(1);

    const imported = await withClient(adminKeyB, async (c) => {
      await c.callTool({ name: 'cms_import', arguments: { records: exported } });
      const entries = firstJson(await c.callTool({ name: 'cms_list_entries', arguments: {} })) as {
        entries: Array<{ slug: string; locale: string; translationGroupId: string }>;
      };
      return entries.entries.filter((e) => ['getting-started', 'kom-i-gang'].includes(e.slug));
    });

    expect(imported).toHaveLength(2);
    expect(new Set(imported.map((e) => e.translationGroupId)).size).toBe(1);
    expect(imported[0]!.translationGroupId).not.toBe(guideEntries[0]!.translationGroupId);
    expect(imported.map((e) => `${e.locale}:${e.slug}`).sort()).toEqual([
      'en:getting-started',
      'nb:kom-i-gang',
    ]);
  });

  it('does not persist SVG asset bytes on import (XSS-prone uploads blocked)', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(document.cookie)"></svg>';
    const records = {
      locales: [],
      collections: [],
      entries: [],
      assets: [
        {
          id: 'cma_src_svg',
          name: 'logo.svg',
          mime: 'image/svg+xml',
          sizeBytes: svg.length,
          storageKey: 'cms/source-org/logo.svg',
          altText: null,
          metadata: {},
          base64Body: Buffer.from(svg).toString('base64'),
        },
      ],
    };

    const result = await withClient(adminKeyB, async (c) => {
      const res = await c.callTool({ name: 'cms_import', arguments: { records } });
      return firstJson(res) as ImportResult;
    });

    expect(
      result.warnings.some((w) => w.includes('logo.svg') && w.includes('metadata only')),
    ).toBe(true);

    const newAssetId = result.idMap['cma_src_svg'];
    expect(newAssetId).toMatch(/^cma_/);
    const rows = await db
      .select()
      .from(schema.cmsAssets)
      .where(eq(schema.cmsAssets.id, newAssetId!));
    expect(rows[0]!.uploaded).toBe(false);
  });

  it('ignores a caller-supplied storageKey and generates a fresh org-scoped key', async () => {
    const maliciousKey = `cms/${orgAId}/pwned-by-import.png`;
    const records = {
      locales: [],
      collections: [],
      entries: [],
      assets: [
        {
          id: 'cma_src_key',
          name: 'fresh-pixel.png',
          mime: 'image/png',
          sizeBytes: 70,
          storageKey: maliciousKey,
          altText: null,
          metadata: {},
          base64Body: PNG_BASE64,
        },
      ],
    };

    const result = await withClient(adminKeyB, async (c) => {
      const res = await c.callTool({ name: 'cms_import', arguments: { records } });
      return firstJson(res) as ImportResult;
    });

    const newAssetId = result.idMap['cma_src_key'];
    expect(newAssetId).toMatch(/^cma_/);
    const rows = await db
      .select()
      .from(schema.cmsAssets)
      .where(eq(schema.cmsAssets.id, newAssetId!));
    const stored = rows[0]!;
    expect(stored.storageKey).not.toBe(maliciousKey);
    expect(stored.storageKey.startsWith(`cms/${orgBId}/`)).toBe(true);
  });
});
