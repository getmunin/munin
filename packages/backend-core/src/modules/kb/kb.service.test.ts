import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  ActorIdentity,
  StubEmbeddingProvider,
  withContext,
  type RequestContext,
} from '@getmunin/core';
import { createDb, runMigrations, schema } from '@getmunin/db';
import { sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { KbService, KbConflictError, KbNotFoundError, KbInvalidError } from './kb.service.js';
import { EmbeddingProviderHolder } from './embedding.provider.js';
import { QuotaExceededError, QuotasService } from '../../common/quotas/quotas.service.js';

const TEST_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const skipReason = TEST_URL
  ? null
  : 'Set DATABASE_URL or TEST_DATABASE_URL to a Postgres URL to run KB service tests.';

(skipReason ? describe.skip : describe)('KbService', () => {
  let db: ReturnType<typeof createDb>;
  let appDb: ReturnType<typeof createDb>;
  let svc: KbService;
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
      .values({ name: 'KB Test Org', slug: `kb-test-${ts}` })
      .returning();
    orgId = org!.id;
    actor = new ActorIdentity('admin_agent', 'agt_test', orgId, ['*'], ['admin']);

    const holder = new (class extends EmbeddingProviderHolder {
      override get() {
        return new StubEmbeddingProvider();
      }
    })();
    svc = new KbService(holder, new QuotasService());
  });

  afterAll(async () => {
    if (db) {
      await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
      await db.delete(schema.orgs).where(sql`id = ${orgId}`);
    }
  });

  beforeEach(async () => {
    await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
    await db.execute(sql`DELETE FROM kb_documents WHERE org_id = ${orgId}`);
    await db.execute(sql`DELETE FROM kb_spaces WHERE org_id = ${orgId}`);
  });

  function run<T>(fn: () => Promise<T>): Promise<T> {
    return appDb.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.bypass_rls', 'off', true)`);
      await tx.execute(sql`SELECT set_config('app.org_id', ${orgId}, true)`);
      const ctx: RequestContext = {
        db: tx,
        actor,
        correlationId: randomUUID(),
      };
      return withContext(ctx, fn);
    });
  }

  it('creates and lists spaces', async () => {
    await run(() => svc.createSpace({ name: 'Engineering', slug: 'engineering' }));
    await run(() => svc.createSpace({ name: 'Product', slug: 'product' }));
    const spaces = await run(() => svc.listSpaces());
    expect(spaces.map((s) => s.slug).sort()).toEqual(['engineering', 'product']);
  });

  it('rejects duplicate slugs and invalid slugs', async () => {
    await run(() => svc.createSpace({ name: 'A', slug: 'foo' }));
    await expect(run(() => svc.createSpace({ name: 'B', slug: 'foo' }))).rejects.toThrow(
      KbInvalidError,
    );
    await expect(run(() => svc.createSpace({ name: 'C', slug: 'BAD slug!' }))).rejects.toThrow(
      KbInvalidError,
    );
  });

  it('creates a document, chunks it, embeds, and snapshots v1', async () => {
    const space = await run(() => svc.createSpace({ name: 'Docs', slug: 'docs' }));
    const doc = await run(() =>
      svc.createDocument({
        spaceId: space.id,
        title: 'Onboarding',
        body: 'Welcome to Munin. This is the first paragraph.\n\nSecond paragraph here.',
      }),
    );
    expect(doc.version).toBe(1);
    expect(doc.public).toBe(false);

    const versions = await run(() => svc.listVersions(doc.id));
    expect(versions).toHaveLength(1);
    expect(versions[0]!.version).toBe(1);

    const chunkRows = await db.execute<{ count: number }>(
      sql`SELECT COUNT(*)::int AS count FROM kb_document_chunks WHERE document_id = ${doc.id}`,
    );
    expect(chunkRows[0]!.count).toBeGreaterThan(0);
  });

  it('updates with optimistic concurrency', async () => {
    const space = await run(() => svc.createSpace({ name: 'Docs', slug: 'docs' }));
    const doc = await run(() =>
      svc.createDocument({ spaceId: space.id, title: 'T', body: 'Body one' }),
    );
    const updated = await run(() =>
      svc.updateDocument({ id: doc.id, ifVersion: 1, body: 'Body two' }),
    );
    expect(updated.version).toBe(2);
    expect(updated.body).toBe('Body two');

    await expect(
      run(() => svc.updateDocument({ id: doc.id, ifVersion: 1, body: 'stale' })),
    ).rejects.toThrow(KbConflictError);
  });

  it('skips re-chunking when only metadata changed', async () => {
    const space = await run(() => svc.createSpace({ name: 'Docs', slug: 'docs' }));
    const doc = await run(() =>
      svc.createDocument({ spaceId: space.id, title: 'T', body: 'Body' }),
    );
    const firstRows = await db.execute<{ id: string }>(
      sql`SELECT id FROM kb_document_chunks WHERE document_id = ${doc.id} ORDER BY chunk_index LIMIT 1`,
    );
    const firstChunkId = firstRows[0]!.id;
    await run(() => svc.updateDocument({ id: doc.id, ifVersion: 1, public: true }));
    const secondRows = await db.execute<{ id: string }>(
      sql`SELECT id FROM kb_document_chunks WHERE document_id = ${doc.id} ORDER BY chunk_index LIMIT 1`,
    );
    expect(secondRows[0]!.id).toBe(firstChunkId);
  });

  it('restores a prior version', async () => {
    const space = await run(() => svc.createSpace({ name: 'Docs', slug: 'docs' }));
    const v1 = await run(() =>
      svc.createDocument({ spaceId: space.id, title: 'Title v1', body: 'Body v1' }),
    );
    await run(() => svc.updateDocument({ id: v1.id, ifVersion: 1, body: 'Body v2' }));
    const restored = await run(() =>
      svc.restoreVersion({ documentId: v1.id, version: 1, ifVersion: 2 }),
    );
    expect(restored.version).toBe(3);
    expect(restored.body).toBe('Body v1');
  });

  it('createDocument throws QuotaExceededError at the org cap and writes no row', async () => {
    // Tighten the cap for this test only.
    await db
      .update(schema.orgs)
      .set({ settings: { quotas: { kb_documents: 1 } } })
      .where(sql`id = ${orgId}`);
    try {
      const space = await run(() => svc.createSpace({ name: 'Q', slug: 'q' }));
      await run(() => svc.createDocument({ spaceId: space.id, title: 'first', body: 'one' }));
      await expect(
        run(() => svc.createDocument({ spaceId: space.id, title: 'second', body: 'two' })),
      ).rejects.toThrow(QuotaExceededError);
      const rows = await db.execute<{ count: number }>(
        sql`SELECT COUNT(*)::int AS count FROM kb_documents WHERE org_id = ${orgId}`,
      );
      expect(rows[0]!.count).toBe(1);
    } finally {
      await db.update(schema.orgs).set({ settings: {} }).where(sql`id = ${orgId}`);
    }
  });

  it('deletes with concurrency check', async () => {
    const space = await run(() => svc.createSpace({ name: 'Docs', slug: 'docs' }));
    const doc = await run(() =>
      svc.createDocument({ spaceId: space.id, title: 'T', body: 'Body' }),
    );
    await expect(
      run(() => svc.deleteDocument({ id: doc.id, ifVersion: 99 })),
    ).rejects.toThrow(KbConflictError);
    await run(() => svc.deleteDocument({ id: doc.id, ifVersion: 1 }));
    await expect(run(() => svc.getDocument(doc.id))).rejects.toThrow(KbNotFoundError);
  });
});
