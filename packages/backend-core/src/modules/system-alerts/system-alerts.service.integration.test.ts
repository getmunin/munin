import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createDb, runMigrations, schema } from '@getmunin/db';
import { sql } from 'drizzle-orm';
import { ActorIdentity, WebhookDispatcher, withContext, type RequestContext } from '@getmunin/core';
import { randomUUID } from 'node:crypto';
import { AlertsService } from './system-alerts.service.ts';

const TEST_URL = process.env.TEST_DATABASE_URL;
const skipReason = TEST_URL
  ? null
  : 'Set TEST_DATABASE_URL to a Postgres URL to run system-alerts integration tests.';

(skipReason ? describe.skip : describe)('AlertsService', () => {
  let svcDb: ReturnType<typeof createDb>;
  let appDb: ReturnType<typeof createDb>;
  let orgA: string;
  let orgB: string;
  const service = new AlertsService(new WebhookDispatcher());

  async function asActor(orgId: string, fn: () => Promise<void>): Promise<void> {
    const actor = new ActorIdentity('system', 'test', orgId, ['*'], ['admin']);
    await appDb.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.org_id', ${orgId}, true)`);
      await tx.execute(sql`SELECT set_config('app.bypass_rls', 'off', true)`);
      const ctx: RequestContext = { db: tx, actor, correlationId: randomUUID() };
      await withContext(ctx, fn);
    });
  }

  beforeAll(async () => {
    await runMigrations(TEST_URL!);
    svcDb = createDb(TEST_URL!, { serviceRole: true });
    const appUrl = TEST_URL!.replace(
      /(postgres(?:ql)?:\/\/)[^:@]+:[^@]+@/,
      '$1munin_app:munin_app@',
    );
    appDb = createDb(appUrl);

    await svcDb.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
    const [a, b] = await svcDb
      .insert(schema.orgs)
      .values([{ name: 'Alerts IT A' }, { name: 'Alerts IT B' }])
      .returning();
    orgA = a!.id;
    orgB = b!.id;
  });

  afterAll(async () => {
    if (svcDb) {
      await svcDb.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
      await svcDb.delete(schema.orgs).where(sql`id IN (${orgA}, ${orgB})`);
    }
  });

  beforeEach(async () => {
    await svcDb.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
    await svcDb.delete(schema.orgAlerts);
  });

  it('opens a new alert when no open one exists for (org, source, subject)', async () => {
    await asActor(orgA, async () => {
      const result = await service.openAlert({
        source: 'channel_inbound',
        subjectId: 'cch_test_1',
        severity: 'error',
        title: 'Inbound failing',
        detail: 'bad creds',
      });
      expect(result.opened).toBe(true);
      expect(result.alertId.startsWith('alr_')).toBe(true);
    });

    const rows = await svcDb.select().from(schema.orgAlerts);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.orgId).toBe(orgA);
    expect(rows[0]!.occurrenceCount).toBe(1);
  });

  it('bumps the existing open alert when (source, subject) match', async () => {
    let firstId = '';
    await asActor(orgA, async () => {
      firstId = (await service.openAlert({
        source: 'channel_inbound',
        subjectId: 'cch_test_2',
        severity: 'error',
        title: 'first',
      })).alertId;

      const second = await service.openAlert({
        source: 'channel_inbound',
        subjectId: 'cch_test_2',
        severity: 'error',
        title: 'second',
        detail: 'updated detail',
      });
      expect(second.opened).toBe(false);
      expect(second.alertId).toBe(firstId);
    });

    const rows = await svcDb.select().from(schema.orgAlerts);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.occurrenceCount).toBe(2);
    expect(rows[0]!.title).toBe('second');
    expect(rows[0]!.detail).toBe('updated detail');
  });

  it('resolveAlert sets resolved_at on the open row', async () => {
    await asActor(orgA, async () => {
      await service.openAlert({
        source: 'llm_provider',
        subjectId: 'singleton',
        severity: 'error',
        title: 'auth',
      });
      const result = await service.resolveAlert({ source: 'llm_provider', subjectId: 'singleton' });
      expect(result.resolved).toBe(true);
    });

    const rows = await svcDb.select().from(schema.orgAlerts);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.resolvedAt).not.toBeNull();
  });

  it('occurrenceCount reflects the bumped value', async () => {
    await asActor(orgA, async () => {
      const first = await service.openAlert({
        source: 'channel_inbound',
        subjectId: 'cch_count',
        severity: 'error',
        title: 'first',
      });
      expect(first.occurrenceCount).toBe(1);

      const second = await service.openAlert({
        source: 'channel_inbound',
        subjectId: 'cch_count',
        severity: 'error',
        title: 'second',
      });
      expect(second.occurrenceCount).toBe(2);

      const third = await service.openAlert({
        source: 'channel_inbound',
        subjectId: 'cch_count',
        severity: 'error',
        title: 'third',
      });
      expect(third.occurrenceCount).toBe(3);
    });
  });

  it('opens a fresh row when re-opening after resolve', async () => {
    await asActor(orgA, async () => {
      await service.openAlert({
        source: 'channel_inbound',
        subjectId: 'cch_test_3',
        severity: 'error',
        title: 'one',
      });
      await service.resolveAlert({ source: 'channel_inbound', subjectId: 'cch_test_3' });
      const reopened = await service.openAlert({
        source: 'channel_inbound',
        subjectId: 'cch_test_3',
        severity: 'error',
        title: 'two',
      });
      expect(reopened.opened).toBe(true);
    });

    const rows = await svcDb.select().from(schema.orgAlerts);
    expect(rows).toHaveLength(2);
  });

  it('RLS isolates orgs: A cannot see B alerts', async () => {
    await asActor(orgA, async () => {
      await service.openAlert({
        source: 'channel_inbound',
        subjectId: 'cch_a',
        severity: 'error',
        title: 'A alert',
      });
    });
    await asActor(orgB, async () => {
      await service.openAlert({
        source: 'channel_inbound',
        subjectId: 'cch_b',
        severity: 'error',
        title: 'B alert',
      });

      const aOnly = await service.listOpen();
      expect(aOnly.map((a) => a.title)).toEqual(['B alert']);
    });

    await asActor(orgA, async () => {
      const aOnly = await service.listOpen();
      expect(aOnly.map((a) => a.title)).toEqual(['A alert']);
    });
  });
});
