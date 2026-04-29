import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { ActorIdentity, withContext, type RequestContext } from '@getmunin/core';
import { createDb, runMigrations, schema } from '@getmunin/db';
import { sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { kbBootstrap } from './kb.bootstrap.js';

const TEST_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const skipReason = TEST_URL
  ? null
  : 'Set DATABASE_URL or TEST_DATABASE_URL to a Postgres URL to run KB bootstrap tests.';

(skipReason ? describe.skip : describe)('kbBootstrap', () => {
  let db: ReturnType<typeof createDb>;
  let appDb: ReturnType<typeof createDb>;
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
      .values({ name: 'Bootstrap Test Org', slug: `kb-boot-${ts}` })
      .returning();
    orgId = org!.id;
    actor = new ActorIdentity('admin_agent', 'agt_test', orgId, ['*'], ['admin']);
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
    await db.execute(sql`DELETE FROM bootstrap_state WHERE org_id = ${orgId}`);
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

  it('first call asks for first_space', async () => {
    const status = await run(() => kbBootstrap.status());
    expect(status.completed).toBe(false);
    expect(status.nextStepId).toBe('first_space');
    expect(status.nextPrompt).toMatch(/space/i);
    expect(status.totalSteps).toBe(2);
  });

  it('answering first_space creates the space and advances to welcome_doc', async () => {
    const next = await run(() =>
      kbBootstrap.answer('first_space', { name: 'Engineering', slug: 'engineering' }),
    );
    expect(next.nextStepId).toBe('welcome_doc');
    expect(next.completedSteps).toContain('first_space');

    const spaceCount = await db.execute<{ n: number }>(
      sql`SELECT COUNT(*)::int AS n FROM kb_spaces WHERE org_id = ${orgId}`,
    );
    expect(spaceCount[0]!.n).toBe(1);
  });

  it('skipping welcome_doc does not seed a starter document', async () => {
    await run(() =>
      kbBootstrap.answer('first_space', { name: 'Engineering', slug: 'engineering' }),
    );
    const final = await run(() => kbBootstrap.answer('welcome_doc', { create: false }));
    expect(final.completed).toBe(true);
    const docCount = await db.execute<{ n: number }>(
      sql`SELECT COUNT(*)::int AS n FROM kb_documents WHERE org_id = ${orgId}`,
    );
    expect(docCount[0]!.n).toBe(0);
  });

  it('accepting welcome_doc seeds a "How we work" doc in the first space', async () => {
    await run(() =>
      kbBootstrap.answer('first_space', { name: 'Engineering', slug: 'engineering' }),
    );
    await run(() => kbBootstrap.answer('welcome_doc', { create: true }));
    const docs = await db.execute<{ title: string }>(
      sql`SELECT title FROM kb_documents WHERE org_id = ${orgId}`,
    );
    expect(docs.map((d) => d.title)).toContain('How we work');
  });

  it('skips first_space if a space already exists', async () => {
    await db.insert(schema.kbSpaces).values({ orgId, name: 'Pre', slug: 'pre' });
    const status = await run(() => kbBootstrap.status());
    expect(status.nextStepId).toBe('welcome_doc');
    expect(status.completedSteps).toContain('first_space');
  });
});
