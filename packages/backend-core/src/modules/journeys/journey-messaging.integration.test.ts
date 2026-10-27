import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  ActorIdentity,
  StubMailer,
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
import { JourneyMonitorService } from './journey-monitor.service.ts';
import { OutreachService } from '../outreach/outreach.service.ts';
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
const skipReason = TEST_URL ? null : 'Set TEST_DATABASE_URL to a Postgres URL to run journey messaging tests.';

(skipReason ? describe.skip : describe)('Journey messaging', () => {
  let db: ReturnType<typeof createDb>;
  let appDb: ReturnType<typeof createDb>;
  let webhooks: WebhookDispatcher;
  let journeys: JourneysService;
  let runtime: JourneyRuntimeService;
  let worker: JourneyRuntimeWorker;
  let outreach: OutreachService;
  let monitor: JourneyMonitorService;
  let alerts: AlertsService;
  let orgId: string;
  let userId: string;
  let agent: ActorIdentity;
  let person: ActorIdentity;
  let campaignId: string;
  let segmentId: string;

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
      .values({ email: `reviewer-${randomUUID()}@acme.test`, name: 'Kari Nordmann' })
      .returning();
    userId = user!.id;
    await db.insert(schema.orgMembers).values({ orgId, userId, role: 'owner' });
    agent = new ActorIdentity('admin_agent', 'agt_messaging_test', orgId, ['*'], ['admin']);
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
    outreach = new OutreachService(
      webhooks,
      conv,
      crm,
      new EmailService(new StubMailer()),
      [new VapiOutreachCaller(new VapiClientService(db)), new ThrellOutreachCaller(new ThrellClientService(db))],
      appDb,
      new CuratorJobsService(webhooks),
    );
    journeys = new JourneysService(webhooks);
    runtime = new JourneyRuntimeService(webhooks, crm, outreach, new CuratorJobsService(webhooks));
    alerts = new AlertsService(webhooks);
    monitor = new JourneyMonitorService(journeys, alerts);
    worker = new JourneyRuntimeWorker(appDb, runtime, monitor);
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
      'conv_message_deliveries',
      'conv_messages',
      'conv_conversations',
      'conv_contacts',
      'outreach_proposals',
      'outreach_campaigns',
      'crm_contacts',
      'crm_segments',
      'conv_channels',
      'end_users',
      'events',
      'curator_jobs',
      'org_alerts',
    ]) {
      await db.execute(sql`DELETE FROM ${sql.identifier(table)} WHERE org_id = ${orgId}`);
    }
  }

  beforeEach(async () => {
    await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
    await cleanup();
    const [segment] = await db
      .insert(schema.crmSegments)
      .values({ orgId, name: 'all', filterDefinition: {}, createdByActorType: 'user', createdByActorId: userId })
      .returning();
    segmentId = segment!.id;
    const [channel] = await db
      .insert(schema.convChannels)
      .values({
        orgId,
        type: 'email',
        vendor: 'smtp',
        name: 'mail',
        active: true,
        config: { addressing: { fromAddress: 'hei@acme.test', fromName: 'Acme' } },
      })
      .returning();
    const [campaign] = await db
      .insert(schema.outreachCampaigns)
      .values({
        orgId,
        name: 'Trial',
        brief: 'Trial onboarding',
        segmentId,
        channelId: channel!.id,
        enabled: false,
        createdByActorType: 'admin_agent',
        createdByActorId: 'agt_messaging_test',
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

  async function contact(values: Partial<typeof schema.crmContacts.$inferInsert> = {}) {
    const [endUser] = await db.insert(schema.endUsers).values({ orgId }).returning();
    const [row] = await db
      .insert(schema.crmContacts)
      .values({
        orgId,
        name: 'Ola Nordmann',
        email: `ola-${randomUUID()}@kunde.test`,
        consentLawfulBasis: 'contract',
        endUserId: endUser!.id,
        ...values,
      })
      .returning();
    return row!;
  }

  async function publish(nodes: unknown[], settings: Record<string, unknown> = {}) {
    const [channel] = await db.select().from(schema.convChannels).where(eq(schema.convChannels.orgId, orgId)).limit(1);
    const [campaign] = await db
      .insert(schema.outreachCampaigns)
      .values({
        orgId,
        name: `Campaign ${randomUUID()}`,
        brief: 'Trial onboarding',
        segmentId,
        channelId: channel!.id,
        createdByActorType: 'admin_agent',
        createdByActorId: 'agt_messaging_test',
      })
      .returning();
    campaignId = campaign!.id;
    const journey = await asAgent(() =>
      journeys.create({
        name: `J ${randomUUID()}`,
        outreachCampaignId: campaignId,
        spec: {
          entry: { trigger: { type: 'manual' } },
          goal: { event: 'subscription.started', windowDays: 30 },
          settings,
          start: 'welcome',
          nodes,
        },
      }),
    );
    expect((await asAgent(() => journeys.validate(journey.id))).errors).toEqual([]);
    await db
      .update(schema.journeyVersions)
      .set({ publishedAt: new Date(), publishedByActorId: userId })
      .where(eq(schema.journeyVersions.journeyId, journey.id));
    await db.update(schema.journeys).set({ status: 'live', liveVersion: 1 }).where(eq(schema.journeys.id, journey.id));
    return journey.id;
  }

  const welcome = (extra: Record<string, unknown> = {}) => ({
    id: 'welcome',
    type: 'message',
    channel: 'email',
    content: { subject: 'Velkommen til Acme', body: 'Hei {{name}}, **velkommen**!' },
    next: 'done',
    ...extra,
  });
  const done = { id: 'done', type: 'exit' };

  async function enroll(journeyId: string, contactId: string) {
    const result = await asAgent(() =>
      runtime.enroll({ journeyId, subject: { contactId, endUserId: null }, source: { type: 'manual' } }),
    );
    return result.enrollmentId!;
  }

  async function enrollment(id: string) {
    const [row] = await db.select().from(schema.journeyEnrollments).where(eq(schema.journeyEnrollments.id, id));
    return row!;
  }

  async function proposalsFor(contactId: string) {
    return db.select().from(schema.outreachProposals).where(eq(schema.outreachProposals.contactId, contactId));
  }

  it('files a draft_only email for review and continues once a person approves and it is sent', async () => {
    const journeyId = await publish([welcome(), done]);
    const ola = await contact();
    const id = await enroll(journeyId, ola.id);
    await worker.tick();

    const [proposal] = await proposalsFor(ola.id);
    expect(proposal).toMatchObject({ kind: 'journey', status: 'pending', journeyEnrollmentId: id });
    expect((await enrollment(id)).state).toBe('waiting');

    const pending = await asAgent(() => outreach.getProposal(proposal!.id));
    await runAs(person, () =>
      outreach.approveProposal(proposal!.id, {
        fingerprint: pending.draftFingerprint,
        publicBaseUrl: 'https://api.acme.test',
      }),
    );
    await worker.tick();
    await worker.tick();

    const after = await enrollment(id);
    expect(after).toMatchObject({ state: 'done', exitReason: 'reached_end' });
    expect(after.conversationId).not.toBeNull();
    const [message] = await db
      .select()
      .from(schema.convMessages)
      .where(eq(schema.convMessages.conversationId, after.conversationId!));
    expect(message!.bodyHtml).toContain('<strong>velkommen</strong>');
    expect(String((message!.metadata).listUnsubscribeUrl)).toContain('unsubscribe');
  });

  it('sends an auto email without review and keeps one proposal per step across repeated ticks', async () => {
    const journeyId = await publish([welcome({ approval: 'auto' }), done]);
    const ola = await contact();
    const id = await enroll(journeyId, ola.id);
    await Promise.all([worker.tick(), worker.tick()]);
    await worker.tick();
    const proposals = await proposalsFor(ola.id);
    expect(proposals).toHaveLength(1);
    expect(proposals[0]).toMatchObject({ status: 'sent', decidedByActorType: 'system' });
    expect((await enrollment(id)).state).toBe('done');
  });

  it('ends the run when a reviewer dismisses the email', async () => {
    const journeyId = await publish([welcome(), done]);
    const ola = await contact();
    const id = await enroll(journeyId, ola.id);
    await worker.tick();
    const [proposal] = await proposalsFor(ola.id);
    await runAs(person, () => outreach.dismissProposal({ id: proposal!.id, reason: 'not now' }));
    await worker.tick();
    expect(await enrollment(id)).toMatchObject({ state: 'exited', exitReason: 'proposal_dismissed' });
  });

  it('never sends marketing to an unsubscribed contact, but lets transactional email through', async () => {
    const journeyId = await publish([welcome({ approval: 'auto' }), done]);
    const gone = await contact({ unsubscribedAt: new Date() });
    const goneRun = await enroll(journeyId, gone.id);
    await worker.tick();
    expect(await enrollment(goneRun)).toMatchObject({ exitReason: 'message_blocked' });

    const receipts = await publish([welcome({ approval: 'auto', class: 'transactional' }), done]);
    const receiptRun = await enroll(receipts, gone.id);
    await worker.tick();
    expect(await enrollment(receiptRun)).toMatchObject({ state: 'done', exitReason: 'reached_end' });
  });

  it('holds marketing while the contact is talking to the team', async () => {
    const journeyId = await publish([welcome({ approval: 'auto' }), done], { cooldownHoursAfterConversation: 24 });
    const ola = await contact();
    const [convContact] = await db
      .insert(schema.convContacts)
      .values({ orgId, email: ola.email, endUserId: ola.endUserId })
      .returning();
    const [channel] = await db.select().from(schema.convChannels).where(eq(schema.convChannels.orgId, orgId));
    const [conversation] = await db
      .insert(schema.convConversations)
      .values({ orgId, displayId: 9001, channelId: channel!.id, contactId: convContact!.id, endUserId: ola.endUserId, status: 'open' })
      .returning();
    await db.insert(schema.convMessages).values({
      orgId,
      conversationId: conversation!.id,
      authorType: 'end_user',
      authorId: ola.endUserId!,
      body: 'Hei, jeg har et spørsmål om faktura',
    });

    const id = await enroll(journeyId, ola.id);
    await worker.tick();
    const [proposal] = await proposalsFor(ola.id);
    expect(proposal).toMatchObject({ status: 'approved' });
    expect(proposal!.scheduledSendAt!.getTime()).toBeGreaterThan(Date.now() + 23 * 3_600_000);
    expect((await enrollment(id)).state).toBe('waiting');
  });

  it('follows onReply when the contact answers, and otherwise waits for the thread to close', async () => {
    const withReply = await publish([
      welcome({ approval: 'auto', next: 'wait', onReply: 'replied' }),
      { id: 'wait', type: 'wait', duration: 'P7D', next: 'done' },
      { id: 'replied', type: 'exit', reason: 'replied' },
      done,
    ]);
    const plain = await publish([
      welcome({ approval: 'auto', next: 'wait' }),
      { id: 'wait', type: 'wait', duration: 'PT1M', next: 'done' },
      done,
    ]);
    const kari = await contact();
    const ola = await contact();
    const kariRun = await enroll(withReply, kari.id);
    const olaRun = await enroll(plain, ola.id);
    await worker.tick();

    for (const runId of [kariRun, olaRun]) {
      const run = await enrollment(runId);
      await asAgent(() =>
        webhooks.emit({
          type: 'conversation.message.received',
          payload: { conversationId: run.conversationId, messageId: randomUUID(), authorType: 'end_user' },
        }),
      );
    }
    await worker.tick(new Date(Date.now() + 5 * 60_000));
    await worker.tick(new Date(Date.now() + 5 * 60_000));
    expect(await enrollment(kariRun)).toMatchObject({ exitReason: 'replied' });
    const held = await enrollment(olaRun);
    expect(held.state).toBe('waiting');
    expect(held.context).toMatchObject({ lastReply: { conversationId: held.conversationId } });

    await asAgent(() =>
      webhooks.emit({
        type: 'conversation.status_changed',
        payload: { conversationId: held.conversationId, status: 'closed' },
      }),
    );
    await worker.tick(new Date(Date.now() + 5 * 60_000));
    await worker.tick(new Date(Date.now() + 5 * 60_000));
    expect(await enrollment(olaRun)).toMatchObject({ state: 'done', exitReason: 'reached_end' });
  });

  it('files an agent-written draft with its sources for review, or the reference version if the agent is silent', async () => {
    const drafted = welcome({
      draftBy: 'agent',
      brief: 'Welcome them and suggest the feature that fits their plan.',
      grounding: ['product'],
      draftInputs: ['contact'],
    });
    const journeyId = await publish([drafted, done]);
    const kari = await contact({ name: 'Kari Nordmann' });
    const ola = await contact({ name: 'Ola Nordmann' });
    const kariRun = await enroll(journeyId, kari.id);
    const olaRun = await enroll(journeyId, ola.id);
    await worker.tick();

    const jobs = await db.select().from(schema.curatorJobs).where(eq(schema.curatorJobs.orgId, orgId));
    expect(jobs.map((j) => j.jobUri)).toEqual(['skill://journeys/draft-step', 'skill://journeys/draft-step']);
    expect(jobs[0]!.userPrompt).toContain('Welcome them and suggest the feature that fits their plan.');
    const [kariStep] = await db
      .select()
      .from(schema.journeyStepRuns)
      .where(eq(schema.journeyStepRuns.enrollmentId, kariRun));
    const curator = new ActorIdentity('admin_agent', 'curator-runner', orgId, ['*'], ['admin']);
    await runAs(curator, () =>
      runtime.submitDraft({
        stepRunId: kariStep!.id,
        subject: 'Kari, start with dashboards',
        body: 'Hei Kari! Dashboards are included in Pro.',
        citations: [{ title: 'Pro plan', source: 'kbd_pro' }],
      }),
    );
    await worker.tick();
    const [kariProposal] = await proposalsFor(kari.id);
    expect(kariProposal).toMatchObject({ status: 'pending', draftSubject: 'Kari, start with dashboards' });
    expect(kariProposal!.evidence).toMatchObject({ draftedBy: 'agent', citations: [{ title: 'Pro plan', source: 'kbd_pro' }] });

    await worker.tick(new Date(Date.now() + 31 * 60_000));
    await worker.tick(new Date(Date.now() + 31 * 60_000));
    const [olaProposal] = await proposalsFor(ola.id);
    expect(olaProposal).toMatchObject({ status: 'pending', draftSubject: 'Velkommen til Acme' });
    expect(olaProposal!.evidence).toMatchObject({ draftedBy: 'fallback_content' });
    expect((await enrollment(olaRun)).state).toBe('waiting');
  });

  it('mixes email and SMS in one journey, with every SMS approved by a person and replies followed on its own thread', async () => {
    const [sms] = await db
      .insert(schema.convChannels)
      .values({
        orgId,
        type: 'sms',
        vendor: 'twilio',
        name: 'journey-sms',
        active: true,
        config: { accountSid: 'AC_test', encryptedAuthToken: 'fake', fromNumber: '+15550001111' },
      })
      .returning();
    const journeyId = await publish(
      [
        welcome({ approval: 'auto', next: 'remind' }),
        {
          id: 'remind',
          type: 'message',
          channel: 'sms',
          content: { body: 'Hei {{name|der}}, webinaret starter i morgen kl. 10.' },
          next: 'wait',
          onReply: 'replied',
        },
        { id: 'wait', type: 'wait', duration: 'P1D', next: 'done' },
        { id: 'replied', type: 'exit', reason: 'replied' },
        done,
      ],
      { smsChannelId: sms!.id },
    );
    const ola = await contact({ phone: '+4791234567' });
    const id = await enroll(journeyId, ola.id);
    await worker.tick();
    await worker.tick();

    const proposals = await proposalsFor(ola.id);
    const text = proposals.find((p) => p.channelId === sms!.id)!;
    expect(text).toMatchObject({ kind: 'journey', status: 'pending', draftSubject: null });
    const pending = await asAgent(() => outreach.getProposal(text.id));
    expect(pending.delivery).toMatchObject({ channelType: 'sms', destination: '+4791234567' });
    await expect(
      asAgent(() =>
        outreach.approveProposal(text.id, { fingerprint: pending.draftFingerprint, publicBaseUrl: 'https://api.acme.test' }),
      ),
    ).rejects.toThrow(/signed-in person/);

    await runAs(person, () =>
      outreach.approveProposal(text.id, { fingerprint: pending.draftFingerprint, publicBaseUrl: 'https://api.acme.test' }),
    );
    await worker.tick();
    const [sent] = await db.select().from(schema.outreachProposals).where(eq(schema.outreachProposals.id, text.id));
    const [thread] = await db
      .select()
      .from(schema.convConversations)
      .where(eq(schema.convConversations.id, sent!.conversationId!));
    expect(thread!.channelId).toBe(sms!.id);
    const [message] = await db
      .select({ body: schema.convMessages.body })
      .from(schema.convMessages)
      .where(eq(schema.convMessages.conversationId, thread!.id));
    expect(message!.body).toBe('Hei Ola Nordmann, webinaret starter i morgen kl. 10. Reply STOP to opt out.');
    const run = await enrollment(id);
    expect(run.conversationId).not.toBe(thread!.id);
    expect(run.currentNode).toBe('wait');

    await asAgent(() =>
      webhooks.emit({
        type: 'conversation.message.received',
        payload: { conversationId: thread!.id, messageId: randomUUID(), authorType: 'end_user' },
      }),
    );
    await worker.tick(new Date(Date.now() + 5 * 60_000));
    await worker.tick(new Date(Date.now() + 5 * 60_000));
    expect(await enrollment(id)).toMatchObject({ exitReason: 'replied' });
  });

  it('pauses a step whose bounce rate breaks the guardrail, holds new arrivals there and releases them on resume', async () => {
    const journeyId = await publish(
      [welcome({ approval: 'auto', next: 'wait' }), { id: 'wait', type: 'wait', duration: 'P7D', next: 'done' }, done],
      { guardrails: { minVolume: 10, bounceRatePct: 5 } },
    );
    const people = await Promise.all(Array.from({ length: 10 }, () => contact()));
    for (const person of people) await enroll(journeyId, person.id);
    await worker.tick();
    await worker.tick();
    const runs = await db.select().from(schema.journeyEnrollments).where(eq(schema.journeyEnrollments.journeyId, journeyId));
    for (const run of runs.slice(0, 2)) {
      await asAgent(() =>
        webhooks.emit({
          type: 'conversation.message.bounced',
          payload: { conversationId: run.conversationId, address: 'gone@kunde.test', severity: 'hard' },
        }),
      );
    }

    const report = await asAgent(() => monitor.report(journeyId));
    expect(report.nodes.find((n) => n.nodeId === 'welcome')).toMatchObject({
      sends: 10,
      bounces: 2,
      bounceRatePct: 20,
      breaches: ['bounce'],
      paused: false,
    });
    expect(await worker.runMonitor(new Date(), true)).toBe(1);
    const paused = await asAgent(() => journeys.get(journeyId));
    expect(paused.status).toBe('live');
    expect(paused.pausedNodes.welcome).toMatchObject({ reason: 'guardrail', metric: 'bounce', rate: 20 });
    const [alert] = await db.select().from(schema.orgAlerts).where(eq(schema.orgAlerts.orgId, orgId));
    expect(alert).toMatchObject({ source: 'journeys', subjectId: journeyId, severity: 'error' });
    expect(await worker.runMonitor(new Date(), true)).toBe(0);

    const late = await contact();
    const lateRun = await enroll(journeyId, late.id);
    await worker.tick();
    expect(await proposalsFor(late.id)).toEqual([]);
    expect(await enrollment(lateRun)).toMatchObject({ state: 'active', currentNode: 'welcome', nextRunAt: null });

    await expect(asAgent(() => journeys.resumeNode(journeyId, 'wait'))).rejects.toThrow(/not paused/);
    const resumed = await asAgent(() => journeys.resumeNode(journeyId, 'welcome'));
    expect(resumed.released).toBe(1);
    await worker.tick();
    expect(await proposalsFor(late.id)).toHaveLength(1);
  });

  it('keeps legacy outreach off a journey-run campaign and journey emails out of exports', async () => {
    const journeyId = await publish([welcome({ approval: 'auto' }), done]);
    const ola = await contact();
    await enroll(journeyId, ola.id);
    await worker.tick();
    await expect(
      asAgent(() =>
        outreach.proposeInitial({ campaignId, contactId: ola.id, draftSubject: 'Hei', draftBody: 'Hei!' }),
      ),
    ).rejects.toThrow(/outreach_journey_managed/);
    const exported = await asAgent(() => outreach.exportOutreach());
    expect(exported.proposals.filter((p) => p.contactId === ola.id)).toEqual([]);
    const sentEvents = await db
      .select()
      .from(schema.events)
      .where(and(eq(schema.events.orgId, orgId), eq(schema.events.type, 'outreach.proposal.sent')));
    expect(sentEvents[0]!.payload).toMatchObject({ kind: 'journey', autoApproved: true });
  });
});
