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
  let memberOne: string;
  let memberTwo: string;
  const service = new AlertsService(new WebhookDispatcher());

  async function asActor(orgId: string, fn: () => Promise<void>): Promise<void> {
    const actor = new ActorIdentity('system', 'test', orgId, ['*'], ['admin']);
    await runAs(orgId, actor, fn);
  }

  async function asMember(
    orgId: string,
    userId: string | undefined,
    fn: () => Promise<void>,
  ): Promise<void> {
    const actor = new ActorIdentity(
      'user',
      userId ?? 'akey_no_member',
      orgId,
      ['*'],
      ['admin'],
      undefined,
      undefined,
      undefined,
      userId,
    );
    await runAs(orgId, actor, fn);
  }

  async function runAs(
    orgId: string,
    actor: ActorIdentity,
    fn: () => Promise<void>,
  ): Promise<void> {
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

    const [u1, u2] = await svcDb
      .insert(schema.users)
      .values([
        { name: 'Ola Nordmann', email: `ola-${randomUUID()}@example.test` },
        { name: 'Kari Nordmann', email: `kari-${randomUUID()}@example.test` },
      ])
      .returning();
    memberOne = u1!.id;
    memberTwo = u2!.id;
  });

  afterAll(async () => {
    if (svcDb) {
      await svcDb.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
      await svcDb.delete(schema.orgs).where(sql`id IN (${orgA}, ${orgB})`);
      await svcDb.delete(schema.users).where(sql`id IN (${memberOne}, ${memberTwo})`);
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

  it('keeps two members\' alerts apart when source and subject are identical', async () => {
    await asMember(orgA, memberOne, async () => {
      await service.openAlert({
        source: 'social',
        subjectId: 'linkedin',
        userId: memberOne,
        severity: 'warning',
        title: 'one expired',
      });
    });
    await asMember(orgA, memberTwo, async () => {
      const second = await service.openAlert({
        source: 'social',
        subjectId: 'linkedin',
        userId: memberTwo,
        severity: 'warning',
        title: 'two expired',
      });
      expect(second.opened).toBe(true);
      expect(second.occurrenceCount).toBe(1);
    });

    const rows = await svcDb.select().from(schema.orgAlerts);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.occurrenceCount === 1)).toBe(true);
  });

  it('still bumps rather than duplicates when the same member re-opens', async () => {
    await asMember(orgA, memberOne, async () => {
      await service.openAlert({
        source: 'social',
        subjectId: 'linkedin',
        userId: memberOne,
        severity: 'warning',
        title: 'first',
      });
      const again = await service.openAlert({
        source: 'social',
        subjectId: 'linkedin',
        userId: memberOne,
        severity: 'warning',
        title: 'second',
      });
      expect(again.opened).toBe(false);
      expect(again.occurrenceCount).toBe(2);
    });
    expect(await svcDb.select().from(schema.orgAlerts)).toHaveLength(1);
  });

  it('shows a member org-scoped alerts plus their own, never another member\'s', async () => {
    await asActor(orgA, async () => {
      await service.openAlert({
        source: 'llm_provider',
        subjectId: 'shared',
        severity: 'error',
        title: 'org wide',
      });
    });
    await asMember(orgA, memberTwo, async () => {
      await service.openAlert({
        source: 'social',
        subjectId: 'linkedin',
        userId: memberTwo,
        severity: 'warning',
        title: 'belongs to two',
      });
    });

    await asMember(orgA, memberOne, async () => {
      expect((await service.listOpen()).map((a) => a.title)).toEqual(['org wide']);
      expect((await service.list()).map((a) => a.title)).toEqual(['org wide']);
    });
    await asMember(orgA, memberTwo, async () => {
      expect((await service.listOpen()).map((a) => a.title).sort()).toEqual([
        'belongs to two',
        'org wide',
      ]);
    });
  });

  it('shows a caller with no member identity only org-scoped alerts', async () => {
    await asActor(orgA, async () => {
      await service.openAlert({
        source: 'llm_provider',
        subjectId: 'shared',
        severity: 'error',
        title: 'org wide',
      });
    });
    await asMember(orgA, memberOne, async () => {
      await service.openAlert({
        source: 'social',
        subjectId: 'linkedin',
        userId: memberOne,
        severity: 'warning',
        title: 'personal',
      });
    });

    await asMember(orgA, undefined, async () => {
      expect((await service.listOpen()).map((a) => a.title)).toEqual(['org wide']);
    });
  });

  it('refuses to read or acknowledge another member\'s alert by id', async () => {
    let otherId = '';
    await asMember(orgA, memberTwo, async () => {
      otherId = (
        await service.openAlert({
          source: 'social',
          subjectId: 'linkedin',
          userId: memberTwo,
          severity: 'warning',
          title: 'belongs to two',
        })
      ).alertId;
    });

    await asMember(orgA, memberOne, async () => {
      await expect(service.get(otherId)).rejects.toThrow(/alert_not_found/);
      await expect(service.acknowledgeAlert(otherId)).rejects.toThrow(/alert_not_found/);
    });
    await asMember(orgA, memberTwo, async () => {
      expect((await service.get(otherId)).userId).toBe(memberTwo);
    });
  });

  it('resolves only the addressed member\'s row', async () => {
    await asMember(orgA, memberOne, async () => {
      await service.openAlert({
        source: 'social',
        subjectId: 'linkedin',
        userId: memberOne,
        severity: 'warning',
        title: 'one',
      });
    });
    await asMember(orgA, memberTwo, async () => {
      await service.openAlert({
        source: 'social',
        subjectId: 'linkedin',
        userId: memberTwo,
        severity: 'warning',
        title: 'two',
      });
      await service.resolveAlert({ source: 'social', subjectId: 'linkedin', userId: memberTwo });
    });

    const rows = await svcDb.select().from(schema.orgAlerts);
    const open = rows.filter((r) => r.resolvedAt === null);
    expect(open).toHaveLength(1);
    expect(open[0]!.userId).toBe(memberOne);
  });

  it('leaves an org-scoped resolve untouched by user-scoped rows', async () => {
    await asMember(orgA, memberOne, async () => {
      await service.openAlert({
        source: 'social',
        subjectId: 'linkedin',
        userId: memberOne,
        severity: 'warning',
        title: 'personal',
      });
    });
    await asActor(orgA, async () => {
      await service.openAlert({
        source: 'social',
        subjectId: 'linkedin',
        severity: 'warning',
        title: 'org wide',
      });
      const result = await service.resolveAlert({ source: 'social', subjectId: 'linkedin' });
      expect(result.resolved).toBe(true);
    });

    const open = (await svcDb.select().from(schema.orgAlerts)).filter((r) => r.resolvedAt === null);
    expect(open).toHaveLength(1);
    expect(open[0]!.userId).toBe(memberOne);
  });
});
