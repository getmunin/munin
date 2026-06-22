import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { ActorIdentity, withContext, type RequestContext } from '@getmunin/core';
import { createDb, runMigrations, schema } from '@getmunin/db';
import { sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { RateLimitExceededError, RateLimitService } from './rate-limit.service.ts';

const TEST_URL = process.env.TEST_DATABASE_URL;
const skipReason = TEST_URL
  ? null
  : 'Set TEST_DATABASE_URL to a Postgres URL to run rate-limit tests.';

(skipReason ? describe.skip : describe)('RateLimitService', () => {
  let db: ReturnType<typeof createDb>;
  let appDb: ReturnType<typeof createDb>;
  let svc: RateLimitService;
  let orgId: string;
  let actor: ActorIdentity;

  beforeAll(async () => {
    await runMigrations(TEST_URL!);
    db = createDb(TEST_URL!, { serviceRole: true });
    const appUrl = TEST_URL!.replace(/(postgres(?:ql)?:\/\/)[^:@]+:[^@]+@/, '$1munin_app:munin_app@');
    appDb = createDb(appUrl);

    const [org] = await db
      .insert(schema.orgs)
      .values({
        name: 'Rate Test Org',
        settings: { rateLimits: { perDay: 5 } },
      })
      .returning();
    orgId = org!.id;
    actor = new ActorIdentity('admin_agent', 'agt_test', orgId, ['*'], ['admin']);
    svc = new RateLimitService();
  });

  afterAll(async () => {
    if (db) {
      await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
      await db.delete(schema.orgs).where(sql`id = ${orgId}`);
    }
  });

  beforeEach(async () => {
    await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
    await db.execute(sql`DELETE FROM rate_limit_counters WHERE org_id = ${orgId}`);
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

  it('allows calls under the per-day cap', async () => {
    for (let i = 0; i < 5; i++) {
      await run(() => svc.consume());
    }
    const u = await run(() => svc.usage());
    expect(u.day.used).toBe(5);
    expect(u.day.limit).toBe(5);
  });

  it('throws RateLimitExceededError on the 6th call within the same day', async () => {
    for (let i = 0; i < 5; i++) {
      await run(() => svc.consume());
    }
    await expect(run(() => svc.consume())).rejects.toThrow(RateLimitExceededError);
  });

  it('uses free-tier defaults when org settings have no rateLimits', async () => {
    const [defaultOrg] = await db
      .insert(schema.orgs)
      .values({ name: 'Default Org' })
      .returning();
    const defaultActor = new ActorIdentity(
      'admin_agent',
      'agt_default',
      defaultOrg!.id,
      ['*'],
      ['admin'],
    );
    try {
      const u = await appDb.transaction(async (tx) => {
        await tx.execute(sql`SELECT set_config('app.bypass_rls', 'off', true)`);
        await tx.execute(sql`SELECT set_config('app.org_id', ${defaultOrg!.id}, true)`);
        const ctx: RequestContext = {
          db: tx,
          actor: defaultActor,
          correlationId: randomUUID(),
        };
        return withContext(ctx, () => svc.usage());
      });
      expect(u.day.limit).toBe(1000);
    } finally {
      await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
      await db.delete(schema.orgs).where(sql`id = ${defaultOrg!.id}`);
    }
  });

  it('record returns the post-bump count and never throws on limit', async () => {
    const c1 = await run(() => svc.record('mcp_calls_day'));
    const c2 = await run(() => svc.record('mcp_calls_day'));
    expect(c1).toBe(1);
    expect(c2).toBe(2);

    for (let i = 0; i < 100; i++) await run(() => svc.record('mcp_calls_day'));
    const u = await run(() => svc.usage());
    expect(u.day.used).toBe(102);
  });

  it('record increments by an explicit amount', async () => {
    const c1 = await run(() => svc.record('ai_tokens_month', 500));
    const c2 = await run(() => svc.record('ai_tokens_month', 250));
    expect(c1).toBe(500);
    expect(c2).toBe(750);
  });

  it('different orgs have isolated counters', async () => {
    const [otherOrg] = await db
      .insert(schema.orgs)
      .values({
        name: 'Other Rate Org',
        settings: { rateLimits: { perDay: 5 } },
      })
      .returning();
    const otherActor = new ActorIdentity('admin_agent', 'agt_o', otherOrg!.id, ['*'], ['admin']);
    try {
      for (let i = 0; i < 5; i++) await run(() => svc.consume());
      const otherUsage = await appDb.transaction(async (tx) => {
        await tx.execute(sql`SELECT set_config('app.bypass_rls', 'off', true)`);
        await tx.execute(sql`SELECT set_config('app.org_id', ${otherOrg!.id}, true)`);
        const ctx: RequestContext = {
          db: tx,
          actor: otherActor,
          correlationId: randomUUID(),
        };
        return withContext(ctx, async () => {
          await svc.consume();
          return svc.usage();
        });
      });
      expect(otherUsage.day.used).toBe(1);
    } finally {
      await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
      await db.delete(schema.orgs).where(sql`id = ${otherOrg!.id}`);
    }
  });
});
