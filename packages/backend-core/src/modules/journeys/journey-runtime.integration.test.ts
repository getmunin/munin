import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  ActorIdentity,
  WebhookDispatcher,
  withContext,
  type RequestContext,
} from '@getmunin/core';
import { createDb, runMigrations, schema } from '@getmunin/db';
import { and, eq, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { JourneysService } from './journeys.service.ts';
import { JourneyRuntimeService } from './journey-runtime.service.ts';
import { JourneyRuntimeWorker } from './journey-runtime.worker.ts';
import { JourneyEventSink } from './journey-event.sink.ts';
import { ProductEventsService } from '../analytics/product-events.service.ts';
import { IdentityService } from '../identity/identity.service.ts';
import { CrmService } from '../crm/crm.service.ts';
import { AddressDeliverabilityService } from '../crm/address-deliverability.service.ts';
import { DefaultQuotasService } from '../../common/quotas/quotas.service.ts';
import { CuratorJobsService } from '../curator/curator-jobs.service.ts';

const TEST_URL = process.env.TEST_DATABASE_URL;
const skipReason = TEST_URL ? null : 'Set TEST_DATABASE_URL to a Postgres URL to run journey runtime tests.';
const DAY = 86_400_000;

(skipReason ? describe.skip : describe)('Journey runtime', () => {
  let db: ReturnType<typeof createDb>;
  let appDb: ReturnType<typeof createDb>;
  let journeys: JourneysService;
  let runtime: JourneyRuntimeService;
  let worker: JourneyRuntimeWorker;
  let events: ProductEventsService;
  let crm: CrmService;
  let orgId: string;
  let agent: ActorIdentity;
  let campaignId: string;
  let segmentId: string;

  beforeAll(async () => {
    process.env.MUNIN_KEY_PEPPER ??= 'test-pepper';
    await runMigrations(TEST_URL!);
    db = createDb(TEST_URL!, { serviceRole: true });
    const appUrl = TEST_URL!.replace(/(postgres(?:ql)?:\/\/)[^:@]+:[^@]+@/, '$1munin_app:munin_app@');
    appDb = createDb(appUrl);
    await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
    const [org] = await db.insert(schema.orgs).values({ name: 'Acme' }).returning();
    orgId = org!.id;
    agent = new ActorIdentity('admin_agent', 'agt_runtime_test', orgId, ['*'], ['admin']);
    const webhooks = new WebhookDispatcher();
    webhooks.registerSink(new JourneyEventSink());
    crm = new CrmService(webhooks, new DefaultQuotasService(), new AddressDeliverabilityService());
    journeys = new JourneysService(webhooks);
    runtime = new JourneyRuntimeService(webhooks, crm, {} as never, new CuratorJobsService(webhooks));
    worker = new JourneyRuntimeWorker(appDb, runtime);
    events = new ProductEventsService(webhooks, new IdentityService(webhooks));
  });

  afterAll(async () => {
    if (db) {
      await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
      await cleanup();
      await db.delete(schema.orgs).where(eq(schema.orgs.id, orgId));
    }
  });

  async function cleanup() {
    for (const table of [
      'journey_event_inbox',
      'journey_waits',
      'journey_step_runs',
      'journey_enrollments',
      'journey_versions',
      'journeys',
      'outreach_campaigns',
      'analytics_product_events',
      'crm_activities',
      'crm_contacts',
      'crm_segments',
      'conv_channels',
      'end_users',
      'events',
    ]) {
      await db.execute(sql`DELETE FROM ${sql.identifier(table)} WHERE org_id = ${orgId}`);
    }
  }

  beforeEach(async () => {
    await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
    await cleanup();
    const [segment] = await db
      .insert(schema.crmSegments)
      .values({ orgId, name: 'trialists', filterDefinition: { tagsAny: ['trial'] }, createdByActorType: 'user', createdByActorId: 'usr_1' })
      .returning();
    segmentId = segment!.id;
    const [channel] = await db
      .insert(schema.convChannels)
      .values({ orgId, type: 'email', vendor: 'smtp', name: 'mail', active: true, config: {} })
      .returning();
    const [campaign] = await db
      .insert(schema.outreachCampaigns)
      .values({
        orgId,
        name: 'Trial',
        brief: 'Trial onboarding',
        segmentId,
        channelId: channel!.id,
        createdByActorType: 'admin_agent',
        createdByActorId: 'agt_runtime_test',
      })
      .returning();
    campaignId = campaign!.id;
  });

  function asAgent<T>(fn: () => Promise<T>): Promise<T> {
    return appDb.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.bypass_rls', 'off', true)`);
      await tx.execute(sql`SELECT set_config('app.org_id', ${orgId}, true)`);
      const ctx: RequestContext = { db: tx, actor: agent, correlationId: randomUUID() };
      return withContext(ctx, fn);
    });
  }

  async function contact(name: string, tags: string[] = ['trial']) {
    const [row] = await db
      .insert(schema.crmContacts)
      .values({ orgId, name, email: `${name.toLowerCase().replace(/\W+/g, '.')}@acme.test`, tags, consentLawfulBasis: 'contract' })
      .returning();
    return row!;
  }

  async function publish(spec: Record<string, unknown>, extra: Partial<typeof schema.journeys.$inferInsert> = {}) {
    const journey = await asAgent(() => journeys.create({ name: `J ${randomUUID()}`, outreachCampaignId: campaignId, spec }));
    const validation = await asAgent(() => journeys.validate(journey.id));
    expect(validation.errors).toEqual([]);
    await db
      .update(schema.journeyVersions)
      .set({ publishedAt: new Date(), publishedByActorId: 'usr_1' })
      .where(eq(schema.journeyVersions.journeyId, journey.id));
    await db
      .update(schema.journeys)
      .set({ status: 'live', liveVersion: 1, ...extra })
      .where(eq(schema.journeys.id, journey.id));
    await campaignCleanupGuard();
    return journey.id;
  }

  async function campaignCleanupGuard() {
    const [other] = await db
      .insert(schema.convChannels)
      .values({ orgId, type: 'email', vendor: 'smtp', name: `mail-${randomUUID()}`, active: true, config: {} })
      .returning();
    const [next] = await db
      .insert(schema.outreachCampaigns)
      .values({
        orgId,
        name: `Trial ${randomUUID()}`,
        brief: 'Trial onboarding',
        segmentId,
        channelId: other!.id,
        createdByActorType: 'admin_agent',
        createdByActorId: 'agt_runtime_test',
      })
      .returning();
    campaignId = next!.id;
  }

  const record = (contactId: string, name: string, properties: Record<string, unknown> = {}) =>
    asAgent(() => events.record([{ id: randomUUID(), name, identity: { contactId }, properties }]));

  async function enrollmentsOf(journeyId: string) {
    return db.select().from(schema.journeyEnrollments).where(eq(schema.journeyEnrollments.journeyId, journeyId));
  }

  const trialSpec = () => ({
    entry: { trigger: { type: 'event', event: 'trial.started' }, segmentId },
    goal: { event: 'subscription.started', windowDays: 30 },
    start: 'wait5',
    nodes: [
      { id: 'wait5', type: 'wait', duration: 'P5D', next: 'invited' },
      {
        id: 'invited',
        type: 'branch',
        rules: [{ if: { event: 'teammate.invited', since: 'entry' }, next: 'done' }],
        default: 'tag_stuck',
      },
      { id: 'tag_stuck', type: 'action', action: 'crm.add_tag', params: { tag: 'trial-stuck' }, next: 'done' },
      { id: 'done', type: 'exit' },
    ],
  });

  it('enrolls on a product event, waits, branches on behaviour and acts', async () => {
    const journeyId = await publish(trialSpec());
    const kari = await contact('Kari');
    const ola = await contact('Ola');
    await record(kari.id, 'trial.started');
    await record(ola.id, 'trial.started');

    await worker.tick();
    let rows = await enrollmentsOf(journeyId);
    expect(rows.map((r) => r.state).sort()).toEqual(['waiting', 'waiting']);

    await record(kari.id, 'teammate.invited');
    await worker.tick(new Date(Date.now() + 6 * DAY));
    await worker.tick(new Date(Date.now() + 6 * DAY));

    rows = await enrollmentsOf(journeyId);
    expect(rows.every((r) => r.state === 'done' && r.exitReason === 'reached_end')).toBe(true);
    const [kariAfter] = await db.select().from(schema.crmContacts).where(eq(schema.crmContacts.id, kari.id));
    const [olaAfter] = await db.select().from(schema.crmContacts).where(eq(schema.crmContacts.id, ola.id));
    expect(kariAfter!.tags).not.toContain('trial-stuck');
    expect(olaAfter!.tags).toContain('trial-stuck');

    const olaRun = rows.find((r) => r.contactId === ola.id)!;
    const trace = await asAgent(() => runtime.getTrace(olaRun.id));
    expect(trace.steps.map((s) => [s.nodeId, s.edgeTaken])).toEqual([
      ['wait5', 'next'],
      ['invited', 'default'],
      ['tag_stuck', 'next'],
      ['done', null],
    ]);
    expect(trace.context.trigger).toMatchObject({ name: 'trial.started' });
  });

  it('skips contacts outside the entry segment and never enrolls twice while a run is open', async () => {
    const journeyId = await publish(trialSpec());
    const outsider = await contact('Per', ['customer']);
    const kari = await contact('Kari');
    await record(outsider.id, 'trial.started');
    await record(kari.id, 'trial.started');
    await record(kari.id, 'trial.started');
    await worker.tick();
    const rows = await enrollmentsOf(journeyId);
    expect(rows.map((r) => r.contactId)).toEqual([kari.id]);
  });

  it('runs a concurrent journey once per event, each event at most once', async () => {
    const journeyId = await publish({
      ...trialSpec(),
      entry: { trigger: { type: 'event', event: 'trial.started' }, segmentId, reentry: 'concurrent' },
    });
    const kari = await contact('Kari');
    await record(kari.id, 'trial.started');
    await record(kari.id, 'trial.started');
    await worker.tick();
    const rows = await enrollmentsOf(journeyId);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.state === 'waiting' && r.entryKey !== '')).toBe(true);
    expect(new Set(rows.map((r) => r.entryKey)).size).toBe(2);
    const again = await asAgent(() =>
      runtime.enroll({
        journeyId,
        subject: { contactId: kari.id, endUserId: null },
        source: { type: 'event', eventId: rows[0]!.entryKey },
      }),
    );
    expect(again).toMatchObject({ status: 'skipped', reason: 'already_active' });
  });

    it('holds a run at an approval step until a signed-in person decides, and never lets an agent decide', async () => {
    const asUser = <T>(fn: () => Promise<T>): Promise<T> =>
      appDb.transaction(async (tx) => {
        await tx.execute(sql`SELECT set_config('app.bypass_rls', 'off', true)`);
        await tx.execute(sql`SELECT set_config('app.org_id', ${orgId}, true)`);
        const actor = new ActorIdentity('user', 'usr_reviewer', orgId, ['*'], ['admin']);
        return withContext({ db: tx, actor, correlationId: randomUUID() }, fn);
      });
    const journeyId = await publish({
      entry: { trigger: { type: 'manual' } },
      goal: { event: 'subscription.started', windowDays: 30 },
      start: 'check',
      nodes: [
        { id: 'check', type: 'approval', title: 'Big account — ok to start?', timeout: 'P1D', next: 'tag', onReject: 'rejected' },
        { id: 'tag', type: 'action', action: 'crm.add_tag', params: { tag: 'approved-start' }, next: 'done' },
        { id: 'rejected', type: 'exit', reason: 'not_now' },
        { id: 'done', type: 'exit' },
      ],
    });
    const people = await Promise.all(['Kari', 'Ola', 'Per'].map((n) => contact(n)));
    const runs = [];
    for (const person of people) {
      runs.push(
        (await asAgent(() => runtime.enroll({ journeyId, subject: { contactId: person.id, endUserId: null }, source: { type: 'manual' } })))
          .enrollmentId!,
      );
    }
    await worker.tick();
    const pending = await asAgent(() => runtime.listApprovals({ status: 'pending', journeyId }));
    expect(pending).toHaveLength(3);
    const byContact = new Map(pending.map((a) => [a.contactId, a]));
    await expect(
      asAgent(() => runtime.decideApproval({ approvalId: byContact.get(people[0]!.id)!.id, decision: 'approve' })),
    ).rejects.toThrow(/signed-in person/);

    await asUser(() => runtime.decideApproval({ approvalId: byContact.get(people[0]!.id)!.id, decision: 'approve' }));
    await asUser(() => runtime.decideApproval({ approvalId: byContact.get(people[1]!.id)!.id, decision: 'reject', note: 'not now' }));
    await expect(
      asUser(() => runtime.decideApproval({ approvalId: byContact.get(people[1]!.id)!.id, decision: 'approve' })),
    ).rejects.toThrow(/already rejected/);
    await worker.tick();
    await worker.tick(new Date(Date.now() + 2 * DAY));
    await worker.tick(new Date(Date.now() + 2 * DAY));

    const after = await enrollmentsOf(journeyId);
    const reason = (id: string) => after.find((r) => r.id === id)!.exitReason;
    expect([reason(runs[0]!), reason(runs[1]!), reason(runs[2]!)]).toEqual(['reached_end', 'not_now', 'approval_timeout']);
    const [kari] = await db.select().from(schema.crmContacts).where(eq(schema.crmContacts.id, people[0]!.id));
    expect(kari!.tags).toContain('approved-start');
    const expired = await asAgent(() => runtime.listApprovals({ status: 'expired', journeyId }));
    expect(expired.map((a) => a.contactId)).toEqual([people[2]!.id]);
  });

  it('enters another journey and follows onGoal once it reaches its goal there', async () => {
    const trial = await publish({
      entry: { trigger: { type: 'manual' } },
      goal: { event: 'subscription.started', windowDays: 30 },
      start: 'converted',
      nodes: [{ id: 'converted', type: 'goal', name: 'converted', exitOnReach: true }],
    });
    const parent = await publish({
      entry: { trigger: { type: 'manual' } },
      goal: { event: 'subscription.started', windowDays: 30 },
      start: 'run_trial',
      nodes: [
        { id: 'run_trial', type: 'sub_journey', journeyId: trial, await: true, next: 'plain', onGoal: 'won' },
        { id: 'plain', type: 'exit', reason: 'plain' },
        { id: 'won', type: 'exit', reason: 'won' },
      ],
    });
    const kari = await contact('Kari');
    const run = await asAgent(() =>
      runtime.enroll({ journeyId: parent, subject: { contactId: kari.id, endUserId: null }, source: { type: 'manual' } }),
    );
    for (let i = 0; i < 4; i++) await worker.tick();
    const [child] = await enrollmentsOf(trial);
    expect(child).toMatchObject({ exitReason: 'goal_reached', source: { type: 'journey', journeyId: parent } });
    expect(child!.context).toMatchObject({ journeyDepth: 1 });
    const [parentRun] = (await enrollmentsOf(parent)).filter((r) => r.id === run.enrollmentId);
    expect(parentRun).toMatchObject({ exitReason: 'won' });
  });

  it('runs every step exactly once even when ticks repeat', async () => {
    const journeyId = await publish(trialSpec());
    const kari = await contact('Kari');
    await record(kari.id, 'trial.started');
    const later = new Date(Date.now() + 6 * DAY);
    await worker.tick();
    await Promise.all([worker.tick(later), worker.tick(later)]);
    await worker.tick(later);
    const [run] = await enrollmentsOf(journeyId);
    const steps = await db.select().from(schema.journeyStepRuns).where(eq(schema.journeyStepRuns.enrollmentId, run!.id));
    expect(steps.map((s) => s.nodeId).sort()).toEqual(['done', 'invited', 'tag_stuck', 'wait5']);
    const activities = await db.select().from(schema.crmContacts).where(eq(schema.crmContacts.id, kari.id));
    expect(activities[0]!.tags.filter((t) => t === 'trial-stuck')).toHaveLength(1);
  });

  it('takes the timeout path of a wait_for, or the next path when the event arrives', async () => {
    const journeyId = await publish({
      entry: { trigger: { type: 'manual' } },
      goal: { event: 'subscription.started', windowDays: 30 },
      start: 'await_invite',
      nodes: [
        { id: 'await_invite', type: 'wait_for', event: 'teammate.invited', timeout: 'P3D', next: 'invited', onTimeout: 'silent' },
        { id: 'invited', type: 'exit', reason: 'invited' },
        { id: 'silent', type: 'exit', reason: 'silent' },
      ],
    });
    const kari = await contact('Kari');
    const ola = await contact('Ola');
    for (const c of [kari, ola]) {
      await asAgent(() => runtime.enroll({ journeyId, subject: { contactId: c.id, endUserId: null }, source: { type: 'manual' } }));
    }
    await worker.tick();
    await record(kari.id, 'teammate.invited');
    await worker.tick();
    await worker.tick(new Date(Date.now() + 4 * DAY));
    await worker.tick(new Date(Date.now() + 4 * DAY));
    const rows = await enrollmentsOf(journeyId);
    const reasonFor = (id: string) => rows.find((r) => r.contactId === id)!.exitReason;
    expect(reasonFor(kari.id)).toBe('invited');
    expect(reasonFor(ola.id)).toBe('silent');
  });

  it('exits on the goal event and keeps tracking goals for the holdout', async () => {
    const journeyId = await publish({ ...trialSpec(), settings: { holdoutPct: 50 } });
    const people = await Promise.all(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'].map((n) => contact(`Kunde ${n}`)));
    for (const p of people) await record(p.id, 'trial.started');
    await worker.tick();
    for (const p of people) await record(p.id, 'subscription.started');
    await worker.tick();
    const rows = await enrollmentsOf(journeyId);
    expect(rows).toHaveLength(8);
    expect(rows.some((r) => r.holdout)).toBe(true);
    expect(rows.some((r) => !r.holdout)).toBe(true);
    expect(rows.every((r) => r.goalReachedAt !== null)).toBe(true);
    expect(rows.filter((r) => !r.holdout).every((r) => r.exitReason === 'goal_reached')).toBe(true);
    expect(rows.filter((r) => r.holdout).every((r) => r.exitReason === 'holdout')).toBe(true);
  });

  it('ignores events caused by its own actions when deciding who enters', async () => {
    const journeyId = await publish({
      entry: { trigger: { type: 'event', event: 'crm.contact.updated' } },
      goal: { event: 'subscription.started', windowDays: 30 },
      start: 'touch',
      nodes: [
        { id: 'touch', type: 'action', action: 'crm.update_contact', params: { fields: { title: 'Touched' } }, next: 'done' },
        { id: 'done', type: 'exit' },
      ],
    });
    const kari = await contact('Kari');
    await asAgent(() => crm.updateContact({ id: kari.id, patch: { title: 'CTO' } }));
    for (let i = 0; i < 4; i++) await worker.tick();
    const rows = await enrollmentsOf(journeyId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.exitReason).toBe('reached_end');
  });

  it('holds runs while paused without exiting anyone', async () => {
    const journeyId = await publish(trialSpec());
    const kari = await contact('Kari');
    await record(kari.id, 'trial.started');
    await worker.tick();
    await asAgent(() => journeys.pause(journeyId));
    await worker.tick(new Date(Date.now() + 6 * DAY));
    let [run] = await enrollmentsOf(journeyId);
    expect(run!.state).toBe('active');
    expect(run!.currentNode).toBe('wait5');
    await asAgent(() => journeys.resume(journeyId));
    await worker.tick(new Date(Date.now() + 6 * DAY));
    [run] = await enrollmentsOf(journeyId);
    expect(run!.state).toBe('done');
  });

  it('enrolls segment members on schedule', async () => {
    const journeyId = await publish(
      {
        entry: { trigger: { type: 'segment', segmentId, schedule: 'daily', at: '09:00' } },
        goal: { event: 'subscription.started', windowDays: 30 },
        start: 'done',
        nodes: [{ id: 'done', type: 'exit' }],
      },
      { nextEntryAt: new Date(Date.now() - 1000) },
    );
    await contact('Kari');
    await contact('Ola');
    await contact('Per', ['customer']);
    await worker.tick();
    const rows = await enrollmentsOf(journeyId);
    expect(rows).toHaveLength(2);
    const [journey] = await db.select().from(schema.journeys).where(eq(schema.journeys.id, journeyId));
    expect(journey!.nextEntryAt!.getTime()).toBeGreaterThan(Date.now());
  });

  it('accepts events emitted inside an end-user request', async () => {
    const [endUser] = await db.insert(schema.endUsers).values({ orgId, externalId: 'kari' }).returning();
    await appDb.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.bypass_rls', 'off', true)`);
      await tx.execute(sql`SELECT set_config('app.org_id', ${orgId}, true)`);
      await tx.execute(sql`SELECT set_config('app.end_user_id', ${endUser!.id}, true)`);
      const actor = new ActorIdentity('end_user_agent', 'tok_1', orgId, ['crm:write'], ['self_service'], endUser!.id);
      const webhooks = new WebhookDispatcher();
      webhooks.registerSink(new JourneyEventSink());
      await withContext({ db: tx, actor, correlationId: randomUUID() }, () =>
        webhooks.emit({ type: 'conversation.handover_requested', payload: { endUserId: endUser!.id } }),
      );
    });
    const inbox = await db
      .select()
      .from(schema.journeyEventInbox)
      .where(and(eq(schema.journeyEventInbox.orgId, orgId), eq(schema.journeyEventInbox.type, 'conversation.handover_requested')));
    expect(inbox).toHaveLength(1);
    expect(inbox[0]!.actorId).toBe('tok_1');
  });

  it('ejects a person and cancels their waits', async () => {
    const journeyId = await publish(trialSpec());
    const kari = await contact('Kari');
    await record(kari.id, 'trial.started');
    await worker.tick();
    const [run] = await enrollmentsOf(journeyId);
    const ejected = await asAgent(() => runtime.eject(run!.id));
    expect(ejected).toMatchObject({ state: 'exited', exitReason: 'ejected' });
    const waits = await db.select().from(schema.journeyWaits).where(eq(schema.journeyWaits.enrollmentId, run!.id));
    expect(waits.every((w) => w.resolution === 'cancelled')).toBe(true);
  });
});
