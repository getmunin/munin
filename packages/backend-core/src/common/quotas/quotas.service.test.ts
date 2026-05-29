import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { ActorIdentity, withContext, type RequestContext } from '@getmunin/core';
import { createDb, runMigrations, schema } from '@getmunin/db';
import { sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { QuotaExceededError, QuotasService } from './quotas.service.ts';

const TEST_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const skipReason = TEST_URL
  ? null
  : 'Set DATABASE_URL or TEST_DATABASE_URL to a Postgres URL to run quotas tests.';

(skipReason ? describe.skip : describe)('QuotasService', () => {
  let db: ReturnType<typeof createDb>;
  let appDb: ReturnType<typeof createDb>;
  let svc: QuotasService;
  let orgId: string;
  let actor: ActorIdentity;

  beforeAll(async () => {
    process.env.MUNIN_QUOTAS_ENABLED = 'true';
    await runMigrations(TEST_URL!);
    db = createDb(TEST_URL!, { serviceRole: true });
    const appUrl = TEST_URL!.replace(/(postgres(?:ql)?:\/\/)[^:@]+:[^@]+@/, '$1munin_app:munin_app@');
    appDb = createDb(appUrl);

    const ts = Date.now();
    const [org] = await db
      .insert(schema.orgs)
      .values({
        name: 'Quota Test Org',
        // Tight cap to make the test fast.
        settings: { quotas: { kb_spaces: 2 } },
      })
      .returning();
    orgId = org!.id;
    actor = new ActorIdentity('admin_agent', 'agt_q', orgId, ['*'], ['admin']);
    svc = new QuotasService();
  });

  afterAll(async () => {
    if (db) {
      await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
      await db.delete(schema.orgs).where(sql`id = ${orgId}`);
    }
  });

  beforeEach(async () => {
    await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
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

  it('passes when under cap', async () => {
    await expect(run(() => svc.assertCanAdd('kb_spaces'))).resolves.toBeUndefined();
  });

  it('throws QuotaExceededError when at cap', async () => {
    await db.insert(schema.kbSpaces).values([
      { orgId, name: 'A', slug: 'a' },
      { orgId, name: 'B', slug: 'b' },
    ]);
    await expect(run(() => svc.assertCanAdd('kb_spaces'))).rejects.toThrow(QuotaExceededError);
  });

  it('falls back to free-tier defaults when settings.quotas is absent', async () => {
    const ts = Date.now();
    const [defaultOrg] = await db
      .insert(schema.orgs)
      .values({ name: 'Default Org' })
      .returning();
    const defaultActor = new ActorIdentity(
      'admin_agent',
      'agt_d',
      defaultOrg!.id,
      ['*'],
      ['admin'],
    );
    try {
      const cap = await appDb.transaction(async (tx) => {
        await tx.execute(sql`SELECT set_config('app.bypass_rls', 'off', true)`);
        await tx.execute(sql`SELECT set_config('app.org_id', ${defaultOrg!.id}, true)`);
        const ctx: RequestContext = {
          db: tx,
          actor: defaultActor,
          correlationId: randomUUID(),
        };
        return withContext(ctx, () => svc.cap(defaultOrg!.id, 'kb_documents'));
      });
      expect(cap).toBe(10_000);
    } finally {
      await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
      await db.delete(schema.orgs).where(sql`id = ${defaultOrg!.id}`);
    }
  });
});
