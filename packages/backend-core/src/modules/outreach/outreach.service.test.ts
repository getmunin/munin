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
import { OutreachService, OutreachInvalidError } from './outreach.service.js';
import { CrmService } from '../crm/crm.service.js';
import { ConvService } from '../conv/conv.service.js';
import { ConversationClaimsService } from '../conv/conv.claims.service.js';
import { CuratorJobsService } from '../curator/curator-jobs.service.js';
import { EmailService } from '../conv/email/email.service.js';

const TEST_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const skipReason = TEST_URL
  ? null
  : 'Set DATABASE_URL or TEST_DATABASE_URL to a Postgres URL to run outreach service tests.';

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

    const ts = Date.now();
    const [org] = await db
      .insert(schema.orgs)
      .values({ name: 'Outreach Test Org', slug: `outreach-${ts}` })
      .returning();
    orgId = org!.id;
    actor = new ActorIdentity('admin_agent', 'agt_outreach_test', orgId, ['*'], ['admin']);

    const dispatcher = new WebhookDispatcher();
    crm = new CrmService(dispatcher);
    const claims = new ConversationClaimsService(dispatcher);
    const curatorJobs = new CuratorJobsService(dispatcher);
    conv = new ConvService(dispatcher, claims, curatorJobs);
    const email = new EmailService();
    svc = new OutreachService(dispatcher, conv, crm, email);
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
        .values({ orgId, type: 'chat', name: 'web-widget', active: true, config: {} })
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

      // Conversation has the campaign id stamped.
      const convRows = await db.execute<{ outreach_campaign_id: string | null }>(
        sql`SELECT outreach_campaign_id FROM conv_conversations WHERE id = ${approved.conversationId!}`,
      );
      expect(convRows[0]!.outreach_campaign_id).toBe(c.id);

      // Message body contains the unsubscribe footer with our public base url.
      const msgRows = await db.execute<{ body: string }>(
        sql`SELECT body FROM conv_messages WHERE id = ${approved.sentMessageId!}`,
      );
      expect(msgRows[0]!.body).toContain('Unsubscribe: https://test.local/api/v1/outreach/unsubscribe?token=');

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
    });
  });
});
