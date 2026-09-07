import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { ActorIdentity, withContext, type RequestContext } from '@getmunin/core';
import { createDb, runMigrations, schema } from '@getmunin/db';
import { sql } from 'drizzle-orm';
import { RosterController } from './roster.controller.ts';

const TEST_URL = process.env.TEST_DATABASE_URL;
const skipReason = TEST_URL
  ? null
  : 'Set TEST_DATABASE_URL to a Postgres URL to run roster controller tests.';

(skipReason ? describe.skip : describe)('RosterController', () => {
  let db: ReturnType<typeof createDb>;
  let appDb: ReturnType<typeof createDb>;
  let orgId: string;
  let adminUserId: string;
  let memberUserId: string;
  const controller = new RosterController();

  beforeAll(async () => {
    await runMigrations(TEST_URL!);
    db = createDb(TEST_URL!, { serviceRole: true });
    const appUrl = TEST_URL!.replace(/(postgres(?:ql)?:\/\/)[^:@]+:[^@]+@/, '$1munin_app:munin_app@');
    appDb = createDb(appUrl);

    const ts = Date.now();
    const [org] = await db.insert(schema.orgs).values({ name: 'Roster Test Org' }).returning();
    orgId = org!.id;
    const [admin] = await db
      .insert(schema.users)
      .values({ email: `roster-admin-${ts}@example.com`, name: 'Roster Admin' })
      .returning();
    adminUserId = admin!.id;
    const [member] = await db
      .insert(schema.users)
      .values({ email: `roster-member-${ts}@example.com`, name: 'Roster Member' })
      .returning();
    memberUserId = member!.id;
    await db.insert(schema.orgMembers).values({ orgId, userId: adminUserId, role: 'admin' });
    await db.insert(schema.orgMembers).values({ orgId, userId: memberUserId, role: 'member' });
    await db.insert(schema.claims).values({
      orgId,
      entityType: 'conversation',
      entityId: 'cnv_roster_test',
      userId: memberUserId,
      expiresAt: new Date(Date.now() + 60_000),
    });
    await db.insert(schema.claims).values({
      orgId,
      entityType: 'conversation',
      entityId: 'cnv_roster_expired',
      userId: memberUserId,
      expiresAt: new Date(Date.now() - 60_000),
    });
  });

  afterAll(async () => {
    if (db) {
      await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
      await db.delete(schema.orgs).where(sql`id = ${orgId}`);
    }
  });

  function runAs<T>(actor: ActorIdentity, fn: () => Promise<T>): Promise<T> {
    return appDb.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.bypass_rls', 'off', true)`);
      await tx.execute(sql`SELECT set_config('app.org_id', ${actor.orgId}, true)`);
      const ctx: RequestContext = { db: tx, actor, correlationId: randomUUID() };
      return withContext(ctx, fn);
    });
  }

  it('a plain member can read the roster and sees active claim counts', async () => {
    const actor = new ActorIdentity(
      'user',
      memberUserId,
      orgId,
      ['*'],
      ['admin'],
      undefined,
      undefined,
      undefined,
      memberUserId,
    );
    const res = await runAs(actor, () => controller.roster());
    expect(res.members.map((m) => m.userId).sort()).toEqual([adminUserId, memberUserId].sort());
    const member = res.members.find((m) => m.userId === memberUserId)!;
    expect(member.role).toBe('member');
    expect(member.activeClaimCount).toBe(1);
    expect(res.viewer).toEqual({ userId: memberUserId, role: 'member' });
  });

  it('an api-key actor gets the roster with no viewer identity', async () => {
    const actor = new ActorIdentity('admin_agent', 'agt_roster_test', orgId, ['*'], ['admin']);
    const res = await runAs(actor, () => controller.roster());
    expect(res.members.length).toBe(2);
    expect(res.viewer).toBeNull();
  });
});
