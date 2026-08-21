import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import { StubEmbeddingProvider, WebhookDispatcher } from '@getmunin/core';
import { createDb, runMigrations, schema } from '@getmunin/db';
import { ConvService } from '../conv/conv.service.ts';
import { ConversationClaimsService } from '../conv/conv.claims.service.ts';
import { AlertsService } from '../system-alerts/system-alerts.service.ts';
import { CuratorJobsService } from '../curator/curator-jobs.service.ts';
import { CrmService } from '../crm/crm.service.ts';
import { EmbeddingProviderHolder } from '../kb/embedding.provider.ts';
import { KbService } from '../kb/kb.service.ts';
import { EmailService } from '../conv/email/email.service.ts';
import { OutreachService } from '../outreach/outreach.service.ts';
import { VapiClientService } from '../conv/vapi/vapi-client.service.ts';
import { VapiOutreachCaller } from '../conv/vapi/vapi-outreach-caller.ts';
import { DefaultQuotasService } from '../../common/quotas/quotas.service.ts';
import { SlackApiClient } from './slack-api.client.ts';
import { SlackEventSink } from './slack-event-sink.ts';
import { SlackInteractionsService } from './slack-interactions.service.ts';
import { SlackUserMappingService } from './slack-user-mapping.service.ts';
import { SlackService, encryptSecretValue } from './slack.service.ts';
import { mergeFingerprint } from '../crm/merge-fingerprint.ts';

const TEST_URL = process.env.TEST_DATABASE_URL;
const skipReason = TEST_URL
  ? null
  : 'Set TEST_DATABASE_URL to a Postgres URL to run slack interaction tests.';

const THREAD_TS = '1750000000.000200';
const CHANNEL = 'C_ACTIONS';

class FakeSlackApi extends SlackApiClient {
  usersById = new Map<string, { email: string | null }>();
  ephemerals: { user: string; text: string }[] = [];
  updated: { channel: string; ts: string; text: string }[] = [];

  override usersInfo(input: { token: string; user: string }) {
    const entry = this.usersById.get(input.user);
    return Promise.resolve({
      id: input.user,
      email: entry?.email ?? null,
      displayName: 'Fake User',
      isBot: false,
    });
  }

  override postEphemeral(input: { token: string; channel: string; user: string; text: string }) {
    this.ephemerals.push({ user: input.user, text: input.text });
    return Promise.resolve();
  }

  override conversationsInfo(input: { token: string; channel: string }) {
    return Promise.resolve({ id: input.channel, name: 'routed', isMember: true });
  }

  override updateMessage(input: { token: string; channel: string; ts: string; text: string }) {
    this.updated.push({ channel: input.channel, ts: input.ts, text: input.text });
    return Promise.resolve();
  }

}

(skipReason ? describe.skip : describe)('Slack interactions (buttons)', () => {
  let db: ReturnType<typeof createDb>;
  let orgId: string;
  let memberUserId: string;
  let memberEmail: string;
  let otherUserId: string;
  let channelId: string;
  let conversationId: string;
  let integrationId: string;
  let api: FakeSlackApi;
  let interactions: SlackInteractionsService;
  let displayIdSeq = 0;

  beforeAll(async () => {
    process.env.MUNIN_ENCRYPTION_KEY ??= 'slack-interactions-test-encryption-key';
    await runMigrations(TEST_URL!);
    db = createDb(TEST_URL!, { serviceRole: true });

    const ts = Date.now();
    const [org] = await db
      .insert(schema.orgs)
      .values({ name: 'Slack Interactions Test Org' })
      .returning();
    orgId = org!.id;
    memberEmail = `slack-actions-${ts}@example.com`;
    const [member] = await db
      .insert(schema.users)
      .values({ email: memberEmail, name: 'Bella Button' })
      .returning();
    memberUserId = member!.id;
    const [other] = await db
      .insert(schema.users)
      .values({ email: `slack-actions-other-${ts}@example.com`, name: 'Otto Other' })
      .returning();
    otherUserId = other!.id;
    await db.insert(schema.orgMembers).values([
      { orgId, userId: memberUserId },
      { orgId, userId: otherUserId },
    ]);

    const [channel] = await db
      .insert(schema.convChannels)
      .values({ orgId, type: 'chat', vendor: 'widget', name: 'Website chat' })
      .returning();
    channelId = channel!.id;
  });

  afterAll(async () => {
    if (db) {
      await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
      await db.delete(schema.orgs).where(sql`id = ${orgId}`);
      await db.delete(schema.users).where(eq(schema.users.id, memberUserId));
      await db.delete(schema.users).where(eq(schema.users.id, otherUserId));
    }
  });

  beforeEach(async () => {
    await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
    await db.delete(schema.slackIntegrations).where(eq(schema.slackIntegrations.orgId, orgId));
    await db.execute(sql`DELETE FROM claims WHERE org_id = ${orgId}`);
    await db.execute(sql`DELETE FROM curator_jobs WHERE org_id = ${orgId}`);
    await db.execute(sql`DELETE FROM conv_conversations WHERE org_id = ${orgId}`);
    await db.execute(sql`DELETE FROM events WHERE org_id = ${orgId}`);

    const encryptedBotToken = await encryptSecretValue(db, 'xoxb-actions-token');
    const [integration] = await db
      .insert(schema.slackIntegrations)
      .values({ orgId, teamId: 'T_ACTIONS', encryptedBotToken })
      .returning();
    integrationId = integration!.id;

    displayIdSeq += 1;
    const [conversation] = await db
      .insert(schema.convConversations)
      .values({ orgId, displayId: displayIdSeq, channelId })
      .returning();
    conversationId = conversation!.id;
    await db.insert(schema.slackConversationLinks).values({
      orgId,
      integrationId,
      conversationId,
      slackChannelId: CHANNEL,
      slackThreadTs: THREAD_TS,
    });

    api = new FakeSlackApi();
    api.usersById.set('U_BELLA', { email: memberEmail });
    const dispatcher = new WebhookDispatcher();
    dispatcher.registerSink(new SlackEventSink());
    const claims = new ConversationClaimsService(dispatcher);
    const conv = new ConvService(dispatcher, claims, new CuratorJobsService(dispatcher), new AlertsService(dispatcher));
    const crm = new CrmService(dispatcher, new DefaultQuotasService());
    const outreach = new OutreachService(
      dispatcher,
      conv,
      crm,
      new EmailService(),
      [new VapiOutreachCaller(new VapiClientService(db))],
      db,
      new CuratorJobsService(dispatcher),
    );
    const embeddingHolder = new (class extends EmbeddingProviderHolder {
      override get() {
        return new StubEmbeddingProvider();
      }
    })();
    const kb = new KbService(embeddingHolder, new DefaultQuotasService(), dispatcher);
    interactions = new SlackInteractionsService(
      db,
      api,
      conv,
      claims,
      new SlackUserMappingService(db, api),
      new SlackService(db, api),
      crm,
      outreach,
      kb,
    );
  });

  function actionPayload(actionId: string, overrides: Record<string, unknown> = {}) {
    return {
      type: 'block_actions',
      user: { id: 'U_BELLA' },
      channel: { id: CHANNEL },
      actions: [{ action_id: actionId, value: conversationId }],
      ...overrides,
    };
  }

  async function conversation() {
    const [row] = await db
      .select()
      .from(schema.convConversations)
      .where(eq(schema.convConversations.id, conversationId));
    return row!;
  }

  it('claim button claims the conversation as the mapped member and mirrors the event', async () => {
    await interactions.processBlockActions(actionPayload('munin_claim'));

    const [claim] = await db
      .select()
      .from(schema.claims)
      .where(and(eq(schema.claims.entityType, 'conversation'), eq(schema.claims.entityId, conversationId)));
    expect(claim?.userId).toBe(memberUserId);

    const deliveries = await db
      .select({ eventType: schema.slackDeliveries.eventType })
      .from(schema.slackDeliveries)
      .where(eq(schema.slackDeliveries.conversationId, conversationId));
    expect(deliveries.map((d) => d.eventType)).toContain('conversation.taken_over');
    expect(api.ephemerals).toHaveLength(0);
  });

  it('close and reopen buttons change status through the normal path', async () => {
    await interactions.processBlockActions(actionPayload('munin_close'));
    expect((await conversation()).status).toBe('closed');

    await interactions.processBlockActions(actionPayload('munin_reopen'));
    expect((await conversation()).status).toBe('open');

    const deliveries = await db
      .select({ eventType: schema.slackDeliveries.eventType })
      .from(schema.slackDeliveries)
      .where(eq(schema.slackDeliveries.conversationId, conversationId));
    expect(deliveries.filter((d) => d.eventType === 'conversation.status_changed')).toHaveLength(2);
  });

  it('rejects an unmapped user with an ephemeral notice and no state change', async () => {
    api.usersById.set('U_STRANGER', { email: 'stranger@example.com' });
    await interactions.processBlockActions(
      actionPayload('munin_close', { user: { id: 'U_STRANGER' } }),
    );

    expect((await conversation()).status).toBe('open');
    expect(api.ephemerals).toHaveLength(1);
  });

  it('tells the clicker when the conversation is already claimed by someone else', async () => {
    await db.insert(schema.claims).values({
      orgId,
      entityType: 'conversation',
      entityId: conversationId,
      userId: otherUserId,
      expiresAt: new Date(Date.now() + 60_000),
    });

    await interactions.processBlockActions(actionPayload('munin_claim'));

    const rows = await db
      .select()
      .from(schema.claims)
      .where(and(eq(schema.claims.entityType, 'conversation'), eq(schema.claims.entityId, conversationId)));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.userId).toBe(otherUserId);
    expect(api.ephemerals).toHaveLength(1);
    expect(api.ephemerals[0]!.text).toContain('already taken over');
  });

  it('release button hands the conversation back when clicked by the holder', async () => {
    await interactions.processBlockActions(actionPayload('munin_claim'));
    await interactions.processBlockActions(actionPayload('munin_release'));

    const rows = await db
      .select()
      .from(schema.claims)
      .where(and(eq(schema.claims.entityType, 'conversation'), eq(schema.claims.entityId, conversationId)));
    expect(rows).toHaveLength(0);
    expect(api.ephemerals).toHaveLength(0);

    const deliveries = await db
      .select({ eventType: schema.slackDeliveries.eventType })
      .from(schema.slackDeliveries)
      .where(eq(schema.slackDeliveries.conversationId, conversationId));
    expect(deliveries.map((d) => d.eventType)).toContain('conversation.released');
  });

  it('release by a non-holder is rejected with an ephemeral and keeps the claim', async () => {
    await db.insert(schema.claims).values({
      orgId,
      entityType: 'conversation',
      entityId: conversationId,
      userId: otherUserId,
      expiresAt: new Date(Date.now() + 60_000),
    });

    await interactions.processBlockActions(actionPayload('munin_release'));

    const rows = await db
      .select()
      .from(schema.claims)
      .where(and(eq(schema.claims.entityType, 'conversation'), eq(schema.claims.entityId, conversationId)));
    expect(rows).toHaveLength(1);
    expect(api.ephemerals).toHaveLength(1);
    expect(api.ephemerals[0]!.text).toContain('release');
  });

  it('ignores payloads whose channel does not match the thread link', async () => {
    await interactions.processBlockActions(
      actionPayload('munin_close', { channel: { id: 'C_ELSEWHERE' } }),
    );
    expect((await conversation()).status).toBe('open');
    expect(api.ephemerals).toHaveLength(0);
  });

  it('ignores unknown actions and unknown conversations', async () => {
    await interactions.processBlockActions(actionPayload('munin_snooze'));
    await interactions.processBlockActions({
      type: 'block_actions',
      user: { id: 'U_BELLA' },
      channel: { id: CHANNEL },
      actions: [{ action_id: 'munin_close', value: 'ccv_nonexistent' }],
    });
    expect((await conversation()).status).toBe('open');
  });

  describe('route prompt buttons', () => {
    function routePayload(actionId: string, overrides: Record<string, unknown> = {}) {
      return {
        type: 'block_actions',
        user: { id: 'U_BELLA' },
        channel: { id: 'C_FRESH' },
        message: { ts: '1750000000.000900' },
        actions: [{ action_id: actionId, value: integrationId }],
        ...overrides,
      };
    }

    async function routes() {
      return db
        .select()
        .from(schema.slackChannelRoutes)
        .where(eq(schema.slackChannelRoutes.slackChannelId, 'C_FRESH'));
    }

    it('sets the default route when an owner clicks and replaces the prompt with a confirmation', async () => {
      await interactions.processBlockActions(routePayload('munin_route_default'));

      const rows = await routes();
      expect(rows).toHaveLength(1);
      expect(rows[0]!.purpose).toBe('default');
      expect(rows[0]!.orgId).toBe(orgId);
      expect(api.updated).toHaveLength(1);
      expect(api.updated[0]!.text).toContain('all mirrored conversations');
      expect(api.updated[0]!.text).toContain('<@U_BELLA>');
    });

    it('sets an escalations route from the escalations button', async () => {
      await interactions.processBlockActions(routePayload('munin_route_escalations'));

      const rows = await routes();
      expect(rows).toHaveLength(1);
      expect(rows[0]!.purpose).toBe('escalations');
    });

    it('rejects a member-role clicker with an ephemeral and no route change', async () => {
      await db
        .update(schema.orgMembers)
        .set({ role: 'member' })
        .where(and(eq(schema.orgMembers.orgId, orgId), eq(schema.orgMembers.userId, otherUserId)));
      const otherEmail = `slack-actions-other-role-${Date.now()}@example.com`;
      await db.update(schema.users).set({ email: otherEmail }).where(eq(schema.users.id, otherUserId));
      api.usersById.set('U_OTTO', { email: otherEmail });

      await interactions.processBlockActions(
        routePayload('munin_route_default', { user: { id: 'U_OTTO' } }),
      );

      expect(await routes()).toHaveLength(0);
      expect(api.ephemerals).toHaveLength(1);
      expect(api.ephemerals[0]!.text).toContain('owners and admins');
    });

    it('rejects an unmapped clicker with an ephemeral', async () => {
      api.usersById.set('U_NOBODY', { email: 'nobody@example.com' });
      await interactions.processBlockActions(
        routePayload('munin_route_default', { user: { id: 'U_NOBODY' } }),
      );

      expect(await routes()).toHaveLength(0);
      expect(api.ephemerals).toHaveLength(1);
    });

    it('dismiss updates the prompt without creating a route', async () => {
      await interactions.processBlockActions(routePayload('munin_route_dismiss'));

      expect(await routes()).toHaveLength(0);
      expect(api.updated).toHaveLength(1);
      expect(api.updated[0]!.text).toContain('dashboard');
    });

    it('surfaces a routing conflict as an ephemeral instead of silence', async () => {
      await db.insert(schema.slackChannelRoutes).values({
        orgId,
        integrationId,
        teamId: 'T_ACTIONS',
        slackChannelId: 'C_FRESH',
        purpose: 'escalations',
      });

      await interactions.processBlockActions(routePayload('munin_route_default'));

      expect(api.ephemerals).toHaveLength(1);
      expect(api.ephemerals[0]!.text).toContain('slack_conflict');
    });
  });
  describe('approval buttons', () => {
    const APPROVAL_CHANNEL = 'C_APPROVALS';
    const APPROVAL_TS = '1750000000.000500';

    beforeEach(async () => {
      await db.execute(sql`DELETE FROM crm_merge_proposals WHERE org_id = ${orgId}`);
      await db.execute(sql`DELETE FROM outreach_proposals WHERE org_id = ${orgId}`);
      await db.execute(sql`DELETE FROM outreach_campaigns WHERE org_id = ${orgId}`);
      await db.execute(sql`DELETE FROM crm_segments WHERE org_id = ${orgId}`);
      await db.execute(sql`DELETE FROM crm_contacts WHERE org_id = ${orgId}`);
      await db.execute(sql`DELETE FROM kb_documents WHERE org_id = ${orgId}`);
      await db.execute(sql`DELETE FROM kb_spaces WHERE org_id = ${orgId}`);
    });

    async function linkSubject(subjectType: string, subjectId: string) {
      await db.insert(schema.slackNotificationLinks).values({
        orgId,
        integrationId,
        subjectType,
        subjectId,
        slackChannelId: APPROVAL_CHANNEL,
        slackTs: APPROVAL_TS,
      });
    }

    function approvalPayload(
      actionId: string,
      value: string,
      overrides: Record<string, unknown> = {},
    ) {
      return {
        type: 'block_actions',
        user: { id: 'U_BELLA' },
        channel: { id: APPROVAL_CHANNEL },
        actions: [{ action_id: actionId, value }],
        ...overrides,
      };
    }

    async function seedMergeProposal(): Promise<string> {
      const [a] = await db
        .insert(schema.crmContacts)
        .values({ orgId, name: 'Ada Lovelace', email: 'ada@example.com' })
        .returning();
      const [b] = await db
        .insert(schema.crmContacts)
        .values({ orgId, name: 'A. Lovelace', email: 'ada.l@example.com' })
        .returning();
      const [proposal] = await db
        .insert(schema.crmMergeProposals)
        .values({
          orgId,
          contactAId: a!.id,
          contactBId: b!.id,
          confidence: 'high',
          recommendedKeeperId: a!.id,
          proposedByActorType: 'agent',
          proposedByActorId: 'agt_test',
        })
        .returning();
      return proposal!.id;
    }

    async function seedOutreachProposal(status = 'pending'): Promise<string> {
      const [contact] = await db
        .insert(schema.crmContacts)
        .values({ orgId, name: 'Grace Hopper', email: 'grace@example.com' })
        .returning();
      const [segment] = await db
        .insert(schema.crmSegments)
        .values({
          orgId,
          name: 'Prospects',
          createdByActorType: 'agent',
          createdByActorId: 'agt_test',
        })
        .returning();
      const [campaign] = await db
        .insert(schema.outreachCampaigns)
        .values({
          orgId,
          name: 'Launch',
          brief: 'Announce',
          segmentId: segment!.id,
          channelId,
          createdByActorType: 'agent',
          createdByActorId: 'agt_test',
        })
        .returning();
      const [proposal] = await db
        .insert(schema.outreachProposals)
        .values({
          orgId,
          campaignId: campaign!.id,
          contactId: contact!.id,
          kind: 'initial',
          draftSubject: 'Hi',
          draftBody: 'Want a demo?',
          status,
          proposedByActorType: 'agent',
          proposedByActorId: 'agt_test',
        })
        .returning();
      return proposal!.id;
    }

    async function seedKbCandidate(tags: string[]): Promise<string> {
      const [space] = await db
        .insert(schema.kbSpaces)
        .values({ orgId, name: 'Curation inbox', slug: 'curation-inbox' })
        .returning();
      const [doc] = await db
        .insert(schema.kbDocuments)
        .values({
          orgId,
          spaceId: space!.id,
          title: 'Weekend hours',
          body: 'We open 10-16 Saturdays.',
          contentHash: 'x'.repeat(64),
          tags,
          createdByType: 'agent',
          createdById: 'agt_test',
          updatedByType: 'agent',
          updatedById: 'agt_test',
        })
        .returning();
      return doc!.id;
    }

    it('apply-merge button applies the proposal as the mapped member and enqueues the resolution', async () => {
      const proposalId = await seedMergeProposal();
      await linkSubject('crm_merge_proposal', proposalId);
      const [seeded] = await db
        .select()
        .from(schema.crmMergeProposals)
        .where(eq(schema.crmMergeProposals.id, proposalId));

      await interactions.processBlockActions(
        approvalPayload(
          'munin_approval_approve',
          `crm_merge_proposal:${proposalId}#${mergeFingerprint(seeded!)}`,
        ),
      );

      const [proposal] = await db
        .select()
        .from(schema.crmMergeProposals)
        .where(eq(schema.crmMergeProposals.id, proposalId));
      expect(proposal!.status).toBe('applied');
      expect(proposal!.decidedByActorType).toBe('user');
      expect(proposal!.decidedByActorId).toBe(memberUserId);
      expect(api.ephemerals).toHaveLength(0);

      const deliveries = await db
        .select({ eventType: schema.slackDeliveries.eventType, subjectKey: schema.slackDeliveries.subjectKey })
        .from(schema.slackDeliveries)
        .where(eq(schema.slackDeliveries.integrationId, integrationId));
      const resolution = deliveries.find((d) => d.eventType === 'crm.merge_proposal.applied');
      expect(resolution?.subjectKey).toBe(`crm_merge_proposal:${proposalId}`);
    });

    it('dismiss button dismisses an outreach proposal', async () => {
      const proposalId = await seedOutreachProposal();
      await linkSubject('outreach_proposal', proposalId);

      await interactions.processBlockActions(
        approvalPayload('munin_approval_dismiss', `outreach_proposal:${proposalId}`),
      );

      const [proposal] = await db
        .select()
        .from(schema.outreachProposals)
        .where(eq(schema.outreachProposals.id, proposalId));
      expect(proposal!.status).toBe('dismissed');
      expect(proposal!.decidedByActorId).toBe(memberUserId);
      expect(api.ephemerals).toHaveLength(0);
    });

    it('refuses an approve button whose fingerprint no longer matches the draft', async () => {
      const proposalId = await seedOutreachProposal();
      await linkSubject('outreach_proposal', proposalId);

      await interactions.processBlockActions(
        approvalPayload('munin_approval_approve', `outreach_proposal:${proposalId}#stale`),
      );

      const [proposal] = await db
        .select()
        .from(schema.outreachProposals)
        .where(eq(schema.outreachProposals.id, proposalId));
      expect(proposal!.status).toBe('pending');
      expect(proposal!.sentAt).toBeNull();
      expect(api.ephemerals).toHaveLength(1);
      expect(api.ephemerals[0]!.text).toContain('outreach_conflict');
    });

    it('refuses an approve button that carries no fingerprint at all', async () => {
      const proposalId = await seedOutreachProposal();
      await linkSubject('outreach_proposal', proposalId);

      await interactions.processBlockActions(
        approvalPayload('munin_approval_approve', `outreach_proposal:${proposalId}`),
      );

      const [proposal] = await db
        .select()
        .from(schema.outreachProposals)
        .where(eq(schema.outreachProposals.id, proposalId));
      expect(proposal!.status).toBe('pending');
      expect(api.ephemerals).toHaveLength(1);
      expect(api.ephemerals[0]!.text).toContain('outreach_conflict');
    });

    it('surfaces a service rejection (already dismissed) as an ephemeral', async () => {
      const proposalId = await seedOutreachProposal('dismissed');
      await linkSubject('outreach_proposal', proposalId);

      await interactions.processBlockActions(
        approvalPayload('munin_approval_approve', `outreach_proposal:${proposalId}`),
      );

      const [proposal] = await db
        .select()
        .from(schema.outreachProposals)
        .where(eq(schema.outreachProposals.id, proposalId));
      expect(proposal!.status).toBe('dismissed');
      expect(api.ephemerals).toHaveLength(1);
      expect(api.ephemerals[0]!.text).toContain(':no_entry:');
    });

    it('publishes a KB candidate to its proposed target space', async () => {
      const candidateId = await seedKbCandidate(['curation', 'candidate', 'target:faq']);
      await linkSubject('kb_curation_candidate', candidateId);
      const [seeded] = await db
        .select()
        .from(schema.kbDocuments)
        .where(eq(schema.kbDocuments.id, candidateId));

      await interactions.processBlockActions(
        approvalPayload(
          'munin_approval_approve',
          `kb_curation_candidate:${candidateId}#${seeded!.version}`,
        ),
      );

      expect(api.ephemerals).toHaveLength(0);
      const [candidate] = await db
        .select()
        .from(schema.kbDocuments)
        .where(eq(schema.kbDocuments.id, candidateId));
      expect(candidate).toBeUndefined();

      const published = await db
        .select({ title: schema.kbDocuments.title, slug: schema.kbSpaces.slug })
        .from(schema.kbDocuments)
        .innerJoin(schema.kbSpaces, eq(schema.kbSpaces.id, schema.kbDocuments.spaceId))
        .where(eq(schema.kbDocuments.orgId, orgId));
      expect(published).toEqual([{ title: 'Weekend hours', slug: 'faq' }]);
    });

    it('refuses an apply-merge button whose fingerprint no longer matches the proposal', async () => {
      const proposalId = await seedMergeProposal();
      await linkSubject('crm_merge_proposal', proposalId);
      const [seeded] = await db
        .select()
        .from(schema.crmMergeProposals)
        .where(eq(schema.crmMergeProposals.id, proposalId));
      await db
        .update(schema.crmMergeProposals)
        .set({ recommendedKeeperId: seeded!.contactBId })
        .where(eq(schema.crmMergeProposals.id, proposalId));

      await interactions.processBlockActions(
        approvalPayload(
          'munin_approval_approve',
          `crm_merge_proposal:${proposalId}#${mergeFingerprint(seeded!)}`,
        ),
      );

      const [proposal] = await db
        .select()
        .from(schema.crmMergeProposals)
        .where(eq(schema.crmMergeProposals.id, proposalId));
      expect(proposal!.status).toBe('pending');
      expect(proposal!.decidedAt).toBeNull();
      expect(api.ephemerals).toHaveLength(1);
      expect(api.ephemerals[0]!.text).toContain('crm_conflict');
    });

    it('refuses a publish button whose version no longer matches the candidate', async () => {
      const candidateId = await seedKbCandidate(['curation', 'candidate', 'target:faq']);
      await linkSubject('kb_curation_candidate', candidateId);
      const [seeded] = await db
        .select()
        .from(schema.kbDocuments)
        .where(eq(schema.kbDocuments.id, candidateId));
      await db
        .update(schema.kbDocuments)
        .set({ body: 'Rewritten after the card was posted.', version: seeded!.version + 1 })
        .where(eq(schema.kbDocuments.id, candidateId));

      await interactions.processBlockActions(
        approvalPayload(
          'munin_approval_approve',
          `kb_curation_candidate:${candidateId}#${seeded!.version}`,
        ),
      );

      expect(api.ephemerals).toHaveLength(1);
      expect(api.ephemerals[0]!.text).toContain('kb_version_conflict');
      const [candidate] = await db
        .select()
        .from(schema.kbDocuments)
        .where(eq(schema.kbDocuments.id, candidateId));
      expect(candidate).toBeDefined();
      expect(candidate!.tags).toContain('candidate');
    });

    it('asks for a target space when the candidate has none, leaving it untouched', async () => {
      const candidateId = await seedKbCandidate(['curation', 'candidate']);
      await linkSubject('kb_curation_candidate', candidateId);

      await interactions.processBlockActions(
        approvalPayload('munin_approval_approve', `kb_curation_candidate:${candidateId}`),
      );

      expect(api.ephemerals).toHaveLength(1);
      expect(api.ephemerals[0]!.text).toContain('no proposed target space');
      const [candidate] = await db
        .select()
        .from(schema.kbDocuments)
        .where(eq(schema.kbDocuments.id, candidateId));
      expect(candidate).toBeDefined();
    });

    it('dismiss button deletes a KB candidate', async () => {
      const candidateId = await seedKbCandidate(['curation', 'candidate', 'target:faq']);
      await linkSubject('kb_curation_candidate', candidateId);

      await interactions.processBlockActions(
        approvalPayload('munin_approval_dismiss', `kb_curation_candidate:${candidateId}`),
      );

      expect(api.ephemerals).toHaveLength(0);
      const [candidate] = await db
        .select()
        .from(schema.kbDocuments)
        .where(eq(schema.kbDocuments.id, candidateId));
      expect(candidate).toBeUndefined();
    });

    it('rejects an unmapped clicker with an ephemeral and no state change', async () => {
      const proposalId = await seedMergeProposal();
      await linkSubject('crm_merge_proposal', proposalId);
      api.usersById.set('U_NOBODY', { email: 'nobody@example.com' });

      await interactions.processBlockActions(
        approvalPayload('munin_approval_approve', `crm_merge_proposal:${proposalId}`, {
          user: { id: 'U_NOBODY' },
        }),
      );

      const [proposal] = await db
        .select()
        .from(schema.crmMergeProposals)
        .where(eq(schema.crmMergeProposals.id, proposalId));
      expect(proposal!.status).toBe('pending');
      expect(api.ephemerals).toHaveLength(1);
    });

    it('ignores clicks from a channel that does not match the notification link', async () => {
      const proposalId = await seedMergeProposal();
      await linkSubject('crm_merge_proposal', proposalId);

      await interactions.processBlockActions(
        approvalPayload('munin_approval_approve', `crm_merge_proposal:${proposalId}`, {
          channel: { id: 'C_ELSEWHERE' },
        }),
      );

      const [proposal] = await db
        .select()
        .from(schema.crmMergeProposals)
        .where(eq(schema.crmMergeProposals.id, proposalId));
      expect(proposal!.status).toBe('pending');
      expect(api.ephemerals).toHaveLength(0);
    });

    it('ignores malformed approval values', async () => {
      await interactions.processBlockActions(
        approvalPayload('munin_approval_approve', 'bogus_subject:cmp_x'),
      );
      expect(api.ephemerals).toHaveLength(0);
    });
  });
});
