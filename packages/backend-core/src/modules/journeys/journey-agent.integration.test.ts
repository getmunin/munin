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
import { BadRequestException, ConflictException } from '@nestjs/common';
import { pinnedToolArgsFor } from '@getmunin/types';
import { JourneysService } from './journeys.service.ts';
import { DECIDE_STEP_JOB_URI, JourneyRuntimeService } from './journey-runtime.service.ts';
import { JourneyRuntimeWorker } from './journey-runtime.worker.ts';
import { JourneyEventSink } from './journey-event.sink.ts';
import { JourneySimulator } from './journey-simulator.ts';
import { CrmService } from '../crm/crm.service.ts';
import { AddressDeliverabilityService } from '../crm/address-deliverability.service.ts';
import { DefaultQuotasService } from '../../common/quotas/quotas.service.ts';
import { CuratorJobsService } from '../curator/curator-jobs.service.ts';

const TEST_URL = process.env.TEST_DATABASE_URL;
const skipReason = TEST_URL ? null : 'Set TEST_DATABASE_URL to a Postgres URL to run journey agent tests.';
const NO_SYNTHETIC_FNR = '01819012365';

(skipReason ? describe.skip : describe)('Journey agent decide nodes', () => {
  let db: ReturnType<typeof createDb>;
  let appDb: ReturnType<typeof createDb>;
  let journeys: JourneysService;
  let runtime: JourneyRuntimeService;
  let worker: JourneyRuntimeWorker;
  let simulator: JourneySimulator;
  let orgId: string;
  let agent: ActorIdentity;
  let curator: ActorIdentity;
  let campaignId: string;

  beforeAll(async () => {
    process.env.MUNIN_KEY_PEPPER ??= 'test-pepper';
    await runMigrations(TEST_URL!);
    db = createDb(TEST_URL!, { serviceRole: true });
    const appUrl = TEST_URL!.replace(/(postgres(?:ql)?:\/\/)[^:@]+:[^@]+@/, '$1munin_app:munin_app@');
    appDb = createDb(appUrl);
    await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
    const [org] = await db.insert(schema.orgs).values({ name: 'Acme' }).returning();
    orgId = org!.id;
    agent = new ActorIdentity('admin_agent', 'agt_agent_test', orgId, ['*'], ['admin']);
    curator = new ActorIdentity('admin_agent', 'curator-runner', orgId, ['*'], ['admin']);
    const webhooks = new WebhookDispatcher();
    webhooks.registerSink(new JourneyEventSink());
    const crm = new CrmService(webhooks, new DefaultQuotasService(), new AddressDeliverabilityService());
    journeys = new JourneysService(webhooks);
    runtime = new JourneyRuntimeService(webhooks, crm, {} as never, new CuratorJobsService(webhooks));
    worker = new JourneyRuntimeWorker(appDb, runtime);
    simulator = new JourneySimulator(runtime);
  });

  afterAll(async () => {
    if (!db) return;
    await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
    await cleanup();
    await db.delete(schema.orgs).where(eq(schema.orgs.id, orgId));
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
      'curator_jobs',
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
      .values({ orgId, name: 'all', filterDefinition: {}, createdByActorType: 'user', createdByActorId: 'usr_1' })
      .returning();
    const [channel] = await db
      .insert(schema.convChannels)
      .values({ orgId, type: 'email', vendor: 'smtp', name: 'mail', active: true, config: {} })
      .returning();
    const [campaign] = await db
      .insert(schema.outreachCampaigns)
      .values({
        orgId,
        name: 'Trial',
        brief: 'Trial',
        segmentId: segment!.id,
        channelId: channel!.id,
        createdByActorType: 'admin_agent',
        createdByActorId: 'agt_agent_test',
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

  const spec = {
    entry: { trigger: { type: 'manual' } },
    goal: { event: 'subscription.started', windowDays: 30 },
    start: 'triage',
    nodes: [
      {
        id: 'triage',
        type: 'agent',
        mode: 'decide',
        instructions: 'Is this trial user likely to buy within a month?',
        edges: { likely: 'flag', unlikely: 'done' },
        fallback: 'unlikely',
        inputs: ['contact'],
      },
      { id: 'flag', type: 'action', action: 'crm.add_tag', params: { tag: 'likely-buyer' }, next: 'done' },
      { id: 'done', type: 'exit' },
    ],
  };

  async function liveJourneyWithKari() {
    const journey = await asAgent(() => journeys.create({ name: 'Triage', outreachCampaignId: campaignId, spec }));
    expect((await asAgent(() => journeys.validate(journey.id))).errors).toEqual([]);
    await db
      .update(schema.journeyVersions)
      .set({ publishedAt: new Date(), publishedByActorId: 'usr_1' })
      .where(eq(schema.journeyVersions.journeyId, journey.id));
    await db.update(schema.journeys).set({ status: 'live', liveVersion: 1 }).where(eq(schema.journeys.id, journey.id));
    const [kari] = await db
      .insert(schema.crmContacts)
      .values({
        orgId,
        name: 'Kari Nordmann',
        email: 'kari@kunde.test',
        title: 'CTO',
        consentLawfulBasis: 'contract',
        customFields: { plan: 'pro', note: `fnr ${NO_SYNTHETIC_FNR}` },
      })
      .returning();
    const result = await asAgent(() =>
      runtime.enroll({ journeyId: journey.id, subject: { contactId: kari!.id, endUserId: null }, source: { type: 'manual' } }),
    );
    await worker.tick();
    const [step] = await db
      .select()
      .from(schema.journeyStepRuns)
      .where(and(eq(schema.journeyStepRuns.enrollmentId, result.enrollmentId!), eq(schema.journeyStepRuns.nodeId, 'triage')));
    return { journeyId: journey.id, kari: kari!, enrollmentId: result.enrollmentId!, step: step! };
  }

  it('files a fast-tier curator job with only the declared, redacted inputs and waits for it', async () => {
    const { step, enrollmentId } = await liveJourneyWithKari();
    expect(step.status).toBe('waiting');
    const [job] = await db.select().from(schema.curatorJobs).where(eq(schema.curatorJobs.orgId, orgId));
    expect(job).toMatchObject({ jobUri: DECIDE_STEP_JOB_URI, status: 'pending' });
    expect(job!.sourceEventPayload).toMatchObject({ stepRunId: step.id, enrollmentId });
    expect(job!.userPrompt).toContain('Is this trial user likely to buy within a month?');
    expect(job!.userPrompt).toContain('"title": "CTO"');
    expect(job!.userPrompt).not.toContain(NO_SYNTHETIC_FNR);
    expect(job!.userPrompt).not.toContain('kari@kunde.test');
    const pinned = pinnedToolArgsFor(DECIDE_STEP_JOB_URI, job!.sourceEventPayload);
    expect(pinned).toEqual({ ok: true, pinned: { journeys_submit_decision: { stepRunId: step.id } } });
  });

  it('continues on the edge the agent chose and logs its reason', async () => {
    const { step, kari, enrollmentId } = await liveJourneyWithKari();
    await expect(
      runAs(curator, () => runtime.submitDecision({ stepRunId: step.id, edge: 'maybe', reason: 'unsure' })),
    ).rejects.toThrow(BadRequestException);
    const accepted = await runAs(curator, () =>
      runtime.submitDecision({ stepRunId: step.id, edge: 'likely', reason: 'CTO on the pro plan', confidence: 'high' }),
    );
    expect(accepted).toEqual({ accepted: true, edge: 'likely', nextNode: 'flag' });
    await expect(
      runAs(curator, () => runtime.submitDecision({ stepRunId: step.id, edge: 'unlikely', reason: 'again' })),
    ).rejects.toThrow(ConflictException);

    await worker.tick();
    const [after] = await db.select().from(schema.crmContacts).where(eq(schema.crmContacts.id, kari.id));
    expect(after!.tags).toContain('likely-buyer');
    const trace = await asAgent(() => runtime.getTrace(enrollmentId));
    const triage = trace.steps.find((s) => s.nodeId === 'triage')!;
    expect(triage).toMatchObject({ status: 'completed', edgeTaken: 'likely', reason: 'CTO on the pro plan' });
    expect(triage.output.decision).toMatchObject({ edge: 'likely', confidence: 'high', decidedBy: 'curator-runner' });
    expect(triage.agent).toMatchObject({ status: 'pending', tier: 'fast' });
  });

  it('takes the fallback edge when no decision arrives in time', async () => {
    const { step, kari, enrollmentId } = await liveJourneyWithKari();
    const later = new Date(Date.now() + 11 * 60_000);
    await worker.tick(later);
    await worker.tick(later);
    const [run] = await db.select().from(schema.journeyEnrollments).where(eq(schema.journeyEnrollments.id, enrollmentId));
    expect(run).toMatchObject({ state: 'done', exitReason: 'reached_end' });
    const [triage] = await db.select().from(schema.journeyStepRuns).where(eq(schema.journeyStepRuns.id, step.id));
    expect(triage).toMatchObject({ edgeTaken: 'unlikely', reason: 'fallback: no decision in time' });
    const [after] = await db.select().from(schema.crmContacts).where(eq(schema.crmContacts.id, kari.id));
    expect(after!.tags).not.toContain('likely-buyer');
    await expect(
      runAs(curator, () => runtime.submitDecision({ stepRunId: step.id, edge: 'likely', reason: 'late' })),
    ).rejects.toThrow(ConflictException);
  });

  it('simulates agent nodes along their fallback and says so', async () => {
    const { journeyId } = await liveJourneyWithKari();
    const parsed = (await asAgent(() => journeys.get(journeyId))).live!.spec;
    const { JourneySpecSchema } = await import('@getmunin/types');
    const result = await asAgent(() => simulator.simulate({ journeyId, spec: JourneySpecSchema.parse(parsed), limit: 5 }));
    expect(result.edges['triage.unlikely']).toBe(result.entered);
    expect(result.assumptions).toContainEqual({ code: 'agent_fallback', nodeId: 'triage', event: 'unlikely' });
  });
});
