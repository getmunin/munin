import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  ActorIdentity,
  WebhookDispatcher,
  withContext,
  type RequestContext,
} from '@getmunin/core';
import { createDb, runMigrations, schema } from '@getmunin/db';
import { eq, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { ConflictException } from '@nestjs/common';
import {
  MAX_EXTRACTION_FIELDS,
  MAX_SEND_ATTEMPTS,
  OutreachService,
  OutreachInvalidError,
  SEND_WORKER_ACTOR_ID,
  SMS_DRAFT_MAX_CHARS,
  type ExtractionField,
} from './outreach.service.ts';
import {
  OutreachOutcomeSink,
  type JobEnqueuer,
} from './outreach-outcome.sink.ts';
import { CrmService } from '../crm/crm.service.ts';
import { DefaultQuotasService } from '../../common/quotas/quotas.service.ts';
import { ConvService } from '../conv/conv.service.ts';
import { AlertsService } from '../system-alerts/system-alerts.service.ts';
import { VapiClientService } from '../conv/vapi/vapi-client.service.ts';
import { VapiOutreachCaller } from '../conv/vapi/vapi-outreach-caller.ts';
import { ThrellClientService } from '../conv/threll/threll-client.service.ts';
import { ThrellOutreachCaller } from '../conv/threll/threll-outreach-caller.ts';
import { VapiService } from '../conv/vapi/vapi.service.ts';
import { ConversationClaimsService } from '../conv/conv.claims.service.ts';
import { CuratorJobsService } from '../curator/curator-jobs.service.ts';
import { EmailService } from '../conv/email/email.service.ts';

const TEST_URL = process.env.TEST_DATABASE_URL;
const skipReason = TEST_URL
  ? null
  : 'Set TEST_DATABASE_URL to a Postgres URL to run outreach service tests.';

(skipReason ? describe.skip : describe)('OutreachService', () => {
  let db: ReturnType<typeof createDb>;
  let appDb: ReturnType<typeof createDb>;
  let svc: OutreachService;
  let crm: CrmService;
  let conv: ConvService;
  let orgId: string;
  let actor: ActorIdentity;
  let segmentId: string;
  let channelId: string;
  let contactId: string;

  beforeAll(async () => {
    process.env.MUNIN_KEY_PEPPER ??= 'test-pepper';
    await runMigrations(TEST_URL!);
    db = createDb(TEST_URL!, { serviceRole: true });
    const appUrl = TEST_URL!.replace(/(postgres(?:ql)?:\/\/)[^:@]+:[^@]+@/, '$1munin_app:munin_app@');
    appDb = createDb(appUrl);

    const [org] = await db
      .insert(schema.orgs)
      .values({ name: 'Outreach Test Org' })
      .returning();
    orgId = org!.id;
    actor = new ActorIdentity('admin_agent', 'agt_outreach_test', orgId, ['*'], ['admin']);

    const dispatcher = new WebhookDispatcher();
    crm = new CrmService(dispatcher, new DefaultQuotasService());
    const claims = new ConversationClaimsService(dispatcher);
    const curatorJobs = new CuratorJobsService(dispatcher);
    conv = new ConvService(dispatcher, claims, curatorJobs, new AlertsService(dispatcher));
    const email = new EmailService();
    const vapiCaller = new VapiOutreachCaller(new VapiClientService(db));
    const threllCaller = new ThrellOutreachCaller(new ThrellClientService(db));
    svc = new OutreachService(
      dispatcher,
      conv,
      crm,
      email,
      [vapiCaller, threllCaller],
      db,
      curatorJobs,
    );
  });

  afterAll(async () => {
    if (db) {
      await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
      await db.delete(schema.orgs).where(sql`id = ${orgId}`);
    }
  });

  beforeEach(async () => {
    await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
    await db.execute(sql`DELETE FROM curator_jobs WHERE org_id = ${orgId}`);
    await db.execute(sql`DELETE FROM outreach_proposals WHERE org_id = ${orgId}`);
    await db.execute(sql`DELETE FROM outreach_campaigns WHERE org_id = ${orgId}`);
    await db.execute(sql`DELETE FROM conv_message_deliveries WHERE org_id = ${orgId}`);
    await db.execute(sql`DELETE FROM conv_messages WHERE org_id = ${orgId}`);
    await db.execute(sql`DELETE FROM conv_conversations WHERE org_id = ${orgId}`);
    await db.execute(sql`DELETE FROM conv_contacts WHERE org_id = ${orgId}`);
    await db.execute(sql`DELETE FROM conv_channels WHERE org_id = ${orgId}`);
    await db.execute(sql`DELETE FROM crm_activities WHERE org_id = ${orgId}`);
    await db.execute(sql`DELETE FROM crm_contacts WHERE org_id = ${orgId}`);
    await db.execute(sql`DELETE FROM crm_segments WHERE org_id = ${orgId}`);

    const [ch] = await db
      .insert(schema.convChannels)
      .values({
        orgId,
        type: 'email',
        vendor: 'smtp',
        name: 'support',
        active: true,
        config: { addressing: { fromAddress: 'support@example.com' } },
      })
      .returning();
    channelId = ch!.id;

    const [seg] = await db
      .insert(schema.crmSegments)
      .values({
        orgId,
        name: 'priority-prospects',
        description: null,
        filterDefinition: { tagsAny: ['priority'] },
        createdByActorType: actor.type,
        createdByActorId: actor.id,
      })
      .returning();
    segmentId = seg!.id;

    const [contact] = await db
      .insert(schema.crmContacts)
      .values({
        orgId,
        name: 'Jane Doe',
        email: 'jane@acme.com',
        consentLawfulBasis: 'legitimate_interest',
        consentGivenAt: new Date(),
        consentSource: 'imported-test',
        tags: ['priority'],
      })
      .returning();
    contactId = contact!.id;
  });

  function run<T>(fn: () => Promise<T>): Promise<T> {
    return runAs(actor, fn);
  }

  function runAs<T>(as: ActorIdentity, fn: () => Promise<T>): Promise<T> {
    return appDb.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.bypass_rls', 'off', true)`);
      await tx.execute(sql`SELECT set_config('app.org_id', ${orgId}, true)`);
      const ctx: RequestContext = {
        db: tx,
        actor: as,
        correlationId: randomUUID(),
      };
      return withContext(ctx, fn);
    });
  }

  describe('campaigns', () => {
    it('creates a campaign with valid segment + email channel', async () => {
      const c = await run(() =>
        svc.createCampaign({
          name: 'Q2 outreach',
          brief: 'Re-engage prospects who showed interest last quarter.',
          segmentId,
          channelId,
        }),
      );
      expect(c.name).toBe('Q2 outreach');
      expect(c.enabled).toBe(false);
      expect(c.unsubscribeRequired).toBe(true);
    });

    it('rejects a campaign whose channel is not email', async () => {
      const [ch] = await db
        .insert(schema.convChannels)
        .values({ orgId, type: 'chat', vendor: 'munin', name: 'web-widget', active: true, config: {} })
        .returning();
      await expect(
        run(() =>
          svc.createCampaign({
            name: 'Wrong channel',
            brief: 'x',
            segmentId,
            channelId: ch!.id,
          }),
        ),
      ).rejects.toThrow(OutreachInvalidError);
    });

    it('rejects duplicate campaign names per org', async () => {
      await run(() =>
        svc.createCampaign({ name: 'dup', brief: 'a', segmentId, channelId }),
      );
      await expect(
        run(() => svc.createCampaign({ name: 'dup', brief: 'b', segmentId, channelId })),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('proposals', () => {
    it('proposeInitial → listProposals → approve sends and updates status', async () => {
      const c = await run(() =>
        svc.createCampaign({
          name: 'launch',
          brief: 'Reach out to priority prospects.',
          segmentId,
          channelId,
          enabled: true,
        }),
      );
      const p = await run(() =>
        svc.proposeInitial({
          campaignId: c.id,
          contactId,
          draftSubject: 'Hi Jane',
          draftBody: 'We just shipped X — would you like a quick demo?',
          evidence: { source: 'unit-test' },
        }),
      );
      expect(p.status).toBe('pending');
      expect(p.kind).toBe('initial');
      expect(p.contact?.email).toBe('jane@acme.com');
      expect(p.campaign?.name).toBe('launch');

      const pending = await run(() => svc.listProposals({ status: 'pending' }));
      expect(pending).toHaveLength(1);
      expect(pending[0]!.contact?.email).toBe('jane@acme.com');
      expect(pending[0]!.campaign?.name).toBe('launch');
      expect(pending[0]!).not.toHaveProperty('evidence');
      expect(pending[0]!.hasEvidence).toBe(true);
      expect(pending[0]!.draftBody).toBe('We just shipped X — would you like a quick demo?');

      const full = await run(() => svc.getProposal(p.id));
      expect(full.evidence).toEqual({ source: 'unit-test' });

      const approved = await run(() =>
        svc.approveProposal(p.id, {
          publicBaseUrl: 'https://test.local',
          fingerprint: p.draftFingerprint,
        }),
      );
      expect(approved.status).toBe('sent');
      expect(approved.conversationId).toBeTruthy();
      expect(approved.sentMessageId).toBeTruthy();
      expect(approved.contact?.email).toBe('jane@acme.com');
      expect(approved.campaign?.name).toBe('launch');

      const convRows = await db.execute<{ outreach_campaign_id: string | null }>(
        sql`SELECT outreach_campaign_id FROM conv_conversations WHERE id = ${approved.conversationId!}`,
      );
      expect(convRows[0]!.outreach_campaign_id).toBe(c.id);

      const msgRows = await db.execute<{ body: string }>(
        sql`SELECT body FROM conv_messages WHERE id = ${approved.sentMessageId!}`,
      );
      expect(msgRows[0]!.body).toContain('[Unsubscribe](https://test.local/v1/outreach/unsubscribe?token=');

      const delivery = await db.execute<{ count: number }>(
        sql`SELECT COUNT(*)::int AS count FROM conv_message_deliveries WHERE message_id = ${approved.sentMessageId!}`,
      );
      expect(delivery[0]!.count).toBe(1);
    });

    it('approve refuses when contact unsubscribed between draft and approval', async () => {
      const c = await run(() =>
        svc.createCampaign({
          name: 'race',
          brief: 'Race test.',
          segmentId,
          channelId,
          enabled: true,
        }),
      );
      const p = await run(() =>
        svc.proposeInitial({
          campaignId: c.id,
          contactId,
          draftSubject: 'subject',
          draftBody: 'body',
        }),
      );
      await run(() =>
        crm.updateContact({ id: contactId, patch: { doNotContact: true } }),
      );
      await expect(
        run(() => svc.approveProposal(p.id, { publicBaseUrl: 'https://test.local', fingerprint: p.draftFingerprint })),
      ).rejects.toThrow(OutreachInvalidError);
    });

    it('approve refuses when campaign is disabled', async () => {
      const c = await run(() =>
        svc.createCampaign({
          name: 'paused',
          brief: 'paused brief',
          segmentId,
          channelId,
          enabled: false,
        }),
      );
      const p = await run(() =>
        svc.proposeInitial({
          campaignId: c.id,
          contactId,
          draftSubject: 'subject',
          draftBody: 'body',
        }),
      );
      await expect(
        run(() => svc.approveProposal(p.id, { publicBaseUrl: 'https://test.local', fingerprint: p.draftFingerprint })),
      ).rejects.toThrow(OutreachInvalidError);
    });

    it('proposeInitial rejects a contact without consent', async () => {
      await db
        .update(schema.crmContacts)
        .set({ consentLawfulBasis: null, consentGivenAt: null })
        .where(eq(schema.crmContacts.id, contactId));
      const c = await run(() =>
        svc.createCampaign({ name: 'noc', brief: 'b', segmentId, channelId, enabled: true }),
      );
      await expect(
        run(() =>
          svc.proposeInitial({
            campaignId: c.id,
            contactId,
            draftSubject: 's',
            draftBody: 'b',
          }),
        ),
      ).rejects.toThrow(OutreachInvalidError);
    });

    it('proposeInitial enforces uniqueness on (campaign, contact, kind=initial) while pending', async () => {
      const c = await run(() =>
        svc.createCampaign({ name: 'dup', brief: 'b', segmentId, channelId, enabled: true }),
      );
      await run(() =>
        svc.proposeInitial({
          campaignId: c.id,
          contactId,
          draftSubject: 's',
          draftBody: 'b',
        }),
      );
      await expect(
        run(() =>
          svc.proposeInitial({
            campaignId: c.id,
            contactId,
            draftSubject: 's2',
            draftBody: 'b2',
          }),
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('approveProposal initial flips conversation to agentMode=draft_only', async () => {
      const c = await run(() =>
        svc.createCampaign({ name: 'mode', brief: 'b', segmentId, channelId, enabled: true }),
      );
      const p = await run(() =>
        svc.proposeInitial({
          campaignId: c.id,
          contactId,
          draftSubject: 's',
          draftBody: 'b',
        }),
      );
      const approved = await run(() =>
        svc.approveProposal(p.id, { publicBaseUrl: 'https://test.local', fingerprint: p.draftFingerprint }),
      );
      const rows = await db.execute<{ agent_mode: string }>(
        sql`SELECT agent_mode FROM conv_conversations WHERE id = ${approved.conversationId!}`,
      );
      expect(rows[0]!.agent_mode).toBe('draft_only');
    });

    it('proposeReply files a kind=reply proposal on an outreach conversation', async () => {
      const c = await run(() =>
        svc.createCampaign({ name: 'reply-a', brief: 'b', segmentId, channelId, enabled: true }),
      );
      const initial = await run(() =>
        svc.proposeInitial({
          campaignId: c.id,
          contactId,
          draftSubject: 's',
          draftBody: 'b',
        }),
      );
      const sent = await run(() =>
        svc.approveProposal(initial.id, { publicBaseUrl: 'https://test.local', fingerprint: initial.draftFingerprint }),
      );
      const reply = await run(() =>
        svc.proposeReply({
          conversationId: sent.conversationId!,
          draftBody: 'Thanks for getting back to us — yes, we integrate with Slack.',
          evidence: { intent: 'question_about_integration' },
        }),
      );
      expect(reply.kind).toBe('reply');
      expect(reply.status).toBe('pending');
      expect(reply.conversationId).toBe(sent.conversationId);
      expect(reply.contactId).toBe(contactId);
    });

    it('approveProposal reply sends via sendMessage on the existing conversation (no unsubscribe footer)', async () => {
      const c = await run(() =>
        svc.createCampaign({ name: 'reply-b', brief: 'b', segmentId, channelId, enabled: true }),
      );
      const initial = await run(() =>
        svc.proposeInitial({
          campaignId: c.id,
          contactId,
          draftSubject: 's',
          draftBody: 'b',
        }),
      );
      const sent = await run(() =>
        svc.approveProposal(initial.id, { publicBaseUrl: 'https://test.local', fingerprint: initial.draftFingerprint }),
      );
      const reply = await run(() =>
        svc.proposeReply({
          conversationId: sent.conversationId!,
          draftBody: 'Sure — Tuesday works.',
        }),
      );
      const approved = await run(() =>
        svc.approveProposal(reply.id, { publicBaseUrl: 'https://test.local', fingerprint: reply.draftFingerprint }),
      );
      expect(approved.status).toBe('sent');
      expect(approved.conversationId).toBe(sent.conversationId);
      expect(approved.sentMessageId).toBeTruthy();

      const msgRows = await db.execute<{ body: string }>(
        sql`SELECT body FROM conv_messages WHERE id = ${approved.sentMessageId!}`,
      );
      expect(msgRows[0]!.body).toBe('Sure — Tuesday works.');
      expect(msgRows[0]!.body).not.toMatch(/Unsubscribe:/);
    });

    it('proposeReply rejects when the conversation has no outreachCampaignId', async () => {
      const ch = await run(() =>
        svc.createCampaign({ name: 'plain', brief: 'b', segmentId, channelId, enabled: true }),
      );
      void ch;
      const [plain] = await db
        .insert(schema.convConversations)
        .values({
          orgId,
          channelId,
          displayId: 99999,
          status: 'open',
        })
        .returning();
      await expect(
        run(() =>
          svc.proposeReply({
            conversationId: plain!.id,
            draftBody: 'irrelevant',
          }),
        ),
      ).rejects.toThrow(OutreachInvalidError);
    });

    it('dismissProposal marks pending→dismissed', async () => {
      const c = await run(() =>
        svc.createCampaign({ name: 'd', brief: 'b', segmentId, channelId, enabled: true }),
      );
      const p = await run(() =>
        svc.proposeInitial({
          campaignId: c.id,
          contactId,
          draftSubject: 's',
          draftBody: 'b',
        }),
      );
      const dismissed = await run(() =>
        svc.dismissProposal({ id: p.id, reason: 'tone is off' }),
      );
      expect(dismissed.status).toBe('dismissed');
      expect(dismissed.dismissReason).toBe('tone is off');
      expect(dismissed.contact?.id).toBe(contactId);
      expect(dismissed.campaign?.name).toBe('d');
    });
  });

  describe('revise and withdraw', () => {
    function runAs<T>(as: ActorIdentity, fn: () => Promise<T>): Promise<T> {
      return appDb.transaction(async (tx) => {
        await tx.execute(sql`SELECT set_config('app.bypass_rls', 'off', true)`);
        await tx.execute(sql`SELECT set_config('app.org_id', ${orgId}, true)`);
        return withContext({ db: tx, actor: as, correlationId: randomUUID() }, fn);
      });
    }

    const reviewer = () =>
      new ActorIdentity('user', 'usr_reviewer', orgId, ['*'], ['admin'], undefined, undefined, undefined, 'usr_reviewer');

    async function pending(name: string) {
      const c = await run(() =>
        svc.createCampaign({ name, brief: 'b', segmentId, channelId, enabled: true }),
      );
      const p = await run(() =>
        svc.proposeInitial({ campaignId: c.id, contactId, draftSubject: 's', draftBody: 'first' }),
      );
      return p;
    }

    it('listProposals reports hasEvidence false when the draft was filed without evidence', async () => {
      const p = await pending('rev-no-evidence');
      const rows = await run(() => svc.listProposals({ campaignId: p.campaignId }));
      expect(rows).toHaveLength(1);
      expect(rows[0]!.hasEvidence).toBe(false);
      expect(rows[0]!).not.toHaveProperty('evidence');
      expect(await run(() => svc.getProposal(p.id)).then((f) => f.evidence)).toEqual({});
    });

    async function pendingOn(name: string, opts: { autoCurateEdits?: boolean } = {}) {
      const c = await run(() =>
        svc.createCampaign({
          name,
          brief: 'b',
          segmentId,
          channelId,
          enabled: true,
          ...(opts.autoCurateEdits === undefined ? {} : { autoCurateEdits: opts.autoCurateEdits }),
        }),
      );
      const p = await run(() =>
        svc.proposeInitial({ campaignId: c.id, contactId, draftSubject: 's', draftBody: 'first' }),
      );
      return { campaign: c, proposal: p };
    }

    async function curationJobs(): Promise<{ user_prompt: string; dedupe_key: string | null }[]> {
      return db.execute<{ user_prompt: string; dedupe_key: string | null }>(
        sql`SELECT user_prompt, dedupe_key FROM curator_jobs
            WHERE org_id = ${orgId} AND job_uri = 'skill://kb/review-content'`,
      );
    }

    it('keeps the agent draft when a human revises, so the edit stays recoverable', async () => {
      const p = await pending('rev-keeps-ai-original');
      expect(p.originalDraftBody).toBeNull();
      const revised = await runAs(reviewer(), () =>
        svc.reviseProposal({ id: p.id, reason: 'wrong rate', draftBody: 'second' }),
      );
      expect(revised.originalDraftBody).toBe('first');
      expect(revised.draftBody).toBe('second');

      const again = await runAs(reviewer(), () =>
        svc.reviseProposal({ id: p.id, reason: 'again', draftBody: 'third' }),
      );
      expect(again.originalDraftBody).toBe('first');
      expect(again.draftBody).toBe('third');
    });

    it('does not treat the curator revising its own draft as a human edit', async () => {
      const p = await pending('rev-agent-not-human');
      const revised = await run(() =>
        svc.reviseProposal({ id: p.id, reason: 'self-correct', draftBody: 'second' }),
      );
      expect(revised.originalDraftBody).toBeNull();
    });

    it('curates an approved-with-edits proposal when the campaign opts in', async () => {
      const { proposal } = await pendingOn('rev-curate-on', { autoCurateEdits: true });
      const revised = await runAs(reviewer(), () =>
        svc.reviseProposal({ id: proposal.id, reason: 'rate was wrong', draftBody: 'rate is 9.4%' }),
      );
      await runAs(reviewer(), () =>
        svc.approveProposal(revised.id, {
          publicBaseUrl: 'https://test.local',
          fingerprint: revised.draftFingerprint,
        }),
      );
      const jobs = await curationJobs();
      expect(jobs).toHaveLength(1);
      expect(jobs[0]!.dedupe_key).toBe(`kb-curation:proposal:${revised.id}`);
      expect(jobs[0]!.user_prompt).toContain('Delta mode');
      expect(jobs[0]!.user_prompt).toContain(revised.id);
    });

    it('does not curate an approved-with-edits proposal when the campaign has not opted in', async () => {
      const { proposal } = await pendingOn('rev-curate-off');
      const revised = await runAs(reviewer(), () =>
        svc.reviseProposal({ id: proposal.id, reason: 'rate was wrong', draftBody: 'rate is 9.4%' }),
      );
      await runAs(reviewer(), () =>
        svc.approveProposal(revised.id, {
          publicBaseUrl: 'https://test.local',
          fingerprint: revised.draftFingerprint,
        }),
      );
      expect(await curationJobs()).toEqual([]);
    });

    it('does not curate a proposal approved exactly as the agent drafted it', async () => {
      const { proposal } = await pendingOn('rev-curate-unedited', { autoCurateEdits: true });
      await runAs(reviewer(), () =>
        svc.approveProposal(proposal.id, {
          publicBaseUrl: 'https://test.local',
          fingerprint: proposal.draftFingerprint,
        }),
      );
      expect(await curationJobs()).toEqual([]);
    });

    it('does not curate an edit the human reverted back to the agent draft', async () => {
      const { proposal } = await pendingOn('rev-curate-reverted', { autoCurateEdits: true });
      await runAs(reviewer(), () =>
        svc.reviseProposal({ id: proposal.id, reason: 'try', draftBody: 'second' }),
      );
      const back = await runAs(reviewer(), () =>
        svc.reviseProposal({ id: proposal.id, reason: 'never mind', draftBody: 'first' }),
      );
      await runAs(reviewer(), () =>
        svc.approveProposal(back.id, {
          publicBaseUrl: 'https://test.local',
          fingerprint: back.draftFingerprint,
        }),
      );
      expect(await curationJobs()).toEqual([]);
    });

    it('reviseProposal rewrites the draft in place and records the revision', async () => {
      const p = await pending('rev-basic');
      const revised = await run(() =>
        svc.reviseProposal({ id: p.id, reason: 'tightened the CTA', draftBody: 'second' }),
      );
      expect(revised.id).toBe(p.id);
      expect(revised.campaignId).toBe(p.campaignId);
      expect(revised.contactId).toBe(p.contactId);
      expect(revised.draftBody).toBe('second');
      expect(revised.draftSubject).toBe('s');
      expect(revised.status).toBe('pending');
      expect(revised.revisionCount).toBe(1);
      expect(revised.lastRevisionReason).toBe('tightened the CTA');
      expect(revised.revisedByActorId).toBe('agt_outreach_test');
      expect(revised.lastRevisedAt).not.toBeNull();
      expect(revised.revisedAfterReviewAt).toBeNull();

      const again = await run(() =>
        svc.reviseProposal({ id: p.id, reason: 'shorter subject', draftSubject: 'brief' }),
      );
      expect(again.revisionCount).toBe(2);
      expect(again.draftBody).toBe('second');
      expect(again.draftSubject).toBe('brief');
    });

    it('reviseProposal flags a revision made after a human opened the draft', async () => {
      const p = await pending('rev-after-review');
      const viewed = await runAs(reviewer(), () => svc.markProposalViewed(p.id));
      expect(viewed.firstViewedAt).not.toBeNull();
      expect(viewed.viewedByActorId).toBe('usr_reviewer');

      const revised = await run(() =>
        svc.reviseProposal({ id: p.id, reason: 'new pricing', draftBody: 'rewritten' }),
      );
      expect(revised.revisedAfterReviewAt).not.toBeNull();
    });

    it('markProposalViewed only stamps the first human view, and ignores agent actors', async () => {
      const p = await pending('rev-view-once');
      const byAgent = await run(() => svc.markProposalViewed(p.id));
      expect(byAgent.firstViewedAt).toBeNull();

      const first = await runAs(reviewer(), () => svc.markProposalViewed(p.id));
      const second = await runAs(
        new ActorIdentity('user', 'usr_other', orgId, ['*'], ['admin']),
        () => svc.markProposalViewed(p.id),
      );
      expect(second.firstViewedAt).toBe(first.firstViewedAt);
      expect(second.viewedByActorId).toBe('usr_reviewer');
    });

    it('a reviser who is the same human who opened it is not flagged', async () => {
      const p = await pending('rev-self');
      const me = reviewer();
      await runAs(me, () => svc.markProposalViewed(p.id));
      const revised = await runAs(me, () =>
        svc.reviseProposal({ id: p.id, reason: 'my own typo', draftBody: 'fixed' }),
      );
      expect(revised.revisionCount).toBe(1);
      expect(revised.revisedAfterReviewAt).toBeNull();
    });

    it('reviseProposal rejects an empty reason, an empty body, and a no-op patch', async () => {
      const p = await pending('rev-invalid');
      await expect(
        run(() => svc.reviseProposal({ id: p.id, reason: '   ', draftBody: 'x' })),
      ).rejects.toThrow(OutreachInvalidError);
      await expect(
        run(() => svc.reviseProposal({ id: p.id, reason: 'ok', draftBody: '   ' })),
      ).rejects.toThrow(OutreachInvalidError);
      await expect(run(() => svc.reviseProposal({ id: p.id, reason: 'ok' }))).rejects.toThrow(
        OutreachInvalidError,
      );
    });

    it('reviseProposal refuses a proposal that is no longer pending', async () => {
      const p = await pending('rev-decided');
      await run(() => svc.dismissProposal({ id: p.id, reason: 'no' }));
      await expect(
        run(() => svc.reviseProposal({ id: p.id, reason: 'too late', draftBody: 'x' })),
      ).rejects.toThrow(OutreachInvalidError);
    });

    it('reviseProposal moves the draft fingerprint', async () => {
      const p = await pending('rev-fingerprint');
      const revised = await run(() =>
        svc.reviseProposal({ id: p.id, reason: 'new angle', draftBody: 'second' }),
      );
      expect(revised.draftFingerprint).not.toBe(p.draftFingerprint);
      const fetched = await run(() => svc.getProposal(p.id));
      expect(fetched.draftFingerprint).toBe(revised.draftFingerprint);
      const [listed] = await run(() => svc.listProposals({ campaignId: p.campaignId }));
      expect(listed!.draftFingerprint).toBe(revised.draftFingerprint);
    });

    it('approveProposal refuses a fingerprint from a draft that was revised since, and sends nothing', async () => {
      const p = await pending('approve-stale-fingerprint');
      await run(() =>
        svc.reviseProposal({ id: p.id, reason: 'rewrote the pitch', draftBody: 'swapped' }),
      );
      await expect(
        run(() =>
          svc.approveProposal(p.id, {
            publicBaseUrl: 'https://test.local',
            fingerprint: p.draftFingerprint,
          }),
        ),
      ).rejects.toThrow(ConflictException);
      const after = await run(() => svc.getProposal(p.id));
      expect(after.status).toBe('pending');
      expect(after.sentAt).toBeNull();
      expect(after.conversationId).toBeNull();
    });

    it('approveProposal accepts the fingerprint of the current draft after a revision', async () => {
      const p = await pending('approve-fresh-fingerprint');
      const revised = await run(() =>
        svc.reviseProposal({ id: p.id, reason: 'rewrote the pitch', draftBody: 'swapped' }),
      );
      const sent = await run(() =>
        svc.approveProposal(revised.id, {
          publicBaseUrl: 'https://test.local',
          fingerprint: revised.draftFingerprint,
        }),
      );
      expect(sent.status).toBe('sent');
      expect(sent.draftBody).toBe('swapped');
    });

    it('approveProposal refuses a garbage fingerprint', async () => {
      const p = await pending('approve-bogus-fingerprint');
      await expect(
        run(() =>
          svc.approveProposal(p.id, { publicBaseUrl: 'https://test.local', fingerprint: 'nope' }),
        ),
      ).rejects.toThrow(ConflictException);
      expect(await run(() => svc.getProposal(p.id)).then((f) => f.status)).toBe('pending');
    });

    it('withdrawProposal retracts a pending draft neutrally', async () => {
      const p = await pending('wd-basic');
      const withdrawn = await run(() =>
        svc.withdrawProposal({ id: p.id, reason: 'duplicate of an earlier draft' }),
      );
      expect(withdrawn.status).toBe('withdrawn');
      expect(withdrawn.withdrawReason).toBe('duplicate of an earlier draft');
      expect(withdrawn.dismissReason).toBeNull();
      expect(withdrawn.decidedByActorId).toBe('agt_outreach_test');
      expect(withdrawn.decidedAt).not.toBeNull();
      expect(withdrawn.sentAt).toBeNull();

      const contact = await run(() => crm.getContact(contactId));
      expect(contact.doNotContact).toBe(false);
      expect(contact.unsubscribedAt).toBeNull();
      expect(contact.consentLawfulBasis).not.toBeNull();
    });

    it('withdrawing frees the pending slot so a corrected draft can be filed', async () => {
      const p = await pending('wd-refile');
      await run(() => svc.withdrawProposal({ id: p.id, reason: 'wrong angle' }));
      const fresh = await run(() =>
        svc.proposeInitial({
          campaignId: p.campaignId,
          contactId,
          draftSubject: 's2',
          draftBody: 'corrected',
        }),
      );
      expect(fresh.id).not.toBe(p.id);
      expect(fresh.status).toBe('pending');
    });

    it('withdrawProposal rejects an empty reason and a non-pending proposal', async () => {
      const p = await pending('wd-invalid');
      await expect(run(() => svc.withdrawProposal({ id: p.id, reason: '  ' }))).rejects.toThrow(
        OutreachInvalidError,
      );
      await run(() => svc.withdrawProposal({ id: p.id, reason: 'retracted' }));
      await expect(run(() => svc.withdrawProposal({ id: p.id, reason: 'again' }))).rejects.toThrow(
        OutreachInvalidError,
      );
    });
  });

  describe('scheduled sends', () => {
    const IN_AN_HOUR = () => new Date(Date.now() + 3_600_000);
    const PUBLIC_URL = { publicBaseUrl: 'https://test.local' };
    const approveOpts = (p: { draftFingerprint: string }) => ({
      ...PUBLIC_URL,
      fingerprint: p.draftFingerprint,
    });

    function systemActor(): ActorIdentity {
      return new ActorIdentity('system', SEND_WORKER_ACTOR_ID, orgId, ['*'], ['admin']);
    }

    function humanActor(): ActorIdentity {
      return new ActorIdentity(
        'user',
        'usr_scheduled_test',
        orgId,
        ['*'],
        ['admin'],
        undefined,
        undefined,
        undefined,
        'usr_scheduled_test',
      );
    }

    async function campaign(name: string) {
      return run(() =>
        svc.createCampaign({ name, brief: 'b', segmentId, channelId, enabled: true }),
      );
    }

    async function draft(name: string, proposedSendAt?: Date) {
      const c = await campaign(name);
      const p = await run(() =>
        svc.proposeInitial({
          campaignId: c.id,
          contactId,
          draftSubject: 'Hi Jane',
          draftBody: 'body',
          ...(proposedSendAt ? { proposedSendAt: proposedSendAt.toISOString() } : {}),
        }),
      );
      return { campaign: c, proposal: p };
    }

    async function messageCount(): Promise<number> {
      const rows = await db.execute<{ count: number }>(
        sql`SELECT COUNT(*)::int AS count FROM conv_messages WHERE org_id = ${orgId}`,
      );
      return rows[0]!.count;
    }

    it('approve inherits a future proposedSendAt and sends nothing yet', async () => {
      const at = IN_AN_HOUR();
      const { proposal } = await draft('sched-inherit', at);
      const approved = await run(() => svc.approveProposal(proposal.id, approveOpts(proposal)));

      expect(approved.status).toBe('approved');
      expect(approved.scheduledSendAt).toBe(at.toISOString());
      expect(approved.sentAt).toBeNull();
      expect(approved.sentMessageId).toBeNull();
      expect(approved.conversationId).toBeNull();
      expect(approved.decidedAt).toBeTruthy();
      expect(approved.decidedByActorId).toBe(actor.id);
      expect(await messageCount()).toBe(0);
    });

    it('an explicit sendAt overrides the time on the draft', async () => {
      const at = new Date(Date.now() + 7_200_000);
      const { proposal } = await draft('sched-override', IN_AN_HOUR());
      const approved = await run(() =>
        svc.approveProposal(proposal.id, { ...approveOpts(proposal), sendAt: at.toISOString() }),
      );
      expect(approved.scheduledSendAt).toBe(at.toISOString());
    });

    it('sendAt null sends now even though the draft proposes a later time', async () => {
      const { proposal } = await draft('sched-now', IN_AN_HOUR());
      const approved = await run(() =>
        svc.approveProposal(proposal.id, { ...approveOpts(proposal), sendAt: null }),
      );
      expect(approved.status).toBe('sent');
      expect(approved.scheduledSendAt).toBeNull();
      expect(approved.sentMessageId).toBeTruthy();
    });

    it('a proposedSendAt that has already passed sends now', async () => {
      const { proposal } = await draft('sched-stale');
      await db
        .update(schema.outreachProposals)
        .set({ proposedSendAt: new Date(Date.now() - 60_000) })
        .where(eq(schema.outreachProposals.id, proposal.id));
      const stale = await run(() => svc.getProposal(proposal.id));
      const approved = await run(() => svc.approveProposal(proposal.id, approveOpts(stale)));
      expect(approved.status).toBe('sent');
    });

    it('an explicit sendAt in the past is refused', async () => {
      const { proposal } = await draft('sched-past');
      await expect(
        run(() =>
          svc.approveProposal(proposal.id, {
            ...approveOpts(proposal),
            sendAt: new Date(Date.now() - 60_000).toISOString(),
          }),
        ),
      ).rejects.toThrow(/must be in the future/);
    });

    it('the worker delivers a scheduled send and credits the approver as author', async () => {
      const { proposal } = await draft('sched-deliver', IN_AN_HOUR());
      const approver = humanActor();
      const approved = await runAs(approver, () => svc.approveProposal(proposal.id, approveOpts(proposal)));
      expect(approved.status).toBe('approved');

      const result = await runAs(systemActor(), () =>
        svc.sendScheduledProposal(proposal.id, PUBLIC_URL),
      );
      expect(result.outcome).toBe('sent');
      expect(result.proposal.status).toBe('sent');
      expect(result.proposal.sentMessageId).toBeTruthy();
      expect(result.proposal.decidedByActorId).toBe(approver.id);
      expect(result.proposal.decidedAt).toBe(approved.decidedAt);

      const rows = await db.execute<{ author_id: string; author_type: string }>(
        sql`SELECT author_id, author_type FROM conv_messages WHERE id = ${result.proposal.sentMessageId!}`,
      );
      expect(rows[0]!.author_id).toBe(approver.id);
    });

    it('the worker skips a proposal that is no longer approved', async () => {
      const { proposal } = await draft('sched-skip');
      const result = await runAs(systemActor(), () =>
        svc.sendScheduledProposal(proposal.id, PUBLIC_URL),
      );
      expect(result.outcome).toBe('skipped');
      expect(await messageCount()).toBe(0);
    });

    it('a contact suppressed after approval is never delivered to', async () => {
      const { proposal } = await draft('sched-suppressed', IN_AN_HOUR());
      await run(() => svc.approveProposal(proposal.id, approveOpts(proposal)));
      await run(() => crm.updateContact({ id: contactId, patch: { doNotContact: true } }));

      await expect(
        runAs(systemActor(), () => svc.sendScheduledProposal(proposal.id, PUBLIC_URL)),
      ).rejects.toThrow(OutreachInvalidError);
      expect(await messageCount()).toBe(0);

      const failed = await runAs(systemActor(), () =>
        svc.recordScheduledSendFailure(proposal.id, 'contact is no longer eligible', {
          terminal: true,
        }),
      );
      expect(failed.status).toBe('failed');
      expect(failed.failureReason).toBe('contact is no longer eligible');
      expect(failed.sendAttempts).toBe(1);
    });

    it('a transient failure retries until MAX_SEND_ATTEMPTS, then gives up', async () => {
      const { proposal } = await draft('sched-retry', IN_AN_HOUR());
      await run(() => svc.approveProposal(proposal.id, approveOpts(proposal)));

      for (let attempt = 1; attempt < MAX_SEND_ATTEMPTS; attempt += 1) {
        const held = await runAs(systemActor(), () =>
          svc.recordScheduledSendFailure(proposal.id, 'smtp unreachable', { terminal: false }),
        );
        expect(held.status).toBe('approved');
        expect(held.sendAttempts).toBe(attempt);
      }

      const gaveUp = await runAs(systemActor(), () =>
        svc.recordScheduledSendFailure(proposal.id, 'smtp unreachable', { terminal: false }),
      );
      expect(gaveUp.status).toBe('failed');
      expect(gaveUp.sendAttempts).toBe(MAX_SEND_ATTEMPTS);
      expect(gaveUp.failureReason).toBe('smtp unreachable');
    });

    it('cancelScheduledSend returns the draft to the review queue and clears the approval', async () => {
      const { proposal } = await draft('sched-cancel', IN_AN_HOUR());
      await run(() => svc.approveProposal(proposal.id, approveOpts(proposal)));

      const canceled = await run(() =>
        svc.cancelScheduledSend({ id: proposal.id, reason: 'wrong week' }),
      );
      expect(canceled.status).toBe('pending');
      expect(canceled.scheduledSendAt).toBeNull();
      expect(canceled.decidedAt).toBeNull();
      expect(canceled.decidedByActorId).toBeNull();
      expect(await messageCount()).toBe(0);

      const pendingRows = await run(() => svc.listProposals({ status: 'pending' }));
      expect(pendingRows.map((p) => p.id)).toContain(proposal.id);
    });

    it('cancelScheduledSend refuses a pending draft, a sent proposal, and an empty reason', async () => {
      const { proposal } = await draft('sched-cancel-invalid', IN_AN_HOUR());
      await expect(
        run(() => svc.cancelScheduledSend({ id: proposal.id, reason: 'not scheduled yet' })),
      ).rejects.toThrow(/not a scheduled send/);

      await run(() => svc.approveProposal(proposal.id, approveOpts(proposal)));
      await expect(
        run(() => svc.cancelScheduledSend({ id: proposal.id, reason: '  ' })),
      ).rejects.toThrow(/reason must be non-empty/);

      await runAs(systemActor(), () => svc.sendScheduledProposal(proposal.id, PUBLIC_URL));
      await expect(
        run(() => svc.cancelScheduledSend({ id: proposal.id, reason: 'too late' })),
      ).rejects.toThrow(/not a scheduled send/);
    });

    it('a scheduled first-touch blocks a fresh draft for the same contact', async () => {
      const { campaign: c, proposal } = await draft('sched-dedupe', IN_AN_HOUR());
      await run(() => svc.approveProposal(proposal.id, approveOpts(proposal)));

      await expect(
        run(() =>
          svc.proposeInitial({
            campaignId: c.id,
            contactId,
            draftSubject: 'again',
            draftBody: 'again',
          }),
        ),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('listProposals status approved orders by the soonest send', async () => {
      const later = await draft('sched-order-late', new Date(Date.now() + 7_200_000));
      const sooner = await draft('sched-order-soon', IN_AN_HOUR());
      await run(() => svc.approveProposal(later.proposal.id, approveOpts(later.proposal)));
      await run(() => svc.approveProposal(sooner.proposal.id, approveOpts(sooner.proposal)));

      const scheduled = await run(() => svc.listProposals({ status: 'approved' }));
      expect(scheduled.map((p) => p.id)).toEqual([sooner.proposal.id, later.proposal.id]);
    });

    it('holds an sms send that comes due inside a blackout date instead of failing it', async () => {
      const [channel] = await db
        .insert(schema.convChannels)
        .values({
          orgId,
          type: 'sms',
          vendor: 'twilio',
          name: 'sched-sms',
          active: true,
          config: { accountSid: 'AC_test', encryptedAuthToken: 'fake', fromNumber: '+15550001111' },
        })
        .returning();
      const [smsContact] = await db
        .insert(schema.crmContacts)
        .values({
          orgId,
          name: 'Text Me',
          email: 'blackout@example.com',
          phone: '+14155559999',
          consentLawfulBasis: 'consent',
        })
        .returning();
      const c = await run(() =>
        svc.createCampaign({
          name: 'sched-blackout',
          brief: 'b',
          segmentId,
          channelId: channel!.id,
          enabled: true,
          cadenceRules: { blackoutDates: [new Date().toISOString().slice(0, 10)] },
        }),
      );
      const p = await run(() =>
        svc.proposeInitial({
          campaignId: c.id,
          contactId: smsContact!.id,
          draftBody: 'Hei!',
          proposedSendAt: IN_AN_HOUR().toISOString(),
        }),
      );
      const approved = await runAs(humanActor(), () => svc.approveProposal(p.id, approveOpts(p)));
      expect(approved.status).toBe('approved');

      const result = await runAs(systemActor(), () => svc.sendScheduledProposal(p.id, PUBLIC_URL));
      expect(result.outcome).toBe('deferred');
      expect(result.reason).toMatch(/does not message/);
      expect(result.proposal.status).toBe('approved');
      expect(await messageCount()).toBe(0);
    });
  });

  describe('sequences', () => {
    const STEPS = [
      { waitDays: 3, brief: 'gentle bump' },
      { waitDays: 4, brief: 'share a relevant case study' },
    ];

    function createSeqCampaign(
      name: string,
      steps = STEPS,
      extras: {
        enabled?: boolean;
        cadenceRules?: {
          maxPerWeekPerContact?: number;
          quietHoursStart?: string;
          quietHoursEnd?: string;
          blackoutDates?: string[];
        };
      } = {},
    ) {
      return run(() =>
        svc.createCampaign({
          name,
          brief: 'Sequence test campaign.',
          segmentId,
          channelId,
          sequenceSteps: steps,
          cadenceRules: extras.cadenceRules,
          enabled: extras.enabled ?? true,
        }),
      );
    }

    async function sendInitial(campaignId: string) {
      const p = await run(() =>
        svc.proposeInitial({
          campaignId,
          contactId,
          draftSubject: 'Hi Jane',
          draftBody: 'Initial pitch.',
        }),
      );
      return run(() => svc.approveProposal(p.id, { publicBaseUrl: 'https://test.local', fingerprint: p.draftFingerprint }));
    }

    async function backdateSent(proposalId: string, days: number) {
      await db.execute(
        sql`UPDATE outreach_proposals SET sent_at = now() - make_interval(days => ${days}) WHERE id = ${proposalId}`,
      );
    }

    async function insertInbound(conversationId: string) {
      await db.insert(schema.convMessages).values({
        orgId,
        conversationId,
        authorType: 'end_user',
        authorId: 'prospect',
        body: 'Thanks, tell me more!',
      });
    }

    it('createCampaign stores sequenceSteps and defaults to an empty array', async () => {
      const withSteps = await createSeqCampaign('seq-create');
      expect(withSteps.sequenceSteps).toEqual(STEPS);
      const without = await run(() =>
        svc.createCampaign({ name: 'seq-none', brief: 'b', segmentId, channelId }),
      );
      expect(without.sequenceSteps).toEqual([]);
    });

    it('rejects sequenceSteps on a voice channel (create and update)', async () => {
      const [voice] = await db
        .insert(schema.convChannels)
        .values({ orgId, type: 'voice', vendor: 'vapi', name: 'seq-voice', active: true, config: {} })
        .returning();
      await expect(
        run(() =>
          svc.createCampaign({
            name: 'seq-voice-create',
            brief: 'b',
            segmentId,
            channelId: voice!.id,
            sequenceSteps: STEPS,
          }),
        ),
      ).rejects.toThrow(OutreachInvalidError);

      const voiceCampaign = await run(() =>
        svc.createCampaign({ name: 'seq-voice-update', brief: 'b', segmentId, channelId: voice!.id }),
      );
      await expect(
        run(() => svc.updateCampaign({ id: voiceCampaign.id, patch: { sequenceSteps: STEPS } })),
      ).rejects.toThrow(OutreachInvalidError);

      const emailCampaign = await createSeqCampaign('seq-email-to-voice');
      await expect(
        run(() => svc.updateCampaign({ id: emailCampaign.id, patch: { channelId: voice!.id } })),
      ).rejects.toThrow(OutreachInvalidError);
    });

    it('updateCampaign replaces the whole steps array', async () => {
      const c = await createSeqCampaign('seq-update');
      const updated = await run(() =>
        svc.updateCampaign({ id: c.id, patch: { sequenceSteps: [{ waitDays: 7, brief: 'breakup email' }] } }),
      );
      expect(updated.sequenceSteps).toEqual([{ waitDays: 7, brief: 'breakup email' }]);
    });

    it('proposeFollowup files step 1 once the wait elapsed with no reply', async () => {
      const c = await createSeqCampaign('seq-happy');
      const sent = await sendInitial(c.id);
      await backdateSent(sent.id, 4);
      const p = await run(() =>
        svc.proposeFollowup({
          conversationId: sent.conversationId!,
          step: 1,
          draftBody: 'Just floating this back up.',
          evidence: { stepBrief: 'gentle bump' },
        }),
      );
      expect(p.kind).toBe('followup');
      expect(p.sequenceStep).toBe(1);
      expect(p.status).toBe('pending');
      expect(p.conversationId).toBe(sent.conversationId);
      expect(p.draftSubject).toBeNull();
      expect(p.contactId).toBe(contactId);
    });

    it('proposeFollowup rejects before the wait period elapsed', async () => {
      const c = await createSeqCampaign('seq-early');
      const sent = await sendInitial(c.id);
      await backdateSent(sent.id, 1);
      await expect(
        run(() =>
          svc.proposeFollowup({ conversationId: sent.conversationId!, step: 1, draftBody: 'x' }),
        ),
      ).rejects.toThrow(/not due until/);
    });

    it('proposeFollowup rejects out-of-order and out-of-range steps', async () => {
      const c = await createSeqCampaign('seq-order');
      const sent = await sendInitial(c.id);
      await backdateSent(sent.id, 10);
      await expect(
        run(() =>
          svc.proposeFollowup({ conversationId: sent.conversationId!, step: 2, draftBody: 'x' }),
        ),
      ).rejects.toThrow(/out of order/);

      const short = await createSeqCampaign('seq-range', [{ waitDays: 1, brief: 'only step' }]);
      const sent2 = await sendInitial(short.id);
      await backdateSent(sent2.id, 5);
      const p1 = await run(() =>
        svc.proposeFollowup({ conversationId: sent2.conversationId!, step: 1, draftBody: 'bump' }),
      );
      const approved = await run(() =>
        svc.approveProposal(p1.id, { publicBaseUrl: 'https://test.local', fingerprint: p1.draftFingerprint }),
      );
      await backdateSent(approved.id, 2);
      await expect(
        run(() =>
          svc.proposeFollowup({ conversationId: sent2.conversationId!, step: 2, draftBody: 'x' }),
        ),
      ).rejects.toThrow(/no sequence step/);
    });

    it('proposeFollowup rejects once the prospect replied (stop-on-reply)', async () => {
      const c = await createSeqCampaign('seq-replied');
      const sent = await sendInitial(c.id);
      await backdateSent(sent.id, 4);
      await insertInbound(sent.conversationId!);
      await expect(
        run(() =>
          svc.proposeFollowup({ conversationId: sent.conversationId!, step: 1, draftBody: 'x' }),
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('a dismissed follow-up permanently blocks that step', async () => {
      const c = await createSeqCampaign('seq-dismissed');
      const sent = await sendInitial(c.id);
      await backdateSent(sent.id, 4);
      const p = await run(() =>
        svc.proposeFollowup({ conversationId: sent.conversationId!, step: 1, draftBody: 'bump' }),
      );
      await run(() => svc.dismissProposal({ id: p.id, reason: 'stop chasing' }));
      await expect(
        run(() =>
          svc.proposeFollowup({ conversationId: sent.conversationId!, step: 1, draftBody: 'again' }),
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('a withdrawn follow-up leaves the step re-proposable', async () => {
      const c = await createSeqCampaign('seq-withdrawn');
      const sent = await sendInitial(c.id);
      await backdateSent(sent.id, 4);
      const p = await run(() =>
        svc.proposeFollowup({ conversationId: sent.conversationId!, step: 1, draftBody: 'bump' }),
      );
      await run(() => svc.withdrawProposal({ id: p.id, reason: 'duplicate draft' }));
      const refiled = await run(() =>
        svc.proposeFollowup({ conversationId: sent.conversationId!, step: 1, draftBody: 'better bump' }),
      );
      expect(refiled.status).toBe('pending');
      expect(refiled.sequenceStep).toBe(1);
    });

    it('proposeFollowup rejects while another follow-up or reply is pending', async () => {
      const c = await createSeqCampaign('seq-queued');
      const sent = await sendInitial(c.id);
      await backdateSent(sent.id, 4);
      await run(() =>
        svc.proposeFollowup({ conversationId: sent.conversationId!, step: 1, draftBody: 'bump' }),
      );
      await expect(
        run(() =>
          svc.proposeFollowup({ conversationId: sent.conversationId!, step: 1, draftBody: 'dup' }),
        ),
      ).rejects.toThrow(ConflictException);

      const c2 = await createSeqCampaign('seq-queued-reply');
      const sent2 = await sendInitial(c2.id);
      await backdateSent(sent2.id, 4);
      await run(() =>
        svc.proposeReply({ conversationId: sent2.conversationId!, draftBody: 'manual reply draft' }),
      );
      await expect(
        run(() =>
          svc.proposeFollowup({ conversationId: sent2.conversationId!, step: 1, draftBody: 'x' }),
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('proposeFollowup rejects a suppressed contact', async () => {
      const c = await createSeqCampaign('seq-suppressed');
      const sent = await sendInitial(c.id);
      await backdateSent(sent.id, 4);
      await db
        .update(schema.crmContacts)
        .set({ doNotContact: true })
        .where(eq(schema.crmContacts.id, contactId));
      await expect(
        run(() =>
          svc.proposeFollowup({ conversationId: sent.conversationId!, step: 1, draftBody: 'x' }),
        ),
      ).rejects.toThrow(OutreachInvalidError);
    });

    it('approveFollowup sends verbatim on the same conversation and bumps lastContactedAt', async () => {
      const c = await createSeqCampaign('seq-approve');
      const sent = await sendInitial(c.id);
      await backdateSent(sent.id, 4);
      await db
        .update(schema.crmContacts)
        .set({ lastContactedAt: null })
        .where(eq(schema.crmContacts.id, contactId));
      const p = await run(() =>
        svc.proposeFollowup({
          conversationId: sent.conversationId!,
          step: 1,
          draftBody: 'Circling back on my last note.',
        }),
      );
      const approved = await run(() =>
        svc.approveProposal(p.id, { publicBaseUrl: 'https://test.local', fingerprint: p.draftFingerprint }),
      );
      expect(approved.status).toBe('sent');
      expect(approved.conversationId).toBe(sent.conversationId);
      expect(approved.sequenceStep).toBe(1);
      const msgRows = await db.execute<{ body: string }>(
        sql`SELECT body FROM conv_messages WHERE id = ${approved.sentMessageId!}`,
      );
      expect(msgRows[0]!.body).toBe('Circling back on my last note.');
      expect(msgRows[0]!.body).not.toContain('Unsubscribe');
      const contactRows = await db.execute<{ last_contacted_at: Date | null }>(
        sql`SELECT last_contacted_at FROM crm_contacts WHERE id = ${contactId}`,
      );
      expect(contactRows[0]!.last_contacted_at).not.toBeNull();
    });

    it('approveFollowup refuses when a reply landed after drafting; proposal stays pending', async () => {
      const c = await createSeqCampaign('seq-approve-race');
      const sent = await sendInitial(c.id);
      await backdateSent(sent.id, 4);
      const p = await run(() =>
        svc.proposeFollowup({ conversationId: sent.conversationId!, step: 1, draftBody: 'bump' }),
      );
      await insertInbound(sent.conversationId!);
      await expect(
        run(() => svc.approveProposal(p.id, { publicBaseUrl: 'https://test.local', fingerprint: p.draftFingerprint })),
      ).rejects.toThrow(/replied after this follow-up was drafted/);
      const rows = await db.execute<{ status: string }>(
        sql`SELECT status FROM outreach_proposals WHERE id = ${p.id}`,
      );
      expect(rows[0]!.status).toBe('pending');
    });

    it('approveFollowup refuses on a disabled campaign or suppressed contact', async () => {
      const c = await createSeqCampaign('seq-approve-disabled');
      const sent = await sendInitial(c.id);
      await backdateSent(sent.id, 4);
      const p = await run(() =>
        svc.proposeFollowup({ conversationId: sent.conversationId!, step: 1, draftBody: 'bump' }),
      );
      await run(() => svc.updateCampaign({ id: c.id, patch: { enabled: false } }));
      await expect(
        run(() => svc.approveProposal(p.id, { publicBaseUrl: 'https://test.local', fingerprint: p.draftFingerprint })),
      ).rejects.toThrow(/disabled/);

      await run(() => svc.updateCampaign({ id: c.id, patch: { enabled: true } }));
      await db
        .update(schema.crmContacts)
        .set({ unsubscribedAt: new Date() })
        .where(eq(schema.crmContacts.id, contactId));
      await expect(
        run(() => svc.approveProposal(p.id, { publicBaseUrl: 'https://test.local', fingerprint: p.draftFingerprint })),
      ).rejects.toThrow(/no longer eligible/);
    });

    it('step 2 anchors on the sent step-1 follow-up', async () => {
      const c = await createSeqCampaign('seq-chain');
      const sent = await sendInitial(c.id);
      await backdateSent(sent.id, 10);
      const p1 = await run(() =>
        svc.proposeFollowup({ conversationId: sent.conversationId!, step: 1, draftBody: 'bump' }),
      );
      const f1 = await run(() =>
        svc.approveProposal(p1.id, { publicBaseUrl: 'https://test.local', fingerprint: p1.draftFingerprint }),
      );
      await expect(
        run(() =>
          svc.proposeFollowup({ conversationId: sent.conversationId!, step: 2, draftBody: 'case study' }),
        ),
      ).rejects.toThrow(/not due until/);
      await backdateSent(f1.id, 5);
      const p2 = await run(() =>
        svc.proposeFollowup({ conversationId: sent.conversationId!, step: 2, draftBody: 'case study' }),
      );
      expect(p2.sequenceStep).toBe(2);
    });

    describe('listDueFollowups', () => {
      it('returns a due row with the next step and its brief', async () => {
        const c = await createSeqCampaign('due-basic');
        const sent = await sendInitial(c.id);
        await backdateSent(sent.id, 4);
        const due = await run(() => svc.listDueFollowups({}));
        expect(due).toHaveLength(1);
        expect(due[0]).toMatchObject({
          campaignId: c.id,
          campaignName: 'due-basic',
          contactId,
          conversationId: sent.conversationId,
          nextStep: 1,
          stepBrief: 'gentle bump',
          waitDays: 3,
        });
      });

      it('excludes rows that are not yet due', async () => {
        const c = await createSeqCampaign('due-early');
        const sent = await sendInitial(c.id);
        await backdateSent(sent.id, 2);
        expect(await run(() => svc.listDueFollowups({}))).toEqual([]);
      });

      it('excludes replied conversations', async () => {
        const c = await createSeqCampaign('due-replied');
        const sent = await sendInitial(c.id);
        await backdateSent(sent.id, 4);
        await insertInbound(sent.conversationId!);
        expect(await run(() => svc.listDueFollowups({}))).toEqual([]);
      });

      it('excludes pairs with a pending follow-up or reply draft', async () => {
        const c = await createSeqCampaign('due-pending');
        const sent = await sendInitial(c.id);
        await backdateSent(sent.id, 4);
        await run(() =>
          svc.proposeFollowup({ conversationId: sent.conversationId!, step: 1, draftBody: 'bump' }),
        );
        expect(await run(() => svc.listDueFollowups({}))).toEqual([]);
      });

      it('excludes sequences stopped by a dismissed step', async () => {
        const c = await createSeqCampaign('due-dismissed');
        const sent = await sendInitial(c.id);
        await backdateSent(sent.id, 4);
        const p = await run(() =>
          svc.proposeFollowup({ conversationId: sent.conversationId!, step: 1, draftBody: 'bump' }),
        );
        await run(() => svc.dismissProposal({ id: p.id }));
        expect(await run(() => svc.listDueFollowups({}))).toEqual([]);
      });

      it('keeps a step due after the agent withdraws its own follow-up draft', async () => {
        const c = await createSeqCampaign('due-withdrawn');
        const sent = await sendInitial(c.id);
        await backdateSent(sent.id, 4);
        const p = await run(() =>
          svc.proposeFollowup({ conversationId: sent.conversationId!, step: 1, draftBody: 'bump' }),
        );
        await run(() => svc.withdrawProposal({ id: p.id, reason: 'wrong case study' }));
        const due = await run(() => svc.listDueFollowups({}));
        expect(due.map((d) => d.nextStep)).toEqual([1]);
      });

      it('excludes disabled campaigns, exhausted sequences, and campaigns without steps', async () => {
        const c = await createSeqCampaign('due-disabled');
        const sent = await sendInitial(c.id);
        await backdateSent(sent.id, 4);
        await run(() => svc.updateCampaign({ id: c.id, patch: { enabled: false } }));
        expect(await run(() => svc.listDueFollowups({}))).toEqual([]);

        await run(() => svc.updateCampaign({ id: c.id, patch: { enabled: true, sequenceSteps: [] } }));
        expect(await run(() => svc.listDueFollowups({}))).toEqual([]);
      });

      it('excludes suppressed contacts and closed conversations', async () => {
        const c = await createSeqCampaign('due-floor');
        const sent = await sendInitial(c.id);
        await backdateSent(sent.id, 4);
        await db
          .update(schema.crmContacts)
          .set({ doNotContact: true })
          .where(eq(schema.crmContacts.id, contactId));
        expect(await run(() => svc.listDueFollowups({}))).toEqual([]);

        await db
          .update(schema.crmContacts)
          .set({ doNotContact: false })
          .where(eq(schema.crmContacts.id, contactId));
        await db.execute(
          sql`UPDATE conv_conversations SET status = 'closed' WHERE id = ${sent.conversationId!}`,
        );
        expect(await run(() => svc.listDueFollowups({}))).toEqual([]);
      });

      it('anchors step 2 on the sent step-1 follow-up and surfaces its brief', async () => {
        const c = await createSeqCampaign('due-chain');
        const sent = await sendInitial(c.id);
        await backdateSent(sent.id, 8);
        const p1 = await run(() =>
          svc.proposeFollowup({ conversationId: sent.conversationId!, step: 1, draftBody: 'bump' }),
        );
        const f1 = await run(() =>
          svc.approveProposal(p1.id, { publicBaseUrl: 'https://test.local', fingerprint: p1.draftFingerprint }),
        );
        await backdateSent(f1.id, 5);
        const due = await run(() => svc.listDueFollowups({}));
        expect(due).toHaveLength(1);
        expect(due[0]).toMatchObject({
          nextStep: 2,
          stepBrief: 'share a relevant case study',
          waitDays: 4,
        });
      });

      it('holds back contacts at their maxPerWeekPerContact budget until the window clears', async () => {
        const c = await createSeqCampaign('due-weekly-cap', STEPS, {
          cadenceRules: { maxPerWeekPerContact: 1 },
        });
        const sent = await sendInitial(c.id);
        await backdateSent(sent.id, 4);
        expect(await run(() => svc.listDueFollowups({}))).toEqual([]);

        await backdateSent(sent.id, 8);
        const due = await run(() => svc.listDueFollowups({}));
        expect(due).toHaveLength(1);
        expect(due[0]!.nextStep).toBe(1);
      });

      it('allows a follow-up when the weekly budget has headroom', async () => {
        const c = await createSeqCampaign('due-weekly-headroom', STEPS, {
          cadenceRules: { maxPerWeekPerContact: 2 },
        });
        const sent = await sendInitial(c.id);
        await backdateSent(sent.id, 4);
        expect(await run(() => svc.listDueFollowups({}))).toHaveLength(1);
      });

      it('excludes everything on a blackout date; other dates do not gate', async () => {
        const todayRows = await db.execute<{ today: string }>(
          sql`SELECT to_char(now(), 'YYYY-MM-DD') AS today`,
        );
        const today = todayRows[0]!.today;

        const c = await createSeqCampaign('due-blackout', STEPS, {
          cadenceRules: { blackoutDates: [today] },
        });
        const sent = await sendInitial(c.id);
        await backdateSent(sent.id, 4);
        expect(await run(() => svc.listDueFollowups({}))).toEqual([]);

        await run(() =>
          svc.updateCampaign({ id: c.id, patch: { cadenceRules: { blackoutDates: ['2020-01-01'] } } }),
        );
        expect(await run(() => svc.listDueFollowups({}))).toHaveLength(1);
      });

      it('quiet hours do not gate the due-scan (drafting is not sending)', async () => {
        const c = await createSeqCampaign('due-quiet-hours', STEPS, {
          cadenceRules: { quietHoursStart: '00:00', quietHoursEnd: '23:59' },
        });
        const sent = await sendInitial(c.id);
        await backdateSent(sent.id, 4);
        expect(await run(() => svc.listDueFollowups({}))).toHaveLength(1);
      });

      it('filters by campaignId', async () => {
        const c = await createSeqCampaign('due-filter');
        const sent = await sendInitial(c.id);
        await backdateSent(sent.id, 4);
        expect(await run(() => svc.listDueFollowups({ campaignId: c.id }))).toHaveLength(1);
        expect(await run(() => svc.listDueFollowups({ campaignId: 'ocmp_nonexistent' }))).toEqual([]);
      });
    });
  });

  describe('voice campaigns', () => {
    let voiceChannelId: string;
    let voiceContactId: string;
    let realFetch: typeof globalThis.fetch;

    beforeAll(() => {
      realFetch = globalThis.fetch;
    });

    afterAll(() => {
      globalThis.fetch = realFetch;
    });

    function humanActor(): ActorIdentity {
      return new ActorIdentity(
        'user',
        'usr_outreach_voice_test',
        orgId,
        ['*'],
        ['admin'],
        undefined,
        undefined,
        undefined,
        'usr_outreach_voice_test',
      );
    }

    function runAsSystem<T>(fn: () => Promise<T>, as: ActorIdentity = actor): Promise<T> {
      return db.transaction(async (tx) => {
        await tx.execute(sql`SELECT set_config('app.bypass_rls', 'on', true)`);
        await tx.execute(
          sql`SELECT set_config('app.crypt_key', ${process.env.MUNIN_ENCRYPTION_KEY ?? ''}, true)`,
        );
        const ctx: RequestContext = { db: tx, actor: as, correlationId: randomUUID() };
        return withContext(ctx, fn);
      });
    }

    function stubVapiPlaceCall(
      response: { id: string; status: string } = { id: 'call_outreach_1', status: 'queued' },
    ): { calls: Array<{ url: string; body: string | null }> } {
      const calls: Array<{ url: string; body: string | null }> = [];
      type FetchArgs = Parameters<typeof globalThis.fetch>;
      globalThis.fetch = (async (...args: FetchArgs) => {
        const [input, init] = args;
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        if (url.startsWith('https://api.vapi.ai/call')) {
          calls.push({ url, body: init && typeof init.body === 'string' ? init.body : null });
          return new Response(JSON.stringify(response), {
            status: 201,
            headers: { 'content-type': 'application/json' },
          });
        }
        return realFetch(...args);
      });
      return { calls };
    }

    beforeEach(async () => {
      process.env.MUNIN_ENCRYPTION_KEY ??=
        'dGVzdC1lbmNyeXB0aW9uLWtleS1tdXN0LWJlLWxvbmctZW5vdWdoLWZvci1wZ2NyeXB0bw==';
      globalThis.fetch = realFetch;

      const vapiClient = new VapiClientService(db);
      vapiClient.fetchAssistantConfig = () => Promise.resolve({ ok: false, error: 'stub' });
      const vapiSvc = new VapiService(db, vapiClient);
      const voiceChannel = await runAsSystem(() =>
        vapiSvc.createChannel({
          name: 'Vapi voice',
          config: {
            apiKey: 'vapi-test-api-key',
            webhookSecret: 'vapi-test-webhook-secret',
            assistantId: 'asst_outreach',
            phoneNumberId: 'pn_outreach',
          },
        }),
      );
      voiceChannelId = voiceChannel.id;

      const [crm] = await db
        .insert(schema.crmContacts)
        .values({
          orgId,
          name: 'Voice Contact',
          email: 'voice@example.com',
          phone: '+14155559999',
          consentLawfulBasis: 'legitimate_interest',
          doNotContact: false,
        })
        .returning();
      voiceContactId = crm!.id;
    });

    it('rejects creating a campaign on a non-email, non-voice channel', async () => {
      const [otherChannel] = await db
        .insert(schema.convChannels)
        .values({
          orgId,
          type: 'chat',
          vendor: 'munin',
          name: 'web-widget',
          active: true,
          config: {},
        })
        .returning();
      await expect(
        run(() =>
          svc.createCampaign({
            name: 'bad',
            brief: 'b',
            segmentId,
            channelId: otherChannel!.id,
          }),
        ),
      ).rejects.toBeInstanceOf(OutreachInvalidError);
    });

    it('allows creating a campaign on a voice:vapi channel', async () => {
      const c = await run(() =>
        svc.createCampaign({
          name: 'voice-campaign',
          brief: 'reach out by phone',
          segmentId,
          channelId: voiceChannelId,
          enabled: true,
        }),
      );
      expect(c.channelId).toBe(voiceChannelId);
    });

    it('proposeInitial omits draftSubject for voice campaigns', async () => {
      const c = await run(() =>
        svc.createCampaign({
          name: 'voice-no-subject',
          brief: 'b',
          segmentId,
          channelId: voiceChannelId,
          enabled: true,
        }),
      );
      const p = await run(() =>
        svc.proposeInitial({
          campaignId: c.id,
          contactId: voiceContactId,
          draftBody: 'Hi! Quick check-in about your recent order.',
        }),
      );
      expect(p.draftSubject).toBeNull();
      expect(p.draftBody).toMatch(/check-in/);
    });

    it('proposeInitial rejects voice proposals when contact has no phone', async () => {
      const [phoneless] = await db
        .insert(schema.crmContacts)
        .values({
          orgId,
          name: 'No Phone',
          email: 'np@example.com',
          consentLawfulBasis: 'legitimate_interest',
          doNotContact: false,
        })
        .returning();
      const c = await run(() =>
        svc.createCampaign({
          name: 'voice-no-phone',
          brief: 'b',
          segmentId,
          channelId: voiceChannelId,
          enabled: true,
        }),
      );
      await expect(
        run(() =>
          svc.proposeInitial({
            campaignId: c.id,
            contactId: phoneless!.id,
            draftBody: 'Hi.',
          }),
        ),
      ).rejects.toBeInstanceOf(OutreachInvalidError);
    });

    it('accepts a threll voice channel, not just vapi', async () => {
      const [threllChannel] = await db
        .insert(schema.convChannels)
        .values({
          orgId,
          type: 'voice',
          vendor: 'threll',
          name: 'threll-voice',
          active: true,
          config: {
            encryptedApiKey: 'fake',
            encryptedWebhookSecret: 'fake',
            accountId: 'acct_1',
            workerId: 'wrk_1',
          },
        })
        .returning();
      const c = await run(() =>
        svc.createCampaign({
          name: 'threll-campaign',
          brief: 'b',
          segmentId,
          channelId: threllChannel!.id,
          enabled: true,
        }),
      );
      expect(c.channelId).toBe(threllChannel!.id);

      const p = await run(() =>
        svc.proposeInitial({
          campaignId: c.id,
          contactId: voiceContactId,
          draftBody: 'Say hei, then offer two slots.',
        }),
      );
      expect(p.delivery?.channelType).toBe('voice');
      expect(p.delivery?.vendor).toBe('threll');
      expect(p.delivery?.destination).toBe('+14155559999');
    });

    it('rejects a voice vendor with no registered outreach caller', async () => {
      const [unknownChannel] = await db
        .insert(schema.convChannels)
        .values({
          orgId,
          type: 'voice',
          vendor: 'some-future-vendor',
          name: 'future-voice',
          active: true,
          config: {},
        })
        .returning();
      await expect(
        run(() =>
          svc.createCampaign({
            name: 'future-campaign',
            brief: 'b',
            segmentId,
            channelId: unknownChannel!.id,
          }),
        ),
      ).rejects.toThrow(/cannot place outreach calls; supported: threll, vapi/);
    });

    it('approveProposal on a voice initial places a Vapi call and creates a stub conversation', async () => {
      const { calls } = stubVapiPlaceCall({ id: 'call_test_42', status: 'queued' });
      const c = await run(() =>
        svc.createCampaign({
          name: 'voice-approve',
          brief: 'b',
          segmentId,
          channelId: voiceChannelId,
          enabled: true,
        }),
      );
      const p = await run(() =>
        svc.proposeInitial({
          campaignId: c.id,
          contactId: voiceContactId,
          draftBody: 'Quick follow-up call.',
        }),
      );
      const approved = await runAsSystem(
        () => svc.approveProposal(p.id, { publicBaseUrl: 'http://localhost:3001', fingerprint: p.draftFingerprint }),
        humanActor(),
      );
      expect(approved.status).toBe('sent');
      expect(approved.conversationId).toBeTruthy();
      expect((approved.evidence).vapiCallId).toBe('call_test_42');

      expect(calls.length).toBe(1);
      expect(calls[0]!.body ?? '').toContain('"+14155559999"');
      expect(calls[0]!.body ?? '').toContain('asst_outreach');
      expect(calls[0]!.body ?? '').toContain('outreachProposalId');

      const convs = await db
        .select()
        .from(schema.convConversations)
        .where(eq(schema.convConversations.id, approved.conversationId!));
      expect(convs[0]!.channelId).toBe(voiceChannelId);
      const meta = convs[0]!.metadata;
      expect(meta.vapiCallId).toBe('call_test_42');
      expect(meta.outreachProposalId).toBe(p.id);
      expect(meta.outreachCampaignId).toBe(c.id);

      const msgs = await db
        .select()
        .from(schema.convMessages)
        .where(eq(schema.convMessages.conversationId, approved.conversationId!));
      expect(msgs).toEqual([]);
    });

    it('reuses an existing conversation when the Vapi adapter raced and inserted it first', async () => {
      const sharedCallId = 'call_race_winner';
      stubVapiPlaceCall({ id: sharedCallId, status: 'queued' });
      const c = await run(() =>
        svc.createCampaign({
          name: 'voice-race',
          brief: 'b',
          segmentId,
          channelId: voiceChannelId,
          enabled: true,
        }),
      );
      const [pre] = await db
        .insert(schema.convConversations)
        .values({
          orgId,
          displayId: 9000,
          channelId: voiceChannelId,
          status: 'open',
          metadata: { vapiCallId: sharedCallId },
        })
        .returning();
      const preexistingId = pre!.id;
      const p = await run(() =>
        svc.proposeInitial({
          campaignId: c.id,
          contactId: voiceContactId,
          draftBody: 'Hi.',
        }),
      );
      const approved = await runAsSystem(
        () => svc.approveProposal(p.id, { publicBaseUrl: 'http://localhost:3001', fingerprint: p.draftFingerprint }),
        humanActor(),
      );
      expect(approved.conversationId).toBe(preexistingId);
      const all = await db
        .select({ id: schema.convConversations.id })
        .from(schema.convConversations)
        .where(sql`${schema.convConversations.metadata}->>'vapiCallId' = ${sharedCallId}`);
      expect(all).toHaveLength(1);
      const merged = await db
        .select()
        .from(schema.convConversations)
        .where(eq(schema.convConversations.id, preexistingId))
        .limit(1);
      const meta = merged[0]!.metadata;
      expect(meta.outreachProposalId).toBe(p.id);
      expect(meta.outreachCampaignId).toBe(c.id);
    });

    it('proposeReply rejects on a voice campaign conversation', async () => {
      const { calls: _calls } = stubVapiPlaceCall({ id: 'call_reply_block', status: 'queued' });
      void _calls;
      const c = await run(() =>
        svc.createCampaign({
          name: 'voice-no-reply',
          brief: 'b',
          segmentId,
          channelId: voiceChannelId,
          enabled: true,
        }),
      );
      const p = await run(() =>
        svc.proposeInitial({
          campaignId: c.id,
          contactId: voiceContactId,
          draftBody: 'Quick call.',
        }),
      );
      const approved = await runAsSystem(
        () => svc.approveProposal(p.id, { publicBaseUrl: 'http://localhost:3001', fingerprint: p.draftFingerprint }),
        humanActor(),
      );
      await expect(
        run(() =>
          svc.proposeReply({
            conversationId: approved.conversationId!,
            draftBody: 'follow-up',
          }),
        ),
      ).rejects.toBeInstanceOf(OutreachInvalidError);
    });

    it('an agent cannot approve a voice proposal, and no call is placed', async () => {
      const { calls } = stubVapiPlaceCall();
      const c = await run(() =>
        svc.createCampaign({
          name: 'voice-agent-refused',
          brief: 'b',
          segmentId,
          channelId: voiceChannelId,
          enabled: true,
        }),
      );
      const p = await run(() =>
        svc.proposeInitial({
          campaignId: c.id,
          contactId: voiceContactId,
          draftBody: 'Quick call.',
        }),
      );
      await expect(
        runAsSystem(() => svc.approveProposal(p.id, { publicBaseUrl: 'http://localhost:3001', fingerprint: p.draftFingerprint })),
      ).rejects.toThrow(/signed-in person in the Munin dashboard/);
      expect(calls.length).toBe(0);
      const after = await run(() => svc.getProposal(p.id));
      expect(after.status).toBe('pending');
    });

    it('a human cannot approve a voice proposal inside the campaign quiet hours', async () => {
      const { calls } = stubVapiPlaceCall();
      const now = new Date();
      const quietStart = new Date(now.getTime() - 60 * 60 * 1000);
      const quietEnd = new Date(now.getTime() + 60 * 60 * 1000);
      const hhmm = (d: Date) =>
        `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
      const c = await run(() =>
        svc.createCampaign({
          name: 'voice-quiet-hours',
          brief: 'b',
          segmentId,
          channelId: voiceChannelId,
          enabled: true,
          cadenceRules: { quietHoursStart: hhmm(quietStart), quietHoursEnd: hhmm(quietEnd) },
        }),
      );
      const p = await run(() =>
        svc.proposeInitial({
          campaignId: c.id,
          contactId: voiceContactId,
          draftBody: 'Quick call.',
        }),
      );
      await expect(
        runAsSystem(
          () => svc.approveProposal(p.id, { publicBaseUrl: 'http://localhost:3001', fingerprint: p.draftFingerprint }),
          humanActor(),
        ),
      ).rejects.toThrow(/does not call between/);
      expect(calls.length).toBe(0);
    });

    it('a human cannot approve a voice proposal on a blackout date', async () => {
      const { calls } = stubVapiPlaceCall();
      const c = await run(() =>
        svc.createCampaign({
          name: 'voice-blackout',
          brief: 'b',
          segmentId,
          channelId: voiceChannelId,
          enabled: true,
          cadenceRules: { blackoutDates: [new Date().toISOString().slice(0, 10)] },
        }),
      );
      const p = await run(() =>
        svc.proposeInitial({
          campaignId: c.id,
          contactId: voiceContactId,
          draftBody: 'Quick call.',
        }),
      );
      await expect(
        runAsSystem(
          () => svc.approveProposal(p.id, { publicBaseUrl: 'http://localhost:3001', fingerprint: p.draftFingerprint }),
          humanActor(),
        ),
      ).rejects.toThrow(/does not call on /);
      expect(calls.length).toBe(0);
    });

    it('an agent can still dismiss a voice proposal, since dismissing sends nothing', async () => {
      const c = await run(() =>
        svc.createCampaign({
          name: 'voice-dismissable',
          brief: 'b',
          segmentId,
          channelId: voiceChannelId,
          enabled: true,
        }),
      );
      const p = await run(() =>
        svc.proposeInitial({
          campaignId: c.id,
          contactId: voiceContactId,
          draftBody: 'Quick call.',
        }),
      );
      const dismissed = await run(() =>
        svc.dismissProposal({ id: p.id, reason: 'wrong list' }),
      );
      expect(dismissed.status).toBe('dismissed');
    });

    it('email approval is unaffected by the calling gate', async () => {
      const c = await run(() =>
        svc.createCampaign({
          name: 'email-still-agent-approvable',
          brief: 'b',
          segmentId,
          channelId,
          enabled: true,
        }),
      );
      const p = await run(() =>
        svc.proposeInitial({
          campaignId: c.id,
          contactId,
          draftSubject: 'Hello',
          draftBody: 'Body.',
        }),
      );
      const approved = await run(() =>
        svc.approveProposal(p.id, { publicBaseUrl: 'https://test.local', fingerprint: p.draftFingerprint }),
      );
      expect(approved.status).toBe('sent');
    });
  });

  describe('sms campaigns', () => {
    let smsChannelId: string;
    let smsContactId: string;

    beforeEach(async () => {
      const [channel] = await db
        .insert(schema.convChannels)
        .values({
          orgId,
          type: 'sms',
          vendor: 'twilio',
          name: 'outreach-sms',
          active: true,
          config: { accountSid: 'AC_test', encryptedAuthToken: 'fake', fromNumber: '+15550001111' },
        })
        .returning();
      smsChannelId = channel!.id;

      const [crm] = await db
        .insert(schema.crmContacts)
        .values({
          orgId,
          name: 'Text Me',
          email: 'text@example.com',
          phone: '+14155558888',
          consentLawfulBasis: 'consent',
          doNotContact: false,
        })
        .returning();
      smsContactId = crm!.id;
    });

    function humanActor(): ActorIdentity {
      return new ActorIdentity(
        'user',
        'usr_outreach_sms_test',
        orgId,
        ['*'],
        ['admin'],
        undefined,
        undefined,
        undefined,
        'usr_outreach_sms_test',
      );
    }

    async function campaign(overrides: { unsubscribeRequired?: boolean; ctaUrl?: string } = {}) {
      return run(() =>
        svc.createCampaign({
          name: `sms-${Math.round(overrides.unsubscribeRequired === false ? 1 : 0)}-${smsChannelId.slice(-6)}`,
          brief: 'b',
          segmentId,
          channelId: smsChannelId,
          enabled: true,
          ...overrides,
        }),
      );
    }

    it('accepts an sms channel and reports the phone as the delivery destination', async () => {
      const c = await campaign();
      const p = await run(() =>
        svc.proposeInitial({
          campaignId: c.id,
          contactId: smsContactId,
          draftBody: 'Hei! Vi har lansert noe du ba om.',
        }),
      );
      expect(p.draftSubject).toBeNull();
      expect(p.delivery?.channelType).toBe('sms');
      expect(p.delivery?.destination).toBe('+14155558888');
      expect(p.delivery?.appendsUnsubscribe).toBe(false);
    });

    it('rejects a draft longer than the SMS cap', async () => {
      const c = await campaign();
      await expect(
        run(() =>
          svc.proposeInitial({
            campaignId: c.id,
            contactId: smsContactId,
            draftBody: 'x'.repeat(SMS_DRAFT_MAX_CHARS + 1),
          }),
        ),
      ).rejects.toThrow(/SMS drafts are capped/);
    });

    it('rejects a contact with no phone number', async () => {
      const [phoneless] = await db
        .insert(schema.crmContacts)
        .values({
          orgId,
          name: 'No Phone',
          email: 'nophone-sms@example.com',
          consentLawfulBasis: 'consent',
          doNotContact: false,
        })
        .returning();
      const c = await campaign();
      await expect(
        run(() =>
          svc.proposeInitial({ campaignId: c.id, contactId: phoneless!.id, draftBody: 'Hi.' }),
        ),
      ).rejects.toBeInstanceOf(OutreachInvalidError);
    });

    it('an agent cannot approve an sms proposal', async () => {
      const c = await campaign();
      const p = await run(() =>
        svc.proposeInitial({ campaignId: c.id, contactId: smsContactId, draftBody: 'Hi.' }),
      );
      await expect(
        run(() => svc.approveProposal(p.id, { publicBaseUrl: 'https://test.local', fingerprint: p.draftFingerprint })),
      ).rejects.toThrow(/signed-in person in the Munin dashboard/);
    });

    it('a human approval sends the text, appends the opt-out line, and queues a delivery', async () => {
      const c = await campaign();
      const p = await run(() =>
        svc.proposeInitial({
          campaignId: c.id,
          contactId: smsContactId,
          draftBody: 'Hei! Vi har lansert noe du ba om.',
        }),
      );
      const approved = await runAs(humanActor(), () =>
        svc.approveProposal(p.id, { publicBaseUrl: 'https://test.local', fingerprint: p.draftFingerprint }),
      );
      expect(approved.status).toBe('sent');
      expect(approved.conversationId).toBeTruthy();

      const messages = await db
        .select({ id: schema.convMessages.id, body: schema.convMessages.body })
        .from(schema.convMessages)
        .where(eq(schema.convMessages.conversationId, approved.conversationId!));
      expect(messages).toHaveLength(1);
      expect(messages[0]!.body).toBe('Hei! Vi har lansert noe du ba om. Reply STOP to opt out.');
      expect(messages[0]!.body).not.toContain('](');

      const deliveries = await db
        .select({ status: schema.convMessageDeliveries.status })
        .from(schema.convMessageDeliveries)
        .where(eq(schema.convMessageDeliveries.messageId, messages[0]!.id));
      expect(deliveries).toHaveLength(1);
      expect(deliveries[0]!.status).toBe('queued');

      const convs = await db
        .select({
          agentMode: schema.convConversations.agentMode,
          outreachCampaignId: schema.convConversations.outreachCampaignId,
        })
        .from(schema.convConversations)
        .where(eq(schema.convConversations.id, approved.conversationId!));
      expect(convs[0]!.agentMode).toBe('draft_only');
      expect(convs[0]!.outreachCampaignId).toBe(c.id);
    });

    it('omits the opt-out line when the campaign does not require unsubscribe', async () => {
      const c = await campaign({ unsubscribeRequired: false });
      const p = await run(() =>
        svc.proposeInitial({ campaignId: c.id, contactId: smsContactId, draftBody: 'Kort melding.' }),
      );
      const approved = await runAs(humanActor(), () =>
        svc.approveProposal(p.id, { publicBaseUrl: 'https://test.local', fingerprint: p.draftFingerprint }),
      );
      const messages = await db
        .select({ body: schema.convMessages.body })
        .from(schema.convMessages)
        .where(eq(schema.convMessages.conversationId, approved.conversationId!));
      expect(messages[0]!.body).toBe('Kort melding.');
    });

    it('rejects sequence steps on an sms campaign', async () => {
      await expect(
        run(() =>
          svc.createCampaign({
            name: 'sms-with-steps',
            brief: 'b',
            segmentId,
            channelId: smsChannelId,
            sequenceSteps: [{ waitDays: 3, brief: 'bump' }],
          }),
        ),
      ).rejects.toBeInstanceOf(OutreachInvalidError);
    });
  });

  describe('extractionSchema', () => {
    const FIELDS: ExtractionField[] = [
      {
        key: 'current_operator',
        label: 'Current operator',
        type: 'string',
        description: 'The mobile operator the prospect says they use today.',
        tagPrefix: 'operator',
      },
      {
        key: 'contract_expires',
        label: 'Contract expires',
        type: 'date',
        description: 'When the prospect says their current agreement runs out.',
      },
    ];

    async function smsChannel(name: string): Promise<string> {
      const [ch] = await db
        .insert(schema.convChannels)
        .values({
          orgId,
          type: 'sms',
          vendor: 'twilio',
          name,
          active: true,
          config: { accountSid: 'AC_test', encryptedAuthToken: 'fake', fromNumber: '+15550001111' },
        })
        .returning();
      return ch!.id;
    }

    async function voiceChannel(name: string): Promise<string> {
      const [ch] = await db
        .insert(schema.convChannels)
        .values({
          orgId,
          type: 'voice',
          vendor: 'threll',
          name,
          active: true,
          config: {
            encryptedApiKey: 'fake',
            encryptedWebhookSecret: 'fake',
            accountId: 'acct_1',
            workerId: 'wrk_1',
          },
        })
        .returning();
      return ch!.id;
    }

    it('round-trips a schema on a voice campaign and defaults to empty', async () => {
      const voiceId = await voiceChannel('extract-voice');
      const withFields = await run(() =>
        svc.createCampaign({
          name: 'extract-yes',
          brief: 'b',
          segmentId,
          channelId: voiceId,
          extractionSchema: FIELDS,
        }),
      );
      expect(withFields.extractionSchema).toEqual(FIELDS);

      const withoutFields = await run(() =>
        svc.createCampaign({ name: 'extract-no', brief: 'b', segmentId, channelId: voiceId }),
      );
      expect(withoutFields.extractionSchema).toEqual([]);
    });

    it('accepts an extraction schema on email and sms campaigns', async () => {
      const emailCampaign = await run(() =>
        svc.createCampaign({
          name: 'extract-email',
          brief: 'b',
          segmentId,
          channelId,
          extractionSchema: FIELDS,
        }),
      );
      expect(emailCampaign.extractionSchema).toEqual(FIELDS);

      const smsChannelId = await smsChannel('extract-sms-channel');
      const smsCampaign = await run(() =>
        svc.createCampaign({
          name: 'extract-sms',
          brief: 'b',
          segmentId,
          channelId: smsChannelId,
          extractionSchema: FIELDS,
        }),
      );
      expect(smsCampaign.extractionSchema).toEqual(FIELDS);
    });

    it('keeps the schema when a campaign moves between channel types', async () => {
      const voiceId = await voiceChannel('extract-move');
      const campaign = await run(() =>
        svc.createCampaign({
          name: 'extract-move',
          brief: 'b',
          segmentId,
          channelId: voiceId,
          extractionSchema: FIELDS,
        }),
      );
      const moved = await run(() =>
        svc.updateCampaign({ id: campaign.id, patch: { channelId } }),
      );
      expect(moved.extractionSchema).toEqual(FIELDS);
    });

    it('rejects duplicate keys, reserved keys, and enums without options', async () => {
      const voiceId = await voiceChannel('extract-invalid');
      const cases: ExtractionField[][] = [
        [FIELDS[0]!, { ...FIELDS[0]!, label: 'Dup' }],
        [
          {
            key: 'outreachOutcome',
            label: 'Outcome',
            type: 'string',
            description: 'x',
          },
        ],
        [{ key: 'pbx', label: 'PBX', type: 'enum', description: 'x' }],
        [{ ...FIELDS[0]!, options: ['a', 'b'] }],
      ];
      for (const [i, extractionSchema] of cases.entries()) {
        await expect(
          run(() =>
            svc.createCampaign({
              name: `extract-invalid-${i}`,
              brief: 'b',
              segmentId,
              channelId: voiceId,
              extractionSchema,
            }),
          ),
        ).rejects.toBeInstanceOf(OutreachInvalidError);
      }
    });

    it('rejects more than the maximum number of fields', async () => {
      const voiceId = await voiceChannel('extract-too-many');
      const tooMany: ExtractionField[] = Array.from(
        { length: MAX_EXTRACTION_FIELDS + 1 },
        (_, i) => ({
          key: `field_${i}`,
          label: `Field ${i}`,
          type: 'string' as const,
          description: 'x',
        }),
      );
      await expect(
        run(() =>
          svc.createCampaign({
            name: 'extract-too-many',
            brief: 'b',
            segmentId,
            channelId: voiceId,
            extractionSchema: tooMany,
          }),
        ),
      ).rejects.toBeInstanceOf(OutreachInvalidError);
    });

    describe('outcome sink', () => {
      let enqueued: Parameters<JobEnqueuer['enqueue']>[0][];
      let sink: OutreachOutcomeSink;

      beforeEach(() => {
        enqueued = [];
        const stub: JobEnqueuer = {
          enqueue(input) {
            enqueued.push(input);
            return Promise.resolve({});
          },
        };
        sink = new OutreachOutcomeSink(stub);
      });

      async function outreachConversation(input: {
        extractionSchema?: ExtractionField[];
        channelType?: 'voice' | 'email' | 'sms';
        linkCampaign?: boolean;
        linkProposal?: boolean;
      }): Promise<string> {
        const suffix = randomUUID().slice(0, 8);
        const type = input.channelType ?? 'voice';
        const convChannelId =
          type === 'voice'
            ? await voiceChannel(`sink-${suffix}`)
            : type === 'sms'
              ? await smsChannel(`sink-sms-${suffix}`)
              : channelId;
        const campaign = await run(() =>
          svc.createCampaign({
            name: `sink-${suffix}`,
            brief: 'b',
            segmentId,
            channelId: convChannelId,
            extractionSchema: input.extractionSchema ?? [],
          }),
        );
        const [convContact] = await db
          .insert(schema.convContacts)
          .values({ orgId, phone: `+47${suffix}`, name: 'Jane Doe', metadata: {} })
          .returning();
        const [conversation] = await db
          .insert(schema.convConversations)
          .values({
            orgId,
            displayId: Math.floor(Math.random() * 1_000_000),
            channelId: convChannelId,
            contactId: convContact!.id,
            status: 'open',
            outreachCampaignId: input.linkCampaign === false ? null : campaign.id,
            agentMode: 'draft_only',
            metadata: {},
          })
          .returning();
        if (input.linkProposal !== false) {
          await db.insert(schema.outreachProposals).values({
            orgId,
            campaignId: campaign.id,
            contactId,
            conversationId: conversation!.id,
            kind: 'initial',
            draftBody: 'hei',
            status: 'sent',
            proposedByActorType: actor.type,
            proposedByActorId: actor.id,
          });
        }
        return conversation!.id;
      }

      function emit(
        type: string,
        payload: Record<string, unknown>,
      ): Promise<void> {
        return run(() =>
          sink.onEvent({
            eventId: `evt_${randomUUID().slice(0, 8)}`,
            orgId,
            type,
            payload: { ...payload, orgId },
          }),
        );
      }

      function callEnded(conversationId: string): Promise<void> {
        return emit('conversation.voice.call_ended', { conversationId });
      }

      function replyReceived(
        conversationId: string,
        overrides: Record<string, unknown> = {},
      ): Promise<void> {
        return emit('conversation.message.received', {
          conversationId,
          messageId: `cvm_${randomUUID().slice(0, 8)}`,
          authorType: 'end_user',
          ...overrides,
        });
      }

      it('enqueues one job carrying the declared fields when a call ends', async () => {
        const conversationId = await outreachConversation({ extractionSchema: FIELDS });
        await callEnded(conversationId);
        expect(enqueued).toHaveLength(1);
        expect(enqueued[0]!.jobUri).toBe('skill://outreach/extract-outcome');
        expect(enqueued[0]!.dedupeKey).toBe(`outreach-outcome:conv:${conversationId}`);
        expect(enqueued[0]!.userPrompt).toContain('current_operator');
        expect(enqueued[0]!.userPrompt).toContain(contactId);
      });

      it('enqueues per inbound reply on an email campaign', async () => {
        const conversationId = await outreachConversation({
          extractionSchema: FIELDS,
          channelType: 'email',
        });
        await replyReceived(conversationId);
        await replyReceived(conversationId);
        expect(enqueued).toHaveLength(2);
        expect(enqueued[0]!.dedupeKey).not.toBe(enqueued[1]!.dedupeKey);
        expect(enqueued[0]!.dedupeKey).toMatch(/^outreach-outcome:msg:/);
        expect(enqueued[0]!.userPrompt).toContain('channel email');
      });

      it('enqueues per inbound reply on an sms campaign', async () => {
        const conversationId = await outreachConversation({
          extractionSchema: FIELDS,
          channelType: 'sms',
        });
        await replyReceived(conversationId);
        expect(enqueued).toHaveLength(1);
        expect(enqueued[0]!.userPrompt).toContain('channel sms');
      });

      it('ignores voice transcript turns, which arrive as inbound messages mid-call', async () => {
        const conversationId = await outreachConversation({ extractionSchema: FIELDS });
        await replyReceived(conversationId);
        expect(enqueued).toEqual([]);
      });

      it('ignores a call_ended on a written channel', async () => {
        const conversationId = await outreachConversation({
          extractionSchema: FIELDS,
          channelType: 'email',
        });
        await callEnded(conversationId);
        expect(enqueued).toEqual([]);
      });

      it('ignores our own outbound messages', async () => {
        const conversationId = await outreachConversation({
          extractionSchema: FIELDS,
          channelType: 'email',
        });
        await replyReceived(conversationId, { authorType: 'agent' });
        expect(enqueued).toEqual([]);
      });

      it('ignores a campaign with no declared fields', async () => {
        const conversationId = await outreachConversation({ extractionSchema: [] });
        await callEnded(conversationId);
        expect(enqueued).toEqual([]);
      });

      it('ignores a voice call that belongs to no campaign', async () => {
        const conversationId = await outreachConversation({
          extractionSchema: FIELDS,
          linkCampaign: false,
        });
        await callEnded(conversationId);
        expect(enqueued).toEqual([]);
      });

      it('ignores a conversation with no proposal to resolve the contact from', async () => {
        const conversationId = await outreachConversation({
          extractionSchema: FIELDS,
          linkProposal: false,
        });
        await callEnded(conversationId);
        expect(enqueued).toEqual([]);
      });

      it('ignores every other event type', async () => {
        const conversationId = await outreachConversation({ extractionSchema: FIELDS });
        await emit('conversation.status_changed', { conversationId });
        expect(enqueued).toEqual([]);
      });
    });
  });
});
