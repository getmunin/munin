import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { ActorIdentity, withContext, type RequestContext } from '@getmunin/core';
import { createDb, runMigrations, schema } from '@getmunin/db';
import { sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { SuggestionsService, SuggestionsNotFoundError } from './suggestions.service.js';

const TEST_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const skipReason = TEST_URL
  ? null
  : 'Set DATABASE_URL or TEST_DATABASE_URL to a Postgres URL to run suggestions tests.';

(skipReason ? describe.skip : describe)('SuggestionsService', () => {
  let db: ReturnType<typeof createDb>;
  let appDb: ReturnType<typeof createDb>;
  let svc: SuggestionsService;
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
      .values({ name: 'Suggestions Test Org', slug: `sug-${ts}` })
      .returning();
    orgId = org!.id;
    actor = new ActorIdentity('admin_agent', 'agt_test', orgId, ['*'], ['admin']);
    svc = new SuggestionsService();
  });

  afterAll(async () => {
    if (db) {
      await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
      await db.delete(schema.orgs).where(sql`id = ${orgId}`);
    }
  });

  beforeEach(async () => {
    await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
    await db.execute(sql`DELETE FROM suggestions WHERE org_id = ${orgId}`);
  });

  function runAs<T>(asActor: ActorIdentity, fn: () => Promise<T>): Promise<T> {
    return appDb.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.bypass_rls', 'off', true)`);
      await tx.execute(sql`SELECT set_config('app.org_id', ${orgId}, true)`);
      const ctx: RequestContext = {
        db: tx,
        actor: asActor,
        correlationId: randomUUID(),
      };
      return withContext(ctx, fn);
    });
  }
  function run<T>(fn: () => Promise<T>): Promise<T> {
    return runAs(actor, fn);
  }

  it('creates a suggestion with author auto-vote', async () => {
    const sug = await run(() =>
      svc.create({ title: 'Add dark mode', body: 'Many users want a dark theme.' }),
    );
    expect(sug.voteCount).toBe(1);
    expect(sug.status).toBe('open');
  });

  it('search ranks by votes when matches exist', async () => {
    const a = await run(() =>
      svc.create({ title: 'Bulk import contacts', body: 'CSV import for CRM contacts.' }),
    );
    await run(() =>
      svc.create({ title: 'Import bug fix', body: 'Fix duplicate detection on import.' }),
    );
    // A different actor votes on `a` so its count exceeds the auto-vote default.
    const otherActor = new ActorIdentity('admin_agent', 'agt_other', orgId, ['*'], ['admin']);
    await runAs(otherActor, () => svc.vote({ id: a.id, comment: 'critical for our migration' }));

    const hits = await run(() => svc.search({ query: 'import' }));
    expect(hits.length).toBeGreaterThanOrEqual(2);
    expect(hits[0]!.id).toBe(a.id);
  });

  it('vote is idempotent for the same actor', async () => {
    const sug = await run(() => svc.create({ title: 'Faster search', body: 'Lower latency.' }));
    expect(sug.voteCount).toBe(1);
    const after = await run(() => svc.vote({ id: sug.id }));
    expect(after.voteCount).toBe(1);
  });

  it('list filters by status and appScope', async () => {
    const a = await run(() =>
      svc.create({ title: 'KB idea', body: 'Body body body.', appScope: 'kb' }),
    );
    await run(() =>
      svc.create({ title: 'CRM idea', body: 'Body body body.', appScope: 'crm' }),
    );
    const kbOnly = await run(() => svc.list({ appScope: 'kb' }));
    expect(kbOnly).toHaveLength(1);
    expect(kbOnly[0]!.id).toBe(a.id);
  });

  it('throws on unknown id', async () => {
    await expect(run(() => svc.get('sug_does_not_exist'))).rejects.toThrow(SuggestionsNotFoundError);
  });
});
