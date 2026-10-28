import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  ActorIdentity,
  StubMailer,
  WebhookDispatcher,
  withContext,
  type RequestContext,
} from '@getmunin/core';
import { createDb, runMigrations, schema } from '@getmunin/db';
import { eq, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { JourneysService } from './journeys.service.ts';
import { JourneyRuntimeService } from './journey-runtime.service.ts';
import { JourneyRuntimeWorker } from './journey-runtime.worker.ts';
import { JourneyEventSink } from './journey-event.sink.ts';
import { JourneySimulator } from './journey-simulator.ts';
import { JourneyPublishingService } from './journey-publishing.service.ts';
import { ProductEventsService } from '../analytics/product-events.service.ts';
import { IdentityService } from '../identity/identity.service.ts';
import { OutreachService } from '../outreach/outreach.service.ts';
import { JourneyOutboxService } from '../outreach/journey-outbox.service.ts';
import { CrmService } from '../crm/crm.service.ts';
import { AddressDeliverabilityService } from '../crm/address-deliverability.service.ts';
import { DefaultQuotasService } from '../../common/quotas/quotas.service.ts';
import { ConvService } from '../conv/conv.service.ts';
import { AlertsService } from '../system-alerts/system-alerts.service.ts';
import { VapiClientService } from '../conv/vapi/vapi-client.service.ts';
import { VapiOutreachCaller } from '../conv/vapi/vapi-outreach-caller.ts';
import { ThrellClientService } from '../conv/threll/threll-client.service.ts';
import { ThrellOutreachCaller } from '../conv/threll/threll-outreach-caller.ts';
import { ConversationClaimsService } from '../conv/conv.claims.service.ts';
import { CuratorJobsService } from '../curator/curator-jobs.service.ts';
import { EmailService } from '../conv/email/email.service.ts';
import { stubAttachmentGateway } from '../conv/attachments/conv-attachments.test-stub.ts';

const TEST_URL = process.env.TEST_DATABASE_URL;
const skipReason = TEST_URL ? null : 'Set TEST_DATABASE_URL to a Postgres URL to run the Gate 1 acceptance test.';
const DAY = 86_400_000;

const PLAYBOOK = fileURLToPath(new URL('../playbooks/skills/trial-onboarding.md', import.meta.url));

function playbookSpec(segmentId: string): Record<string, unknown> {
  const markdown = readFileSync(PLAYBOOK, 'utf8');
  const block = /```json\n([\s\S]*?)\n```/.exec(markdown);
  if (!block) throw new Error('trial-onboarding playbook has no json spec block');
  const spec = JSON.parse(block[1]!.replace('<trialists segment id>', segmentId)) as {
    settings: Record<string, unknown>;
  };
  delete spec.settings.quietHours;
  return spec;
}

(skipReason ? describe.skip : describe)('Gate 1: the trial onboarding playbook journey', () => {
  let db: ReturnType<typeof createDb>;
  let appDb: ReturnType<typeof createDb>;
  let webhooks: WebhookDispatcher;
  let journeys: JourneysService;
  let runtime: JourneyRuntimeService;
  let worker: JourneyRuntimeWorker;
  let publishing: JourneyPublishingService;
  let events: ProductEventsService;
  let outreach: OutreachService;
  let orgId: string;
  let userId: string;
  let agent: ActorIdentity;
  let person: ActorIdentity;

  beforeAll(async () => {
    process.env.MUNIN_KEY_PEPPER ??= 'test-pepper';
    process.env.MUNIN_API_URL ??= 'https://api.acme.test';
    await runMigrations(TEST_URL!);
    db = createDb(TEST_URL!, { serviceRole: true });
    const appUrl = TEST_URL!.replace(/(postgres(?:ql)?:\/\/)[^:@]+:[^@]+@/, '$1munin_app:munin_app@');
    appDb = createDb(appUrl);
    await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
    const [org] = await db.insert(schema.orgs).values({ name: 'Acme' }).returning();
    orgId = org!.id;
    const [user] = await db
      .insert(schema.users)
      .values({ email: `gate1-${randomUUID()}@acme.test`, name: 'Kari Nordmann' })
      .returning();
    userId = user!.id;
    await db.insert(schema.orgMembers).values({ orgId, userId, role: 'owner' });
    agent = new ActorIdentity('admin_agent', 'agt_gate1', orgId, ['*'], ['admin']);
    person = new ActorIdentity('user', userId, orgId, ['*'], ['admin'], undefined, undefined, undefined, userId);

    webhooks = new WebhookDispatcher();
    webhooks.registerSink(new JourneyEventSink());
    const crm = new CrmService(webhooks, new DefaultQuotasService(), new AddressDeliverabilityService());
    const conv = new ConvService(
      webhooks,
      new ConversationClaimsService(webhooks),
      new CuratorJobsService(webhooks),
      new AlertsService(webhooks),
      stubAttachmentGateway(),
    );
    const email = new EmailService(new StubMailer());
    outreach = new OutreachService(
      webhooks,
      conv,
      crm,
      email,
      [new VapiOutreachCaller(new VapiClientService(db)), new ThrellOutreachCaller(new ThrellClientService(db))],
      appDb,
      new CuratorJobsService(webhooks),
    );
    journeys = new JourneysService(webhooks);
    runtime = new JourneyRuntimeService(webhooks, crm, new JourneyOutboxService(outreach, webhooks, conv, crm, email), new CuratorJobsService(webhooks), { requestHandover: () => Promise.resolve(null) });
    worker = new JourneyRuntimeWorker(appDb, runtime);
    publishing = new JourneyPublishingService(webhooks, journeys, new JourneySimulator(runtime));
    events = new ProductEventsService(webhooks, new IdentityService(webhooks));
  });

  afterAll(async () => {
    if (!db) return;
    await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
    for (const table of [
      'journey_event_inbox',
      'journey_waits',
      'journey_step_runs',
      'journey_enrollments',
      'journey_versions',
      'journeys',
      'conv_message_deliveries',
      'conv_messages',
      'conv_conversations',
      'conv_contacts',
      'outreach_proposals',
      'outreach_campaigns',
      'analytics_product_events',
      'crm_activities',
      'crm_contacts',
      'crm_segments',
      'conv_channels',
      'end_users',
      'events',
      'curator_jobs',
    ]) {
      await db.execute(sql`DELETE FROM ${sql.identifier(table)} WHERE org_id = ${orgId}`);
    }
    await db.delete(schema.orgs).where(eq(schema.orgs.id, orgId));
    await db.delete(schema.users).where(eq(schema.users.id, userId));
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

  async function approveAllPending() {
    const pending = await db
      .select({ id: schema.outreachProposals.id })
      .from(schema.outreachProposals)
      .where(sql`${schema.outreachProposals.orgId} = ${orgId} AND ${schema.outreachProposals.status} = 'pending'`);
    for (const { id } of pending) {
      const proposal = await asAgent(() => outreach.getProposal(id));
      await runAs(person, () =>
        outreach.approveProposal(id, { fingerprint: proposal.draftFingerprint, publicBaseUrl: 'https://api.acme.test' }),
      );
    }
    return pending.length;
  }

  it('runs the published playbook journey end to end (quiet hours lifted so the run does not depend on the clock) with no duplicate sends and a full trace for everyone', async () => {
    const [segment] = await db
      .insert(schema.crmSegments)
      .values({ orgId, name: 'Trialists', filterDefinition: { tagsAny: ['trial'] }, createdByActorType: 'user', createdByActorId: userId })
      .returning();
    const [channel] = await db
      .insert(schema.convChannels)
      .values({ orgId, type: 'email', vendor: 'smtp', name: 'mail', active: true, config: { addressing: { fromAddress: 'hei@acme.test' } } })
      .returning();
    const [campaign] = await db
      .insert(schema.outreachCampaigns)
      .values({
        orgId,
        name: 'Trial',
        brief: 'Trial onboarding',
        segmentId: segment!.id,
        channelId: channel!.id,
        createdByActorType: 'admin_agent',
        createdByActorId: 'agt_gate1',
      })
      .returning();

    const people = [];
    for (const [name, title] of [
      ['Kari', 'CTO'],
      ['Ola', 'Utvikler'],
      ['Per', 'Designer'],
      ['Liv', 'CEO'],
      ['Nils', 'Konsulent'],
      ['Siri', 'Utvikler'],
      ['Tor', 'Selger'],
      ['Eva', 'Founder'],
    ] as const) {
      const [endUser] = await db.insert(schema.endUsers).values({ orgId, externalId: `acct-${name}` }).returning();
      const [row] = await db
        .insert(schema.crmContacts)
        .values({
          orgId,
          name: `${name} Nordmann`,
          email: `${name.toLowerCase()}@kunde.test`,
          title,
          tags: ['trial'],
          consentLawfulBasis: 'contract',
          endUserId: endUser!.id,
        })
        .returning();
      people.push(row!);
    }

    const journey = await asAgent(() =>
      journeys.create({ name: 'Trial onboarding', outreachCampaignId: campaign!.id, spec: playbookSpec(segment!.id) }),
    );
    const validation = await asAgent(() => journeys.validate(journey.id));
    expect(validation.errors).toEqual([]);
    const simulation = await asAgent(() => publishing.simulate({ journeyId: journey.id }));
    expect(simulation.entered + (simulation.excluded.holdout ?? 0)).toBe(8);
    const request = await asAgent(() => publishing.requestPublish(journey.id));
    await runAs(person, () => publishing.confirmPublish(journey.id, 1, request.fingerprint));

    const record = (contactId: string, name: string) =>
      asAgent(() => events.record([{ id: randomUUID(), name, identity: { contactId } }]));
    for (const p of people) await record(p.id, 'trial.started');
    await worker.tick();
    await worker.tick();
    expect(await approveAllPending()).toBeGreaterThan(0);
    await worker.tick();
    await worker.tick();

    await record(people[1]!.id, 'teammate.invited');
    await record(people[2]!.id, 'subscription.started');

    const later = new Date(Date.now() + 8 * DAY);
    for (let i = 0; i < 4; i++) await worker.tick(later);
    await approveAllPending();
    for (let i = 0; i < 3; i++) await worker.tick(later);

    const report = await asAgent(() => publishing.report(journey.id));
    expect(report.integrity).toEqual({ duplicateSends: 0, enrollmentsWithoutTrace: 0 });
    expect(report.enrollments.total).toBe(8);
    expect(report.enrollments.byState.active ?? 0).toBe(0);
    expect(report.enrollments.byState.waiting ?? 0).toBe(0);

    const runs = await db.select().from(schema.journeyEnrollments).where(eq(schema.journeyEnrollments.journeyId, journey.id));
    const byContact = new Map(runs.map((r) => [r.contactId, r]));
    const treated = runs.filter((r) => !r.holdout);
    expect(treated.length).toBeGreaterThan(0);
    for (const run of treated) {
      const steps = await db.select().from(schema.journeyStepRuns).where(eq(schema.journeyStepRuns.enrollmentId, run.id));
      expect(steps.map((s) => s.nodeId)).toContain('welcome');
    }
    const payer = byContact.get(people[2]!.id)!;
    expect(payer.goalReachedAt).not.toBeNull();
    if (!payer.holdout) expect(payer.exitReason).toBe('goal_reached');

    const lead = byContact.get(people[0]!.id)!;
    if (!lead.holdout) {
      const [kari] = await db.select().from(schema.crmContacts).where(eq(schema.crmContacts.id, people[0]!.id));
      expect(kari!.tags).toContain('trial-sales-lead');
    }
    const inviter = byContact.get(people[1]!.id)!;
    if (!inviter.holdout) {
      const steps = await db.select().from(schema.journeyStepRuns).where(eq(schema.journeyStepRuns.enrollmentId, inviter.id));
      expect(steps.find((s) => s.nodeId === 'invited')?.edgeTaken).toBe('rule_1');
    }

    const sent = await db
      .select({ stepRunId: schema.outreachProposals.journeyStepRunId })
      .from(schema.outreachProposals)
      .where(sql`${schema.outreachProposals.orgId} = ${orgId} AND ${schema.outreachProposals.status} = 'sent'`);
    expect(new Set(sent.map((s) => s.stepRunId)).size).toBe(sent.length);
  });
});
