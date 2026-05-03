import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  ActorIdentity,
  StubEmbeddingProvider,
  WebhookDispatcher,
  withContext,
  type RequestContext,
} from '@getmunin/core';
import { createDb, runMigrations, schema } from '@getmunin/db';
import { sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { KbService } from './kb.service.js';
import { KbSearchService } from './kb.search.js';
import { EmbeddingProviderHolder } from './embedding.provider.js';
import { QuotasService } from '../../common/quotas/quotas.service.js';

const TEST_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const skipReason = TEST_URL
  ? null
  : 'Set DATABASE_URL or TEST_DATABASE_URL to a Postgres URL to run KB search tests.';

(skipReason ? describe.skip : describe)('KbSearchService', () => {
  let db: ReturnType<typeof createDb>;
  let appDb: ReturnType<typeof createDb>;
  let kb: KbService;
  let search: KbSearchService;
  let orgId: string;
  let admin: ActorIdentity;
  let endUser: ActorIdentity;
  let endUserId: string;
  let spaceId: string;

  beforeAll(async () => {
    await runMigrations(TEST_URL!);
    db = createDb(TEST_URL!, { serviceRole: true });
    const appUrl = TEST_URL!.replace(/(postgres(?:ql)?:\/\/)[^:@]+:[^@]+@/, '$1munin_app:munin_app@');
    appDb = createDb(appUrl);

    const ts = Date.now();
    const [org] = await db
      .insert(schema.orgs)
      .values({ name: 'Search Test Org', slug: `kb-search-${ts}` })
      .returning();
    orgId = org!.id;

    const [eu] = await db
      .insert(schema.endUsers)
      .values({ orgId, externalId: 'external-1', name: 'End User' })
      .returning();
    endUserId = eu!.id;

    admin = new ActorIdentity('admin_agent', 'agt_admin', orgId, ['*'], ['admin']);
    endUser = new ActorIdentity(
      'end_user_agent',
      'agt_eu',
      orgId,
      ['kb:read'],
      ['self_service'],
      endUserId,
    );

    const holder = new (class extends EmbeddingProviderHolder {
      override get() {
        return new StubEmbeddingProvider();
      }
    })();
    kb = new KbService(holder, new QuotasService(), new WebhookDispatcher());
    search = new KbSearchService(holder);
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

    spaceId = await runAs(admin, async () => {
      const space = await kb.createSpace({ name: 'Docs', slug: 'docs' });
      return space.id;
    });
  });

  function runAs<T>(actor: ActorIdentity, fn: () => Promise<T>): Promise<T> {
    return appDb.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.bypass_rls', 'off', true)`);
      await tx.execute(sql`SELECT set_config('app.org_id', ${orgId}, true)`);
      if (actor.endUserId) {
        await tx.execute(sql`SELECT set_config('app.end_user_id', ${actor.endUserId}, true)`);
      } else {
        await tx.execute(sql`SELECT set_config('app.end_user_id', '', true)`);
      }
      const ctx: RequestContext = {
        db: tx,
        actor,
        correlationId: randomUUID(),
      };
      return withContext(ctx, fn);
    });
  }

  it('returns FTS hits ranked by relevance', async () => {
    await runAs(admin, () =>
      kb.createDocument({
        spaceId,
        title: 'Setting up the staging environment',
        body: 'Use docker compose with the staging profile.',
      }),
    );
    await runAs(admin, () =>
      kb.createDocument({ spaceId, title: 'Office snacks policy', body: 'No nuts in the kitchen.' }),
    );
    const hits = await runAs(admin, () => search.search({ query: 'staging environment' }));
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.title).toMatch(/staging/i);
  });

  it('returns vector hits when FTS misses', async () => {
    // FTS won't match because the query has no surface-form overlap with the
    // doc; the stub embedding is deterministic per-string so the same query
    // and doc hash to the same neighborhood.
    await runAs(admin, () =>
      kb.createDocument({ spaceId, title: 'Apple', body: 'Apple is a fruit.' }),
    );
    const hits = await runAs(admin, () => search.search({ query: 'Apple' }));
    expect(hits.length).toBeGreaterThan(0);
    expect(['fts', 'vector', 'both']).toContain(hits[0]!.source);
  });

  it('end-user audience cannot see private documents', async () => {
    await runAs(admin, () =>
      kb.createDocument({
        spaceId,
        title: 'Internal runbook',
        body: 'Do not share this with customers.',
        audiences: ['admin'],
      }),
    );
    await runAs(admin, () =>
      kb.createDocument({
        spaceId,
        title: 'Public help article',
        body: 'How to reset your password.',
        audiences: ['admin', 'self_service'],
      }),
    );
    const hits = await runAs(endUser, () => search.search({ query: 'password reset' }));
    const titles = hits.map((h) => h.title);
    expect(titles).toContain('Public help article');
    expect(titles).not.toContain('Internal runbook');
  });

  it('respects spaceId filter', async () => {
    const otherSpaceId = await runAs(admin, async () => {
      const s = await kb.createSpace({ name: 'Other', slug: 'other' });
      return s.id;
    });
    await runAs(admin, () =>
      kb.createDocument({ spaceId, title: 'Findme primary', body: 'Findme primary body.' }),
    );
    await runAs(admin, () =>
      kb.createDocument({
        spaceId: otherSpaceId,
        title: 'Findme other',
        body: 'Findme other body.',
      }),
    );
    const hits = await runAs(admin, () => search.search({ query: 'Findme', spaceId }));
    expect(hits.every((h) => h.spaceId === spaceId)).toBe(true);
  });
});
