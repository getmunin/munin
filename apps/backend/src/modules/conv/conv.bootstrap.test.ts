import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { ActorIdentity, withContext, type RequestContext } from '@munin/core';
import { createDb, runMigrations, schema } from '@munin/db';
import { sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { convBootstrap } from './conv.bootstrap.js';

const TEST_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const skipReason = TEST_URL
  ? null
  : 'Set DATABASE_URL or TEST_DATABASE_URL to a Postgres URL to run conv bootstrap tests.';

(skipReason ? describe.skip : describe)('convBootstrap', () => {
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
      .values({ name: 'Conv Boot Org', slug: `conv-boot-${ts}` })
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
    await db.execute(sql`DELETE FROM conv_channels WHERE org_id = ${orgId}`);
    await db.execute(sql`DELETE FROM conv_topics WHERE org_id = ${orgId}`);
    await db.execute(sql`DELETE FROM bootstrap_state WHERE org_id = ${orgId} AND app_key = 'conv'`);
  });

  function run<T>(fn: () => Promise<T>): Promise<T> {
    return appDb.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.bypass_rls', 'off', true)`);
      await tx.execute(sql`SELECT set_config('app.org_id', ${orgId}, true)`);
      const ctx: RequestContext = {
        db: tx as unknown as typeof appDb,
        actor,
        correlationId: randomUUID(),
      };
      return withContext(ctx, fn);
    });
  }

  it('first call asks for first_channel; answering creates the channel', async () => {
    const status = await run(() => convBootstrap.status());
    expect(status.completed).toBe(false);
    expect(status.nextStepId).toBe('first_channel');

    const next = await run(() =>
      convBootstrap.answer('first_channel', { type: 'chat', name: 'Web chat' }),
    );
    expect(next.nextStepId).toBe('seed_topics');

    const channels = await db.execute<{ n: number }>(
      sql`SELECT COUNT(*)::int AS n FROM conv_channels WHERE org_id = ${orgId}`,
    );
    expect(channels[0]!.n).toBe(1);
  });

  it('seed_topics defaults to creating Billing/Support/Bug', async () => {
    await run(() =>
      convBootstrap.answer('first_channel', { type: 'chat', name: 'Web chat' }),
    );
    const final = await run(() => convBootstrap.answer('seed_topics', { seed: true }));
    expect(final.completed).toBe(true);
    const topics = await db.execute<{ slug: string }>(
      sql`SELECT slug FROM conv_topics WHERE org_id = ${orgId} ORDER BY slug`,
    );
    const slugs = topics.map((t) => t.slug);
    expect(slugs).toEqual(['billing', 'bug', 'support']);
  });

  it('skips first_channel when one already exists', async () => {
    await db
      .insert(schema.convChannels)
      .values({ orgId, type: 'email', name: 'Pre-existing', active: true });
    const status = await run(() => convBootstrap.status());
    expect(status.nextStepId).toBe('seed_topics');
    expect(status.completedSteps).toContain('first_channel');
  });
});
