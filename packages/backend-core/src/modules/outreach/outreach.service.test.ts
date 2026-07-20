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
import { OutreachService, OutreachInvalidError } from './outreach.service.ts';
import { CrmService } from '../crm/crm.service.ts';
import { DefaultQuotasService } from '../../common/quotas/quotas.service.ts';
import { ConvService } from '../conv/conv.service.ts';
import { AlertsService } from '../system-alerts/system-alerts.service.ts';
import { VapiClientService } from '../conv/vapi/vapi-client.service.ts';
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
    const vapi = new VapiClientService(db);
    svc = new OutreachService(dispatcher, conv, crm, email, vapi, db);
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

    // Seed: one email channel, one segment with one consenting contact.
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

      const approved = await run(() =>
        svc.approveProposal(p.id, { publicBaseUrl: 'https://test.local' }),
      );
      expect(approved.status).toBe('sent');
      expect(approved.conversationId).toBeTruthy();
      expect(approved.sentMessageId).toBeTruthy();
      expect(approved.contact?.email).toBe('jane@acme.com');
      expect(approved.campaign?.name).toBe('launch');

      // Conversation has the campaign id stamped.
      const convRows = await db.execute<{ outreach_campaign_id: string | null }>(
        sql`SELECT outreach_campaign_id FROM conv_conversations WHERE id = ${approved.conversationId!}`,
      );
      expect(convRows[0]!.outreach_campaign_id).toBe(c.id);

      // Message body contains the unsubscribe footer with our public base url.
      const msgRows = await db.execute<{ body: string }>(
        sql`SELECT body FROM conv_messages WHERE id = ${approved.sentMessageId!}`,
      );
      expect(msgRows[0]!.body).toContain('[Unsubscribe](https://test.local/v1/outreach/unsubscribe?token=');

      // An outbound delivery row was queued (email channel + agent author).
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
      // Suppress the contact AFTER the draft.
      await run(() =>
        crm.updateContact({ id: contactId, patch: { doNotContact: true } }),
      );
      await expect(
        run(() => svc.approveProposal(p.id, { publicBaseUrl: 'https://test.local' })),
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
        run(() => svc.approveProposal(p.id, { publicBaseUrl: 'https://test.local' })),
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
        svc.approveProposal(p.id, { publicBaseUrl: 'https://test.local' }),
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
        svc.approveProposal(initial.id, { publicBaseUrl: 'https://test.local' }),
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
        svc.approveProposal(initial.id, { publicBaseUrl: 'https://test.local' }),
      );
      const reply = await run(() =>
        svc.proposeReply({
          conversationId: sent.conversationId!,
          draftBody: 'Sure — Tuesday works.',
        }),
      );
      const approved = await run(() =>
        svc.approveProposal(reply.id, { publicBaseUrl: 'https://test.local' }),
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
      void ch; // not used; we want a bare conversation
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

  describe('sequences', () => {
    const STEPS = [
      { waitDays: 3, brief: 'gentle bump' },
      { waitDays: 4, brief: 'share a relevant case study' },
    ];

    function createSeqCampaign(
      name: string,
      steps = STEPS,
      extras: { enabled?: boolean } = {},
    ) {
      return run(() =>
        svc.createCampaign({
          name,
          brief: 'Sequence test campaign.',
          segmentId,
          channelId,
          sequenceSteps: steps,
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
      return run(() => svc.approveProposal(p.id, { publicBaseUrl: 'https://test.local' }));
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
        svc.approveProposal(p1.id, { publicBaseUrl: 'https://test.local' }),
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
        svc.approveProposal(p.id, { publicBaseUrl: 'https://test.local' }),
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
        run(() => svc.approveProposal(p.id, { publicBaseUrl: 'https://test.local' })),
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
        run(() => svc.approveProposal(p.id, { publicBaseUrl: 'https://test.local' })),
      ).rejects.toThrow(/disabled/);

      await run(() => svc.updateCampaign({ id: c.id, patch: { enabled: true } }));
      await db
        .update(schema.crmContacts)
        .set({ unsubscribedAt: new Date() })
        .where(eq(schema.crmContacts.id, contactId));
      await expect(
        run(() => svc.approveProposal(p.id, { publicBaseUrl: 'https://test.local' })),
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
        svc.approveProposal(p1.id, { publicBaseUrl: 'https://test.local' }),
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
          svc.approveProposal(p1.id, { publicBaseUrl: 'https://test.local' }),
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

    function runAsSystem<T>(fn: () => Promise<T>): Promise<T> {
      return db.transaction(async (tx) => {
        await tx.execute(sql`SELECT set_config('app.bypass_rls', 'on', true)`);
        await tx.execute(
          sql`SELECT set_config('app.crypt_key', ${process.env.MUNIN_ENCRYPTION_KEY ?? ''}, true)`,
        );
        const ctx: RequestContext = { db: tx, actor, correlationId: randomUUID() };
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
      const approved = await runAsSystem(() =>
        svc.approveProposal(p.id, { publicBaseUrl: 'http://localhost:3001' }),
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
      const approved = await runAsSystem(() =>
        svc.approveProposal(p.id, { publicBaseUrl: 'http://localhost:3001' }),
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
      const approved = await runAsSystem(() =>
        svc.approveProposal(p.id, { publicBaseUrl: 'http://localhost:3001' }),
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
  });
});
