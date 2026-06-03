import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  ActorIdentity,
  StubEmbeddingProvider,
  WebhookDispatcher,
  withContext,
  type AssetStorage,
  type RequestContext,
} from '@getmunin/core';
import { createDb, runMigrations, schema } from '@getmunin/db';
import { eq, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { BadRequestException, NotFoundException, ConflictException } from '@nestjs/common';
import {
  CmsService,
  CmsConflictError,
  CmsInvalidError,
} from './cms.service.ts';
import { EmbeddingProviderHolder } from '../kb/embedding.provider.ts';
import { DefaultQuotasService, QuotaExceededError } from '../../common/quotas/quotas.service.ts';

const TEST_URL = process.env.TEST_DATABASE_URL;
const skipReason = TEST_URL
  ? null
  : 'Set TEST_DATABASE_URL to a Postgres URL to run CMS service tests.';

class StubStorage implements AssetStorage {
  readonly provider = 'local' as const;
  readonly deletes: string[] = [];
  readonly objects = new Map<string, number>();
  presignedUpload(opts: { key: string; mime: string; sizeBytes: number }) {
    return Promise.resolve({
      uploadUrl: `https://upload.test/${opts.key}`,
      uploadMethod: 'PUT' as const,
      uploadFields: {},
      publicUrl: `https://cdn.test/${opts.key}`,
      expiresAt: new Date(Date.now() + 60_000),
    });
  }
  delete(key: string): Promise<void> {
    this.deletes.push(key);
    this.objects.delete(key);
    return Promise.resolve();
  }
  publicUrlFor(key: string): string {
    return `https://cdn.test/${key}`;
  }
  statBytes(key: string): Promise<number | null> {
    return Promise.resolve(this.objects.get(key) ?? null);
  }
  setObject(key: string, sizeBytes: number): void {
    this.objects.set(key, sizeBytes);
  }
  readonly directWrites: { key: string; size: number; mime?: string }[] = [];
  writeDirect(key: string, body: Buffer, opts?: { mime?: string }): Promise<void> {
    this.directWrites.push({ key, size: body.length, mime: opts?.mime });
    this.objects.set(key, body.length);
    return Promise.resolve();
  }
}

(skipReason ? describe.skip : describe)('CmsService', () => {
  let db: ReturnType<typeof createDb>;
  let appDb: ReturnType<typeof createDb>;
  let svc: CmsService;
  let storage: StubStorage;
  let orgId: string;
  let actor: ActorIdentity;

  beforeAll(async () => {
    await runMigrations(TEST_URL!);
    db = createDb(TEST_URL!, { serviceRole: true });
    const appUrl = TEST_URL!.replace(/(postgres(?:ql)?:\/\/)[^:@]+:[^@]+@/, '$1munin_app:munin_app@');
    appDb = createDb(appUrl);

    const ts = Date.now();
    const [org] = await db
      .insert(schema.orgs)
      .values({ name: 'CMS Service Test Org' })
      .returning();
    orgId = org!.id;
    actor = new ActorIdentity('admin_agent', 'agt_cms_test', orgId, ['*'], ['admin']);

    const holder = new (class extends EmbeddingProviderHolder {
      override get() {
        return new StubEmbeddingProvider();
      }
    })();
    storage = new StubStorage();
    svc = new CmsService(new DefaultQuotasService(), new WebhookDispatcher(), storage, holder);
  });

  afterAll(async () => {
    if (db) {
      await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
      await db.delete(schema.orgs).where(sql`id = ${orgId}`);
    }
  });

  beforeEach(async () => {
    await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
    await db.execute(sql`DELETE FROM cms_references WHERE org_id = ${orgId}`);
    await db.execute(sql`DELETE FROM cms_entry_versions WHERE org_id = ${orgId}`);
    await db.execute(sql`DELETE FROM cms_entries WHERE org_id = ${orgId}`);
    await db.execute(sql`DELETE FROM cms_assets WHERE org_id = ${orgId}`);
    await db.execute(sql`DELETE FROM cms_collections WHERE org_id = ${orgId}`);
    await db.execute(sql`DELETE FROM cms_locales WHERE org_id = ${orgId}`);
    await db.execute(sql`DELETE FROM webhook_deliveries WHERE webhook_id IN (SELECT id FROM webhooks WHERE org_id = ${orgId})`);
    await db.execute(sql`DELETE FROM webhooks WHERE org_id = ${orgId}`);
    await db.execute(sql`DELETE FROM events WHERE org_id = ${orgId}`);
    await db.update(schema.orgs).set({ settings: {} }).where(sql`id = ${orgId}`);
    storage.deletes.length = 0;
    storage.objects.clear();
  });

  function run<T>(fn: () => Promise<T>, runAs: ActorIdentity = actor): Promise<T> {
    return appDb.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.bypass_rls', 'off', true)`);
      await tx.execute(sql`SELECT set_config('app.org_id', ${runAs.orgId}, true)`);
      const ctx: RequestContext = {
        db: tx,
        actor: runAs,
        correlationId: randomUUID(),
      };
      return withContext(ctx, fn);
    });
  }

  async function ensureLocale(code = 'en'): Promise<void> {
    await db.insert(schema.cmsLocales).values({
      orgId,
      code,
      name: code === 'en' ? 'English' : code,
      isDefault: code === 'en',
      position: 0,
    });
  }

  async function eventTypes(): Promise<string[]> {
    const rows = await db.execute<{ type: string }>(
      sql`SELECT type FROM events WHERE org_id = ${orgId} ORDER BY created_at`,
    );
    return rows.map((r) => r.type);
  }

  // ─── Collections ─────────────────────────────────────────────────────

  describe('collections', () => {
    it('createCollection persists, emits webhook, and lists', async () => {
      const created = await run(() =>
        svc.createCollection({
          name: 'Pages',
          slug: 'pages',
          fields: [{ name: 'title', type: 'text', required: true }],
        }),
      );
      expect(created.slug).toBe('pages');
      expect(created.fields).toEqual([{ name: 'title', type: 'text', required: true }]);
      expect(await eventTypes()).toEqual(['cms.collection.created']);

      const all = await run(() => svc.listCollections());
      expect(all.map((c) => c.slug)).toEqual(['pages']);
    });

    it('createCollection rejects bad slug', async () => {
      await expect(
        run(() =>
          svc.createCollection({
            name: 'X',
            slug: 'NOT VALID',
            fields: [{ name: 't', type: 'text' }],
          }),
        ),
      ).rejects.toThrow(CmsInvalidError);
    });

    it('createCollection rejects duplicate slug in same org', async () => {
      await run(() =>
        svc.createCollection({ name: 'A', slug: 'pages', fields: [{ name: 't', type: 'text' }] }),
      );
      await expect(
        run(() =>
          svc.createCollection({ name: 'B', slug: 'pages', fields: [{ name: 't', type: 'text' }] }),
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('getCollection accepts both id and slug; returns 404 for unknown', async () => {
      const created = await run(() =>
        svc.createCollection({ name: 'Pages', slug: 'pages', fields: [{ name: 't', type: 'text' }] }),
      );
      const bySlug = await run(() => svc.getCollection('pages'));
      const byId = await run(() => svc.getCollection(created.id));
      expect(bySlug.id).toBe(created.id);
      expect(byId.slug).toBe('pages');
      await expect(run(() => svc.getCollection('does-not-exist'))).rejects.toThrow(NotFoundException);
    });

    it('updateCollection patches name/description/fields/settings and emits a webhook only on field changes', async () => {
      const created = await run(() =>
        svc.createCollection({ name: 'Pages', slug: 'pages', fields: [{ name: 't', type: 'text' }] }),
      );
      await db.execute(sql`DELETE FROM events WHERE org_id = ${orgId}`); // clear creation event
      const renamed = await run(() =>
        svc.updateCollection(created.id, { name: 'Static Pages', description: 'desc' }),
      );
      expect(renamed.name).toBe('Static Pages');
      expect(renamed.description).toBe('desc');
      expect(await eventTypes()).toEqual([]);

      const reshaped = await run(() =>
        svc.updateCollection(created.id, {
          fields: [
            { name: 't', type: 'text' },
            { name: 'body', type: 'text' },
          ],
        }),
      );
      expect(reshaped.fields).toHaveLength(2);
      expect(await eventTypes()).toEqual(['cms.collection.fields_changed']);
    });

    it('deleteCollection removes the collection', async () => {
      const created = await run(() =>
        svc.createCollection({ name: 'X', slug: 'x', fields: [{ name: 't', type: 'text' }] }),
      );
      const result = await run(() => svc.deleteCollection(created.id));
      expect(result).toEqual({ deleted: true });
      await expect(run(() => svc.getCollection(created.id))).rejects.toThrow(NotFoundException);
    });
  });

  // ─── Entries ─────────────────────────────────────────────────────────

  describe('entries', () => {
    async function seedCollection() {
      await ensureLocale('en');
      return run(() =>
        svc.createCollection({
          name: 'Articles',
          slug: 'articles',
          fields: [
            { name: 'title', type: 'text', required: true },
            { name: 'body', type: 'text' },
          ],
        }),
      );
    }

    it('createEntry as draft and listEntries returns it', async () => {
      const col = await seedCollection();
      const entry = await run(() =>
        svc.createEntry({
          collection: col.slug,
          slug: 'first',
          data: { title: 'Hello', body: 'World' },
        }),
      );
      expect(entry.status).toBe('draft');
      expect(entry.version).toBe(1);
      expect(entry.collectionSlug).toBe('articles');
      const list = await run(() => svc.listEntries({}));
      expect(list.map((e) => e.slug)).toEqual(['first']);
    });

    it('createEntry as published emits both created and published events', async () => {
      const col = await seedCollection();
      await run(() =>
        svc.createEntry({
          collection: col.slug,
          slug: 'pub',
          data: { title: 'Pub' },
          status: 'published',
        }),
      );
      const types = await eventTypes();
      expect(types).toContain('cms.entry.created');
      expect(types).toContain('cms.entry.published');
    });

    it('createEntry validates fields and rejects invalid data', async () => {
      const col = await seedCollection();
      await expect(
        run(() =>
          svc.createEntry({
            collection: col.slug,
            slug: 'bad',
            data: {},
          }),
        ),
      ).rejects.toThrow(CmsInvalidError);
    });

    it('listEntries filters by collection, status, locale', async () => {
      const col = await seedCollection();
      await run(() => svc.createEntry({ collection: col.slug, slug: 'a', data: { title: 'A' } }));
      await run(() =>
        svc.createEntry({
          collection: col.slug,
          slug: 'b',
          data: { title: 'B' },
          status: 'published',
        }),
      );
      const drafts = await run(() => svc.listEntries({ status: 'draft' }));
      expect(drafts.map((e) => e.slug)).toEqual(['a']);
      const byCollection = await run(() => svc.listEntries({ collection: col.slug }));
      expect(byCollection).toHaveLength(2);
      const byLocale = await run(() => svc.listEntries({ locale: 'en' }));
      expect(byLocale).toHaveLength(2);
    });

    it('getEntry returns 404 for unknown', async () => {
      await expect(run(() => svc.getEntry(randomUUID()))).rejects.toThrow(NotFoundException);
    });

    it('updateEntry bumps version, fails on stale ifVersion', async () => {
      const col = await seedCollection();
      const entry = await run(() =>
        svc.createEntry({ collection: col.slug, slug: 'u', data: { title: 'Old' } }),
      );
      const updated = await run(() =>
        svc.updateEntry({ id: entry.id, ifVersion: 1, data: { title: 'New' } }),
      );
      expect(updated.version).toBe(2);
      expect(updated.data.title).toBe('New');
      await expect(
        run(() => svc.updateEntry({ id: entry.id, ifVersion: 1, data: { title: 'stale' } })),
      ).rejects.toThrow(CmsConflictError);
    });

    it('updateEntry shallow-merges data into the existing entry', async () => {
      const col = await seedCollection();
      const entry = await run(() =>
        svc.createEntry({
          collection: col.slug,
          slug: 'merge',
          data: { title: 'Original', body: 'Body stays' },
        }),
      );
      const updated = await run(() =>
        svc.updateEntry({ id: entry.id, ifVersion: 1, data: { title: 'Patched' } }),
      );
      expect(updated.data.title).toBe('Patched');
      expect(updated.data.body).toBe('Body stays');
    });

    it('updateEntry passes validation on partial patch that omits required fields', async () => {
      const col = await seedCollection();
      const entry = await run(() =>
        svc.createEntry({
          collection: col.slug,
          slug: 'partial',
          data: { title: 'Required is set', body: 'b' },
        }),
      );
      await expect(
        run(() => svc.updateEntry({ id: entry.id, ifVersion: 1, data: { body: 'b2' } })),
      ).resolves.toBeTruthy();
    });

    it('updateEntry clears a single field when patch sends null', async () => {
      const col = await seedCollection();
      const entry = await run(() =>
        svc.createEntry({
          collection: col.slug,
          slug: 'clear',
          data: { title: 'Keep', body: 'remove me' },
        }),
      );
      const updated = await run(() =>
        svc.updateEntry({ id: entry.id, ifVersion: 1, data: { body: null } }),
      );
      expect(updated.data.title).toBe('Keep');
      expect(updated.data.body).toBeNull();
    });

    it('updateEntry with no field change does not invoke embedding rebuild', async () => {
      const col = await seedCollection();
      const entry = await run(() =>
        svc.createEntry({ collection: col.slug, slug: 's', data: { title: 'X' } }),
      );
      const before = await db.execute<{ search_text: string | null; embedding: string | null }>(
        sql`SELECT search_text, embedding::text AS embedding FROM cms_entries WHERE id = ${entry.id}`,
      );
      // Update with same data — content hash unchanged.
      const after = await run(() =>
        svc.updateEntry({ id: entry.id, ifVersion: 1, data: { title: 'X' } }),
      );
      expect(after.version).toBe(2);
      const afterRow = await db.execute<{ search_text: string | null; embedding: string | null }>(
        sql`SELECT search_text, embedding::text AS embedding FROM cms_entries WHERE id = ${entry.id}`,
      );
      expect(afterRow[0]!.search_text).toBe(before[0]!.search_text);
      expect(afterRow[0]!.embedding).toBe(before[0]!.embedding);
    });

    it('publishEntry/unpublishEntry transitions state, emits webhooks', async () => {
      const col = await seedCollection();
      const entry = await run(() =>
        svc.createEntry({ collection: col.slug, slug: 'p', data: { title: 'P' } }),
      );
      const published = await run(() => svc.publishEntry({ id: entry.id, ifVersion: 1 }));
      expect(published.status).toBe('published');
      expect(published.publishedAt).not.toBeNull();
      const unpublished = await run(() =>
        svc.unpublishEntry({ id: entry.id, ifVersion: published.version }),
      );
      expect(unpublished.status).toBe('draft');
      expect(unpublished.publishedAt).toBeNull();
      const types = await eventTypes();
      expect(types).toContain('cms.entry.published');
      expect(types).toContain('cms.entry.unpublished');
    });

    it('publishEntry rejects stale ifVersion', async () => {
      const col = await seedCollection();
      const entry = await run(() =>
        svc.createEntry({ collection: col.slug, slug: 'p2', data: { title: 'P' } }),
      );
      await expect(run(() => svc.publishEntry({ id: entry.id, ifVersion: 99 }))).rejects.toThrow(
        CmsConflictError,
      );
    });

    it('scheduleEntry rejects non-future scheduledAt and invalid ISO', async () => {
      const col = await seedCollection();
      const entry = await run(() =>
        svc.createEntry({ collection: col.slug, slug: 'sched', data: { title: 'S' } }),
      );
      await expect(
        run(() =>
          svc.scheduleEntry({
            id: entry.id,
            ifVersion: 1,
            scheduledAt: new Date(Date.now() - 1000).toISOString(),
          }),
        ),
      ).rejects.toThrow(CmsInvalidError);
      await expect(
        run(() =>
          svc.scheduleEntry({ id: entry.id, ifVersion: 1, scheduledAt: 'not-iso' }),
        ),
      ).rejects.toThrow(CmsInvalidError);
    });

    it('scheduleEntry sets status=scheduled and emits webhook', async () => {
      const col = await seedCollection();
      const entry = await run(() =>
        svc.createEntry({ collection: col.slug, slug: 'ok', data: { title: 'S' } }),
      );
      const future = new Date(Date.now() + 60_000).toISOString();
      const scheduled = await run(() =>
        svc.scheduleEntry({ id: entry.id, ifVersion: 1, scheduledAt: future }),
      );
      expect(scheduled.status).toBe('scheduled');
      expect(scheduled.scheduledAt).toBeTruthy();
      expect(await eventTypes()).toContain('cms.entry.scheduled');
    });

    it('publishById flips a scheduled entry to published (worker path)', async () => {
      const col = await seedCollection();
      const entry = await run(() =>
        svc.createEntry({ collection: col.slug, slug: 'wkr', data: { title: 'W' } }),
      );
      await run(() =>
        svc.scheduleEntry({
          id: entry.id,
          ifVersion: 1,
          scheduledAt: new Date(Date.now() + 60_000).toISOString(),
        }),
      );
      const promoted = await run(() => svc.publishById(entry.id));
      expect(promoted.status).toBe('published');
    });

    it('deleteEntry removes the row and emits a webhook', async () => {
      const col = await seedCollection();
      const entry = await run(() =>
        svc.createEntry({ collection: col.slug, slug: 'd', data: { title: 'D' } }),
      );
      await expect(run(() => svc.deleteEntry({ id: entry.id, ifVersion: 99 }))).rejects.toThrow(
        CmsConflictError,
      );
      const result = await run(() => svc.deleteEntry({ id: entry.id, ifVersion: 1 }));
      expect(result).toEqual({ deleted: true });
      expect(await eventTypes()).toContain('cms.entry.deleted');
      await expect(run(() => svc.getEntry(entry.id))).rejects.toThrow(NotFoundException);
    });

    it('listVersions returns versions in descending order', async () => {
      const col = await seedCollection();
      const entry = await run(() =>
        svc.createEntry({ collection: col.slug, slug: 'v', data: { title: 'v1' } }),
      );
      await run(() => svc.updateEntry({ id: entry.id, ifVersion: 1, data: { title: 'v2' } }));
      const versions = await run(() => svc.listVersions(entry.id));
      expect(versions.map((v) => v.version)).toEqual([2, 1]);
    });

    it('restoreVersion creates a new version with prior data', async () => {
      const col = await seedCollection();
      const entry = await run(() =>
        svc.createEntry({ collection: col.slug, slug: 'r', data: { title: 'v1' } }),
      );
      await run(() => svc.updateEntry({ id: entry.id, ifVersion: 1, data: { title: 'v2' } }));
      const restored = await run(() =>
        svc.restoreVersion({ entryId: entry.id, version: 1, ifVersion: 2 }),
      );
      expect(restored.version).toBe(3);
      expect(restored.data.title).toBe('v1');
    });

    it('restoreVersion rejects unknown versions and stale ifVersion', async () => {
      const col = await seedCollection();
      const entry = await run(() =>
        svc.createEntry({ collection: col.slug, slug: 'r2', data: { title: 'v1' } }),
      );
      await expect(
        run(() => svc.restoreVersion({ entryId: entry.id, version: 99, ifVersion: 1 })),
      ).rejects.toThrow(NotFoundException);
      await expect(
        run(() => svc.restoreVersion({ entryId: entry.id, version: 1, ifVersion: 99 })),
      ).rejects.toThrow(CmsConflictError);
    });

    it('listDraftEntries returns only drafts with collection name and word count', async () => {
      const col = await seedCollection();
      await run(() =>
        svc.createEntry({
          collection: col.slug,
          slug: 'd1',
          data: { title: 'Draft one', body: 'one two three' },
        }),
      );
      await run(() =>
        svc.createEntry({
          collection: col.slug,
          slug: 'd2',
          data: { title: 'Draft two' },
        }),
      );
      await run(() =>
        svc.createEntry({
          collection: col.slug,
          slug: 'pub',
          data: { title: 'Published', body: 'should not appear' },
          status: 'published',
        }),
      );

      const drafts = await run(() => svc.listDraftEntries());
      const byId = new Map(drafts.map((d) => [d.slug, d]));
      expect([...byId.keys()].sort()).toEqual(['d1', 'd2']);
      expect(byId.get('d1')).toMatchObject({
        title: 'Draft one',
        wordCount: 3,
        collectionName: 'Articles',
        collectionSlug: 'articles',
        locale: 'en',
      });
      expect(byId.get('d2')).toMatchObject({ title: 'Draft two', wordCount: null });
    });

    it('archiveEntry transitions draft to archived and emits webhook', async () => {
      const col = await seedCollection();
      const entry = await run(() =>
        svc.createEntry({ collection: col.slug, slug: 'a1', data: { title: 'A' } }),
      );
      const archived = await run(() =>
        svc.archiveEntry({ id: entry.id, ifVersion: entry.version }),
      );
      expect(archived.status).toBe('archived');
      expect(archived.version).toBe(entry.version + 1);
      const drafts = await run(() => svc.listDraftEntries());
      expect(drafts.find((d) => d.id === entry.id)).toBeUndefined();
      expect(await eventTypes()).toContain('cms.entry.archived');
    });
  });

  // ─── Assets ──────────────────────────────────────────────────────────

  describe('assets', () => {
    it('requestAssetUpload mints a presigned upload and persists a non-uploaded row', async () => {
      const handle = await run(() =>
        svc.requestAssetUpload({ name: 'pic.png', mime: 'image/png', sizeBytes: 1024 }),
      );
      expect(handle.uploaded).toBe(false);
      expect(handle.uploadUrl).toContain('upload.test');
      expect(handle.publicUrl).toContain('cdn.test');
      expect(handle.storageKey.startsWith('cms/')).toBe(true);

      const list = await run(() => svc.listAssets({}));
      expect(list.find((a) => a.id === handle.id)).toBeTruthy();
    });

    it('requestAssetUpload rejects bad sizeBytes', async () => {
      await expect(
        run(() =>
          svc.requestAssetUpload({ name: 'x.png', mime: 'image/png', sizeBytes: 0 }),
        ),
      ).rejects.toThrow(CmsInvalidError);
      await expect(
        run(() =>
          svc.requestAssetUpload({
            name: 'x.png',
            mime: 'image/png',
            sizeBytes: 100 * 1024 * 1024,
          }),
        ),
      ).rejects.toThrow(CmsInvalidError);
    });

    it('requestAssetUpload rejects SVG by extension', async () => {
      await expect(
        run(() =>
          svc.requestAssetUpload({
            name: 'logo.svg',
            mime: 'application/octet-stream',
            sizeBytes: 1024,
          }),
        ),
      ).rejects.toThrow(/svg uploads are not allowed/);
    });

    it('requestAssetUpload rejects SVG by mime even when extension is laundered', async () => {
      await expect(
        run(() =>
          svc.requestAssetUpload({
            name: 'logo.png',
            mime: 'image/svg+xml',
            sizeBytes: 1024,
          }),
        ),
      ).rejects.toThrow(/svg uploads are not allowed/);
      await expect(
        run(() =>
          svc.requestAssetUpload({
            name: 'logo.png',
            mime: 'IMAGE/SVG+XML; charset=utf-8',
            sizeBytes: 1024,
          }),
        ),
      ).rejects.toThrow(/svg uploads are not allowed/);
    });

    it('completeAssetUpload flips the uploaded flag when actual size matches', async () => {
      const handle = await run(() =>
        svc.requestAssetUpload({ name: 'pic.png', mime: 'image/png', sizeBytes: 1024 }),
      );
      storage.setObject(handle.storageKey, 1024);
      const completed = await run(() => svc.completeAssetUpload({ id: handle.id }));
      expect(completed.uploaded).toBe(true);
    });

    it('completeAssetUpload returns 404 for unknown id', async () => {
      await expect(run(() => svc.completeAssetUpload({ id: randomUUID() }))).rejects.toThrow(
        NotFoundException,
      );
    });

    it('completeAssetUpload rejects when no object landed in storage', async () => {
      const handle = await run(() =>
        svc.requestAssetUpload({ name: 'pic.png', mime: 'image/png', sizeBytes: 1024 }),
      );
      await expect(run(() => svc.completeAssetUpload({ id: handle.id }))).rejects.toThrow(
        BadRequestException,
      );
      const list = await run(() => svc.listAssets({}));
      expect(list.find((a) => a.id === handle.id)?.uploaded).toBe(false);
    });

    it('completeAssetUpload rejects + deletes storage object when uploaded body exceeds declared size', async () => {
      const handle = await run(() =>
        svc.requestAssetUpload({ name: 'pic.png', mime: 'image/png', sizeBytes: 1024 }),
      );
      storage.setObject(handle.storageKey, 2048);
      await expect(run(() => svc.completeAssetUpload({ id: handle.id }))).rejects.toThrow(
        /cms_upload_size_mismatch/,
      );
      expect(storage.deletes).toContain(handle.storageKey);
      const list = await run(() => svc.listAssets({}));
      expect(list.find((a) => a.id === handle.id)?.uploaded).toBe(false);
    });

    it('completeAssetUpload rejects + deletes storage object when uploaded body is smaller than declared size', async () => {
      const handle = await run(() =>
        svc.requestAssetUpload({ name: 'pic.png', mime: 'image/png', sizeBytes: 1024 }),
      );
      storage.setObject(handle.storageKey, 512);
      await expect(run(() => svc.completeAssetUpload({ id: handle.id }))).rejects.toThrow(
        /cms_upload_size_mismatch/,
      );
      expect(storage.deletes).toContain(handle.storageKey);
    });

    it('deleteAsset deletes the row and asks storage to delete the key', async () => {
      const handle = await run(() =>
        svc.requestAssetUpload({ name: 'pic.png', mime: 'image/png', sizeBytes: 1024 }),
      );
      const result = await run(() => svc.deleteAsset({ id: handle.id }));
      expect(result).toEqual({ deleted: true });
      expect(storage.deletes).toContain(handle.storageKey);
      const list = await run(() => svc.listAssets({}));
      expect(list.find((a) => a.id === handle.id)).toBeFalsy();
    });

    it('deleteAsset returns 404 for unknown id', async () => {
      await expect(run(() => svc.deleteAsset({ id: randomUUID() }))).rejects.toThrow(
        NotFoundException,
      );
    });

    it('uploadAssetBytes writes bytes directly and persists an uploaded row', async () => {
      const body = Buffer.from('hello-world-binary');
      const asset = await run(() =>
        svc.uploadAssetBytes({
          name: 'pic.png',
          mime: 'image/png',
          base64Body: body.toString('base64'),
        }),
      );
      expect(asset.uploaded).toBe(true);
      expect(asset.sizeBytes).toBe(body.length);
      const write = storage.directWrites.find((w) => w.key === asset.storageKey);
      expect(write).toBeTruthy();
      expect(write!.size).toBe(body.length);
      expect(write!.mime).toBe('image/png');
    });

    it('uploadAssetBytes rejects empty body', async () => {
      await expect(
        run(() =>
          svc.uploadAssetBytes({ name: 'pic.png', mime: 'image/png', base64Body: '' }),
        ),
      ).rejects.toThrow();
    });

    it('uploadAssetBytes rejects >2MB decoded body', async () => {
      const huge = Buffer.alloc(2 * 1024 * 1024 + 1, 1);
      await expect(
        run(() =>
          svc.uploadAssetBytes({
            name: 'big.bin',
            mime: 'application/octet-stream',
            base64Body: huge.toString('base64'),
          }),
        ),
      ).rejects.toThrow(/exceeds 2MB/);
    });

    it('uploadAssetBytes rejects malformed base64', async () => {
      await expect(
        run(() =>
          svc.uploadAssetBytes({
            name: 'pic.png',
            mime: 'image/png',
            base64Body: 'not!base64@@@',
          }),
        ),
      ).rejects.toThrow(/invalid characters/);
    });

    it('uploadAssetBytes rejects SVG by extension and by mime', async () => {
      const body = Buffer.from('<svg/>').toString('base64');
      await expect(
        run(() =>
          svc.uploadAssetBytes({ name: 'logo.svg', mime: 'application/octet-stream', base64Body: body }),
        ),
      ).rejects.toThrow(/svg uploads are not allowed/);
      await expect(
        run(() =>
          svc.uploadAssetBytes({ name: 'logo.png', mime: 'image/svg+xml', base64Body: body }),
        ),
      ).rejects.toThrow(/svg uploads are not allowed/);
    });
  });

  // ─── Locales ─────────────────────────────────────────────────────────

  describe('locales', () => {
    it('createLocale: first locale becomes default; later locales do not unless flagged', async () => {
      const en = await run(() => svc.createLocale({ code: 'en', name: 'English' }));
      expect(en.isDefault).toBe(true);
      const es = await run(() => svc.createLocale({ code: 'es', name: 'Spanish' }));
      expect(es.isDefault).toBe(false);

      const all = await run(() => svc.listLocales());
      expect(all.map((l) => l.code).sort()).toEqual(['en', 'es']);
    });

    it('createLocale rejects malformed codes', async () => {
      await expect(run(() => svc.createLocale({ code: 'EN', name: 'x' }))).rejects.toThrow(
        CmsInvalidError,
      );
      await expect(run(() => svc.createLocale({ code: 'english', name: 'x' }))).rejects.toThrow(
        CmsInvalidError,
      );
    });

    it('createLocale flagged as default unsets the previous default', async () => {
      await run(() => svc.createLocale({ code: 'en', name: 'English' }));
      const fr = await run(() => svc.createLocale({ code: 'fr', name: 'French', isDefault: true }));
      expect(fr.isDefault).toBe(true);
      const all = await run(() => svc.listLocales());
      expect(all.find((l) => l.code === 'en')!.isDefault).toBe(false);
    });

    it('setDefaultLocale switches the default flag', async () => {
      await run(() => svc.createLocale({ code: 'en', name: 'English' }));
      await run(() => svc.createLocale({ code: 'es', name: 'Spanish' }));
      const newDefault = await run(() => svc.setDefaultLocale({ code: 'es' }));
      expect(newDefault.isDefault).toBe(true);
      const all = await run(() => svc.listLocales());
      expect(all.find((l) => l.code === 'en')!.isDefault).toBe(false);
    });

    it('setDefaultLocale returns 404 for unknown code', async () => {
      await expect(run(() => svc.setDefaultLocale({ code: 'xx' }))).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ─── References ──────────────────────────────────────────────────────

  describe('references', () => {
    it('listInboundReferences returns rows pointing at an entry', async () => {
      await ensureLocale('en');
      const refsCol = await run(() =>
        svc.createCollection({
          name: 'WithRefs',
          slug: 'with-refs',
          fields: [
            { name: 'title', type: 'text', required: true },
            { name: 'related', type: 'reference' },
          ],
        }),
      );
      const target = await run(() =>
        svc.createEntry({
          collection: refsCol.slug,
          slug: 'target',
          data: { title: 'Target' },
        }),
      );
      const linker = await run(() =>
        svc.createEntry({
          collection: refsCol.slug,
          slug: 'linker',
          data: { title: 'Linker', related: target.id },
        }),
      );
      const refs = await run(() => svc.listInboundReferences(target.id));
      expect(refs.find((r) => r.fromEntryId === linker.id && r.fieldName === 'related')).toBeTruthy();
    });
  });

  // ─── Quotas / RLS ────────────────────────────────────────────────────

  describe('quotas and RLS', () => {
    let previousQuotasEnv: string | undefined;
    beforeAll(() => {
      previousQuotasEnv = process.env.MUNIN_QUOTAS_ENABLED;
      process.env.MUNIN_QUOTAS_ENABLED = 'true';
    });
    afterAll(() => {
      if (previousQuotasEnv === undefined) delete process.env.MUNIN_QUOTAS_ENABLED;
      else process.env.MUNIN_QUOTAS_ENABLED = previousQuotasEnv;
    });

    it('createCollection respects org quota cap', async () => {
      await db
        .update(schema.orgs)
        .set({ settings: { quotas: { cms_collections: 1 } } })
        .where(sql`id = ${orgId}`);
      try {
        await run(() =>
          svc.createCollection({ name: 'A', slug: 'a', fields: [{ name: 't', type: 'text' }] }),
        );
        await expect(
          run(() =>
            svc.createCollection({ name: 'B', slug: 'b', fields: [{ name: 't', type: 'text' }] }),
          ),
        ).rejects.toThrow(QuotaExceededError);
      } finally {
        await db.update(schema.orgs).set({ settings: {} }).where(sql`id = ${orgId}`);
      }
    });

    it('createEntry respects org quota cap', async () => {
      await ensureLocale('en');
      const col = await run(() =>
        svc.createCollection({
          name: 'Q',
          slug: 'q',
          fields: [{ name: 'title', type: 'text', required: true }],
        }),
      );
      await db
        .update(schema.orgs)
        .set({ settings: { quotas: { cms_entries: 1 } } })
        .where(sql`id = ${orgId}`);
      try {
        await run(() =>
          svc.createEntry({ collection: col.slug, slug: 'one', data: { title: 'one' } }),
        );
        await expect(
          run(() =>
            svc.createEntry({ collection: col.slug, slug: 'two', data: { title: 'two' } }),
          ),
        ).rejects.toThrow(QuotaExceededError);
      } finally {
        await db.update(schema.orgs).set({ settings: {} }).where(sql`id = ${orgId}`);
      }
    });

    it('cross-org RLS isolation: another org cannot see this org\'s collections', async () => {
      const col = await run(() =>
        svc.createCollection({
          name: 'Private',
          slug: 'private',
          fields: [{ name: 't', type: 'text' }],
        }),
      );
      // Create a second org and an actor scoped to it.
      const ts = Date.now();
      const [otherOrg] = await db
        .insert(schema.orgs)
        .values({ name: 'Other Org' })
        .returning();
      const otherActor = new ActorIdentity('admin_agent', 'agt_other', otherOrg!.id, ['*'], ['admin']);
      try {
        const visible = await run(() => svc.listCollections(), otherActor);
        expect(visible.find((c) => c.id === col.id)).toBeFalsy();
      } finally {
        await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
        await db.delete(schema.orgs).where(eq(schema.orgs.id, otherOrg!.id));
      }
    });
  });
});
