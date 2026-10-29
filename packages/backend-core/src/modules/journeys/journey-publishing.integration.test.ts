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
import { ConflictException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { JourneysService } from './journeys.service.ts';
import { JourneyRuntimeService } from './journey-runtime.service.ts';
import { JourneyRuntimeWorker } from './journey-runtime.worker.ts';
import { JourneyEventSink } from './journey-event.sink.ts';
import { JourneySimulator } from './journey-simulator.ts';
import { JourneyPublishingService } from './journey-publishing.service.ts';
import { CrmService } from '../crm/crm.service.ts';
import { AddressDeliverabilityService } from '../crm/address-deliverability.service.ts';
import { DefaultQuotasService } from '../../common/quotas/quotas.service.ts';
import { CuratorJobsService } from '../curator/curator-jobs.service.ts';

const TEST_URL = process.env.TEST_DATABASE_URL;
const skipReason = TEST_URL ? null : 'Set TEST_DATABASE_URL to a Postgres URL to run journey publishing tests.';

(skipReason ? describe.skip : describe)('Journey publishing', () => {
  let db: ReturnType<typeof createDb>;
  let appDb: ReturnType<typeof createDb>;
  let journeys: JourneysService;
  let runtime: JourneyRuntimeService;
  let worker: JourneyRuntimeWorker;
  let publishing: JourneyPublishingService;
  let orgId: string;
  let userId: string;
  let agent: ActorIdentity;
  let person: ActorIdentity;
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
    const [user] = await db
      .insert(schema.users)
      .values({ email: `publisher-${randomUUID()}@acme.test`, name: 'Kari Nordmann' })
      .returning();
    userId = user!.id;
    agent = new ActorIdentity('admin_agent', 'agt_publish_test', orgId, ['*'], ['admin']);
    person = new ActorIdentity('user', userId, orgId, ['*'], ['admin'], undefined, undefined, undefined, userId);
    const webhooks = new WebhookDispatcher();
    webhooks.registerSink(new JourneyEventSink());
    const crm = new CrmService(webhooks, new DefaultQuotasService(), new AddressDeliverabilityService());
    journeys = new JourneysService(webhooks);
    runtime = new JourneyRuntimeService(webhooks, crm, {} as never, new CuratorJobsService(webhooks));
    worker = new JourneyRuntimeWorker(appDb, runtime);
    publishing = new JourneyPublishingService(webhooks, journeys, new JourneySimulator(runtime));
  });

  afterAll(async () => {
    if (db) {
      await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
      await cleanup();
      await db.delete(schema.orgs).where(eq(schema.orgs.id, orgId));
      await db.delete(schema.users).where(eq(schema.users.id, userId));
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
      'outreach_proposals',
      'outreach_campaigns',
      'crm_contacts',
      'crm_segments',
      'conv_channels',
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
      .values({ orgId, name: 'trial', filterDefinition: { tagsAny: ['trial'] }, createdByActorType: 'user', createdByActorId: userId })
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
        createdByActorId: 'agt_publish_test',
      })
      .returning();
    campaignId = campaign!.id;
  });

  function runAs<T>(actor: ActorIdentity, fn: () => Promise<T>): Promise<T> {
    return appDb.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.bypass_rls', 'off', true)`);
      await tx.execute(sql`SELECT set_config('app.org_id', ${orgId}, true)`);
      const ctx: RequestContext = { db: tx, actor, correlationId: randomUUID() };
      return withContext(ctx, fn);
    });
  }
  const asAgent = <T>(fn: () => Promise<T>) => runAs(agent, fn);
  const asPerson = <T>(fn: () => Promise<T>) => runAs(person, fn);

  async function contact(name: string, tags: string[]) {
    const [row] = await db
      .insert(schema.crmContacts)
      .values({ orgId, name, email: `${name.toLowerCase()}@kunde.test`, tags, consentLawfulBasis: 'contract' })
      .returning();
    return row!;
  }

  const spec = (overrides: Record<string, unknown> = {}) => ({
    entry: { trigger: { type: 'manual' }, segmentId },
    goal: { event: 'subscription.started', windowDays: 30 },
    start: 'is_cto',
    nodes: [
      {
        id: 'is_cto',
        type: 'branch',
        rules: [{ if: { field: 'contact.title', op: 'eq', value: 'CTO' }, next: 'welcome' }],
        default: 'done',
      },
      {
        id: 'welcome',
        type: 'message',
        channel: 'email',
        approval: 'auto',
        content: { subject: 'Velkommen', body: 'Hei {{name}}!' },
        next: 'done',
      },
      { id: 'done', type: 'exit' },
    ],
    ...overrides,
  });

  it('simulates who enters, where they go and what each email would do', async () => {
    const journey = await asAgent(() => journeys.create({ name: 'Trial', outreachCampaignId: campaignId, spec: spec() }));
    const kari = await contact('Kari', ['trial']);
    await db.update(schema.crmContacts).set({ title: 'CTO' }).where(eq(schema.crmContacts.id, kari.id));
    await contact('Ola', ['trial']);
    await contact('Per', ['customer']);
    const result = await asAgent(() =>
      publishing.simulate({ journeyId: journey.id, segmentId: undefined, contactIds: undefined, renderSamples: 1 }),
    );
    expect(result.sample).toMatchObject({ source: 'segment', size: 2 });
    expect(result.entered).toBe(2);
    expect(result.edges).toMatchObject({ 'is_cto.rule_1': 1, 'is_cto.default': 1 });
    expect(result.messageDecisions.welcome).toEqual({ send: 1 });
    expect(result.messages[0]!.html).toContain('Kari');
    expect(result.exits).toEqual({ reached_end: 2 });

    const liv = await contact('Liv', ['customer']);
    const everyone = await asAgent(() =>
      publishing.simulate({ journeyId: journey.id, contactIds: [kari.id, liv.id] }),
    );
    expect(everyone.excluded).toEqual({ not_in_segment: 1 });
  });

  it('publishes only after a signed-in person confirms the fingerprint they reviewed', async () => {
    const journey = await asAgent(() => journeys.create({ name: 'Trial', outreachCampaignId: campaignId, spec: spec() }));
    const request = await asAgent(() => publishing.requestPublish(journey.id));
    expect(request.diff).toMatchObject({ againstVersion: null, autoNodes: ['welcome'] });
    expect(request.reviewPath).toContain(journey.id);

    await expect(asAgent(() => publishing.confirmPublish(journey.id, 1, request.fingerprint))).rejects.toThrow(
      ForbiddenException,
    );
    await expect(asPerson(() => publishing.confirmPublish(journey.id, 1, 'wrong'))).rejects.toThrow(ConflictException);

    const live = await asPerson(() => publishing.confirmPublish(journey.id, 1, request.fingerprint));
    expect(live).toMatchObject({ status: 'live', liveVersion: 1, draftVersion: null });
    const [event] = await db
      .select()
      .from(schema.events)
      .where(and(eq(schema.events.orgId, orgId), eq(schema.events.type, 'journey.version.published')));
    expect(event!.payload).toMatchObject({ journeyId: journey.id, version: 1, publishedBy: userId });
  });

  it('cancels a pending publish request when the draft is edited, and diffs against live', async () => {
    const journey = await asAgent(() => journeys.create({ name: 'Trial', outreachCampaignId: campaignId, spec: spec() }));
    const first = await asAgent(() => publishing.requestPublish(journey.id));
    await asPerson(() => publishing.confirmPublish(journey.id, 1, first.fingerprint));

    await asAgent(() =>
      journeys.updateNode(journey.id, {
        id: 'welcome',
        type: 'message',
        channel: 'email',
        approval: 'draft_only',
        content: { subject: 'Velkommen!', body: 'Hei {{name}}!' },
        next: 'done',
      }),
    );
    const second = await asAgent(() => publishing.requestPublish(journey.id));
    expect(second.diff).toMatchObject({ againstVersion: 1, changedNodes: ['welcome'], autoNodes: [] });
    await asAgent(() => journeys.updateSettings(journey.id, { settings: { quietHours: '21:00-08:00' } }));
    await expect(asPerson(() => publishing.confirmPublish(journey.id, 2, second.fingerprint))).rejects.toThrow(
      ConflictException,
    );
  });

  it('refuses to request publish for an invalid draft', async () => {
    const journey = await asAgent(() =>
      journeys.create({ name: 'Trial', outreachCampaignId: campaignId, spec: spec({ goal: undefined }) }),
    );
    await expect(asAgent(() => publishing.requestPublish(journey.id))).rejects.toThrow(BadRequestException);
  });

  it('lets an agent-drafted step send without review only after it earned it', async () => {
    const draftedWelcome = (approval: string) => ({
      id: 'welcome',
      type: 'message',
      channel: 'email',
      approval,
      draftBy: 'agent',
      brief: 'Welcome them',
      content: { subject: 'Velkommen', body: 'Hei {{name}}!' },
      next: 'done',
    });
    const journey = await asAgent(() =>
      journeys.create({
        name: 'Drafted',
        outreachCampaignId: campaignId,
        spec: spec({ start: 'welcome', nodes: [draftedWelcome('draft_only'), { id: 'done', type: 'exit' }] }),
      }),
    );
    const first = await asAgent(() => publishing.requestPublish(journey.id));
    await asPerson(() => publishing.confirmPublish(journey.id, 1, first.fingerprint));

    async function reviewed(count: number, edited: boolean) {
      for (let i = 0; i < count; i++) {
        const c = await contact(`Kunde${randomUUID().slice(0, 6)}`, ['trial']);
        const [run] = await db
          .insert(schema.journeyEnrollments)
          .values({ orgId, journeyId: journey.id, version: 1, contactId: c.id, subjectKey: `c:${c.id}`, state: 'done' })
          .returning();
        const [step] = await db
          .insert(schema.journeyStepRuns)
          .values({ orgId, enrollmentId: run!.id, nodeId: 'welcome', nodeType: 'message', visit: 1, status: 'completed' })
          .returning();
        await db.insert(schema.outreachProposals).values({
          orgId,
          campaignId,
          contactId: c.id,
          kind: 'journey',
          journeyEnrollmentId: run!.id,
          journeyStepRunId: step!.id,
          draftSubject: 'Velkommen',
          draftBody: 'Hei!',
          originalDraftBody: edited ? 'Hei der!' : null,
          status: 'sent',
          decidedByActorType: 'user',
          decidedByActorId: userId,
          proposedByActorType: 'system',
          proposedByActorId: 'journey-runtime',
        });
      }
    }

    await reviewed(27, false);
    await reviewed(2, true);
    await asAgent(() => journeys.updateNode(journey.id, draftedWelcome('auto')));
    let stats = await asAgent(() => publishing.nodeReviewStats(journey.id));
    expect(stats[0]).toMatchObject({ nodeId: 'welcome', reviewed: 29, readyForAuto: false });
    await expect(asAgent(() => publishing.requestPublish(journey.id))).rejects.toThrow(/30 reviewed drafts/);

    await reviewed(1, false);
    stats = await asAgent(() => publishing.nodeReviewStats(journey.id));
    expect(stats[0]).toMatchObject({ reviewed: 30, approvedUnedited: 28, readyForAuto: true });
    const request = await asAgent(() => publishing.requestPublish(journey.id));
    expect(request.diff.autoNodes).toEqual(['welcome']);
    expect(request.reviewStats[0]!.readyForAuto).toBe(true);
    await db.execute(sql`DELETE FROM outreach_proposals WHERE org_id = ${orgId}`);
  });

  it('reports enrollments, exits, node edges and goal lift', async () => {
    const journey = await asAgent(() =>
      journeys.create({
        name: 'Trial',
        outreachCampaignId: campaignId,
        spec: spec({
          nodes: [
            {
              id: 'is_cto',
              type: 'branch',
              rules: [{ if: { field: 'contact.title', op: 'eq', value: 'CTO' }, next: 'done' }],
              default: 'done',
            },
            { id: 'done', type: 'exit' },
          ],
        }),
      }),
    );
    const request = await asAgent(() => publishing.requestPublish(journey.id));
    await asPerson(() => publishing.confirmPublish(journey.id, 1, request.fingerprint));
    for (const name of ['Kari', 'Ola', 'Per']) {
      const c = await contact(name, ['trial']);
      await asAgent(() => runtime.enroll({ journeyId: journey.id, subject: { contactId: c.id, endUserId: null }, source: { type: 'manual' } }));
    }
    await worker.tick();
    const report = await asAgent(() => publishing.report(journey.id));
    expect(report.enrollments).toMatchObject({ total: 3, byState: { done: 3 }, exitReasons: { reached_end: 3 } });
    expect(report.nodes.find((n) => n.nodeId === 'is_cto')).toMatchObject({ arrived: 3, edges: { default: 3 } });
    expect(report.goal.treated).toEqual({ entered: 3, converted: 0, rate: 0 });
    expect(report.goal.lift).toBeNull();
    expect(report.integrity).toEqual({ duplicateSends: 0, enrollmentsWithoutTrace: 0 });
  });
});
