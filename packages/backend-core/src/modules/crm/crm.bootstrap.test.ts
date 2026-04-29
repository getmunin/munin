import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { ActorIdentity, withContext, type RequestContext } from '@munin/core';
import { createDb, runMigrations, schema } from '@munin/db';
import { sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { crmBootstrap } from './crm.bootstrap.js';

const TEST_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const skipReason = TEST_URL
  ? null
  : 'Set DATABASE_URL or TEST_DATABASE_URL to a Postgres URL to run CRM bootstrap tests.';

(skipReason ? describe.skip : describe)('crmBootstrap', () => {
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
      .values({ name: 'CRM Boot Org', slug: `crm-boot-${ts}` })
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
    await db.execute(sql`DELETE FROM crm_pipelines WHERE org_id = ${orgId}`);
    await db.execute(sql`DELETE FROM bootstrap_state WHERE org_id = ${orgId} AND app_key = 'crm'`);
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

  it('default answer creates a Sales pipeline with Lead → Won → Lost', async () => {
    const status = await run(() => crmBootstrap.status());
    expect(status.nextStepId).toBe('first_pipeline');
    const final = await run(() => crmBootstrap.answer('first_pipeline', {}));
    expect(final.completed).toBe(true);

    const stages = await db.execute<{ name: string; win_loss: string; position: number }>(
      sql`SELECT name, win_loss, position FROM crm_stages WHERE org_id = ${orgId} ORDER BY position`,
    );
    const stageNames = stages.map((s) => s.name);
    expect(stageNames).toEqual(['Lead', 'Qualified', 'Proposal', 'Won', 'Lost']);
    expect(stages.find((s) => s.name === 'Won')!.win_loss).toBe('won');
    expect(stages.find((s) => s.name === 'Lost')!.win_loss).toBe('lost');
  });

  it('skips first_pipeline when one already exists', async () => {
    const [pipeline] = await db
      .insert(schema.crmPipelines)
      .values({ orgId, name: 'Pre', slug: 'pre' })
      .returning();
    await db
      .insert(schema.crmStages)
      .values({ orgId, pipelineId: pipeline!.id, name: 'Only', position: 0 });
    const status = await run(() => crmBootstrap.status());
    expect(status.completed).toBe(true);
    expect(status.completedSteps).toContain('first_pipeline');
  });
});
