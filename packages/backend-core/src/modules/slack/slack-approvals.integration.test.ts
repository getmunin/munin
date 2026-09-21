import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { sql, eq, and } from 'drizzle-orm';
import { ActorIdentity, WebhookDispatcher, withContext, type RequestContext } from '@getmunin/core';
import { createDb, runMigrations, schema } from '@getmunin/db';
import { SlackApiError, SlackApiClient } from './slack-api.client.ts';
import { SlackBridgeWorker } from './slack-bridge.worker.ts';
import { SlackEventSink } from './slack-event-sink.ts';
import { encryptSecretValue } from './slack.service.ts';
import { draftFingerprint } from '../outreach/proposal-fingerprint.ts';
import { mergeFingerprint } from '../crm/merge-fingerprint.ts';
import { socialDraftFingerprint } from '../social/social-fingerprint.ts';
import { registerOrgScopedDashboard } from '../../common/web-url.ts';

const TEST_URL = process.env.TEST_DATABASE_URL;
const skipReason = TEST_URL
  ? null
  : 'Set TEST_DATABASE_URL to a Postgres URL to run slack approval tests.';

interface PostedMessage {
  channel: string;
  text: string;
  blocks?: unknown[];
  threadTs?: string;
  ts: string;
}

class FakeSlackApi extends SlackApiClient {
  posted: PostedMessage[] = [];
  updated: { channel: string; ts: string; text: string; blocks?: unknown[] }[] = [];
  deleted: { channel: string; ts: string }[] = [];
  failNextPosts = 0;
  private counter = 0;

  override postMessage(input: {
    token: string;
    channel: string;
    text: string;
    blocks?: unknown[];
    threadTs?: string;
  }): Promise<{ ts: string; channel: string }> {
    if (this.failNextPosts > 0) {
      this.failNextPosts -= 1;
      throw new SlackApiError('rate_limited', 1_000);
    }
    this.counter += 1;
    const ts = `${Math.floor(Date.now() / 1000)}.${String(this.counter).padStart(6, '0')}`;
    this.posted.push({
      channel: input.channel,
      text: input.text,
      blocks: input.blocks,
      threadTs: input.threadTs,
      ts,
    });
    return Promise.resolve({ ts, channel: input.channel });
  }

  override updateMessage(input: {
    token: string;
    channel: string;
    ts: string;
    text: string;
    blocks?: unknown[];
  }): Promise<void> {
    this.updated.push({
      channel: input.channel,
      ts: input.ts,
      text: input.text,
      blocks: input.blocks,
    });
    return Promise.resolve();
  }

  override deleteMessage(input: { token: string; channel: string; ts: string }): Promise<void> {
    this.deleted.push({ channel: input.channel, ts: input.ts });
    return Promise.resolve();
  }
}

function actionIds(blocks: unknown[] | undefined): string[] {
  const actions = (blocks ?? []).find(
    (b): b is { type: string; elements: { action_id: string }[] } =>
      typeof b === 'object' && b !== null && (b as { type?: string }).type === 'actions',
  );
  return actions?.elements.map((e) => e.action_id) ?? [];
}

function buttonLabels(blocks: unknown[] | undefined): string[] {
  const actions = (blocks ?? []).find(
    (b): b is { type: string; elements: { text: { text: string } }[] } =>
      typeof b === 'object' && b !== null && (b as { type?: string }).type === 'actions',
  );
  return actions?.elements.map((e) => e.text.text) ?? [];
}

function buttonValues(blocks: unknown[] | undefined): string[] {
  const actions = (blocks ?? []).find(
    (b): b is { type: string; elements: { value: string }[] } =>
      typeof b === 'object' && b !== null && (b as { type?: string }).type === 'actions',
  );
  return actions?.elements.map((e) => e.value) ?? [];
}

(skipReason ? describe.skip : describe)('Slack approval notifications', () => {
  let db: ReturnType<typeof createDb>;
  let appDb: ReturnType<typeof createDb>;
  let orgId: string;
  let integrationId: string;
  let userId: string;
  let contactAId: string;
  let contactBId: string;
  let segmentId: string;
  let channelId: string;
  let campaignId: string;
  let spaceId: string;
  let collectionId: string;
  let actor: ActorIdentity;
  let dispatcher: WebhookDispatcher;

  beforeAll(async () => {
    process.env.MUNIN_ENCRYPTION_KEY ??= 'slack-approvals-test-encryption-key';
    await runMigrations(TEST_URL!);
    db = createDb(TEST_URL!, { serviceRole: true });
    const appUrl = TEST_URL!.replace(
      /(postgres(?:ql)?:\/\/)[^:@]+:[^@]+@/,
      '$1munin_app:munin_app@',
    );
    appDb = createDb(appUrl);

    const [org] = await db
      .insert(schema.orgs)
      .values({ name: 'Slack Approvals Test Org' })
      .returning();
    orgId = org!.id;
    actor = new ActorIdentity('admin_agent', 'agt_approvals_test', orgId, ['*'], ['admin']);

    const [user] = await db
      .insert(schema.users)
      .values({ email: `slack-approvals-${Date.now()}@example.com`, name: 'Dana Decider' })
      .returning();
    userId = user!.id;

    const [channel] = await db
      .insert(schema.convChannels)
      .values({ orgId, type: 'email', vendor: 'smtp', name: 'Outbound' })
      .returning();
    channelId = channel!.id;
    const [segment] = await db
      .insert(schema.crmSegments)
      .values({
        orgId,
        name: 'Prospects',
        createdByActorType: 'agent',
        createdByActorId: 'agt_approvals_test',
      })
      .returning();
    segmentId = segment!.id;
    const [campaign] = await db
      .insert(schema.outreachCampaigns)
      .values({
        orgId,
        name: 'Spring launch',
        brief: 'Announce the launch',
        segmentId,
        channelId,
        createdByActorType: 'agent',
        createdByActorId: 'agt_approvals_test',
      })
      .returning();
    campaignId = campaign!.id;
    const [collection] = await db
      .insert(schema.cmsCollections)
      .values({
        orgId,
        name: 'Blog',
        slug: 'blog',
        fields: [
          { name: 'title', type: 'text', required: true },
          { name: 'body', type: 'markdown' },
        ],
      })
      .returning();
    collectionId = collection!.id;
    const [space] = await db
      .insert(schema.kbSpaces)
      .values({ orgId, name: 'Curation inbox', slug: 'curation-inbox' })
      .returning();
    spaceId = space!.id;
  });

  afterAll(async () => {
    if (db) {
      await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
      await db.delete(schema.orgs).where(sql`id = ${orgId}`);
      await db.delete(schema.users).where(eq(schema.users.id, userId));
    }
  });

  beforeEach(async () => {
    await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
    await db.delete(schema.slackIntegrations).where(eq(schema.slackIntegrations.orgId, orgId));
    await db.execute(sql`DELETE FROM crm_merge_proposals WHERE org_id = ${orgId}`);
    await db.execute(sql`DELETE FROM outreach_proposals WHERE org_id = ${orgId}`);
    await db.execute(sql`DELETE FROM crm_contacts WHERE org_id = ${orgId}`);
    await db.execute(sql`DELETE FROM kb_documents WHERE org_id = ${orgId}`);
    await db.execute(sql`DELETE FROM social_post_drafts WHERE org_id = ${orgId}`);
    await db.execute(sql`DELETE FROM cms_entries WHERE org_id = ${orgId}`);
    await db.execute(sql`DELETE FROM events WHERE org_id = ${orgId}`);

    const encryptedBotToken = await encryptSecretValue(db, 'xoxb-approvals-token');
    const [integration] = await db
      .insert(schema.slackIntegrations)
      .values({ orgId, teamId: 'T_APPROVALS', teamName: 'Approvalspace', encryptedBotToken })
      .returning();
    integrationId = integration!.id;
    await db.insert(schema.slackChannelRoutes).values({
      orgId,
      integrationId,
      teamId: 'T_APPROVALS',
      slackChannelId: 'C_DEFAULT',
      purpose: 'default',
    });

    const [a] = await db
      .insert(schema.crmContacts)
      .values({ orgId, name: 'Ada Lovelace', email: 'ada@example.com' })
      .returning();
    contactAId = a!.id;
    const [b] = await db
      .insert(schema.crmContacts)
      .values({ orgId, name: 'A. Lovelace', email: 'ada.l@example.com' })
      .returning();
    contactBId = b!.id;

    dispatcher = new WebhookDispatcher();
    dispatcher.registerSink(new SlackEventSink());
  });

  function emit(type: string, payload: Record<string, unknown>): Promise<string> {
    return appDb.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.bypass_rls', 'off', true)`);
      await tx.execute(sql`SELECT set_config('app.org_id', ${orgId}, true)`);
      const ctx: RequestContext = { db: tx, actor, correlationId: randomUUID() };
      return withContext(ctx, () => dispatcher.emit({ type, payload }));
    });
  }

  async function addRoute(purpose: string, slackChannelId: string) {
    await db.insert(schema.slackChannelRoutes).values({
      orgId,
      integrationId,
      teamId: 'T_APPROVALS',
      slackChannelId,
      purpose,
    });
  }

  async function seedMergeProposal(): Promise<string> {
    await db
      .update(schema.crmMergeProposals)
      .set({ status: 'dismissed' })
      .where(
        and(
          eq(schema.crmMergeProposals.orgId, orgId),
          eq(schema.crmMergeProposals.status, 'pending'),
        ),
      );
    const [proposal] = await db
      .insert(schema.crmMergeProposals)
      .values({
        orgId,
        contactAId,
        contactBId,
        confidence: 'high',
        recommendedKeeperId: contactAId,
        proposedByActorType: 'agent',
        proposedByActorId: 'agt_approvals_test',
      })
      .returning();
    return proposal!.id;
  }

  function mergePayload(proposalId: string, status = 'pending'): Record<string, unknown> {
    return {
      id: proposalId,
      contactAId,
      contactBId,
      recommendedKeeperId: contactAId,
      confidence: 'high',
      status,
    };
  }

  async function seedOutreachProposal(contactId = contactAId): Promise<string> {
    const [proposal] = await db
      .insert(schema.outreachProposals)
      .values({
        orgId,
        campaignId,
        contactId,
        kind: 'initial',
        draftSubject: 'Hello from Munin',
        draftBody: 'We just launched — want a demo?',
        proposedByActorType: 'agent',
        proposedByActorId: 'agt_approvals_test',
      })
      .returning();
    return proposal!.id;
  }

  async function seedKbCandidate(tags: string[]): Promise<string> {
    const [doc] = await db
      .insert(schema.kbDocuments)
      .values({
        orgId,
        spaceId,
        title: 'Weekend hours',
        body: 'We open 10-16 Saturdays.',
        contentHash: 'x'.repeat(64),
        tags,
        createdByType: 'agent',
        createdById: 'agt_approvals_test',
        updatedByType: 'agent',
        updatedById: 'agt_approvals_test',
      })
      .returning();
    return doc!.id;
  }

  async function notificationLink(subjectType: string, subjectId: string) {
    const [link] = await db
      .select()
      .from(schema.slackNotificationLinks)
      .where(
        and(
          eq(schema.slackNotificationLinks.subjectType, subjectType),
          eq(schema.slackNotificationLinks.subjectId, subjectId),
        ),
      );
    return link ?? null;
  }

  it('does not mirror a suppressed auto-reply or bounce into Slack', async () => {
    await emit('conversation.message.received', {
      conversationId: 'ccv_never_mirrored',
      messageId: 'cvm_never_mirrored',
      authorType: 'end_user',
      internal: false,
      autoReply: true,
      suppressed: 'auto_reply',
    });

    const rows = await db
      .select()
      .from(schema.slackDeliveries)
      .where(eq(schema.slackDeliveries.integrationId, integrationId));
    expect(rows).toHaveLength(0);
  });

  it('posts a merge proposal with buttons and records a notification link', async () => {
    const api = new FakeSlackApi();
    const worker = new SlackBridgeWorker(db, api);
    const proposalId = await seedMergeProposal();

    await emit('crm.merge_proposal.proposed', mergePayload(proposalId));

    const [delivery] = await db
      .select()
      .from(schema.slackDeliveries)
      .where(eq(schema.slackDeliveries.integrationId, integrationId));
    expect(delivery!.conversationId).toBeNull();
    expect(delivery!.subjectKey).toBe(`crm_merge_proposal:${proposalId}`);

    const result = await worker.tick();
    expect(result.delivered).toBe(1);
    expect(api.posted).toHaveLength(1);
    const posted = api.posted[0]!;
    expect(posted.channel).toBe('C_DEFAULT');
    expect(posted.text).toContain('merge proposed');
    expect(posted.text).toContain('Ada Lovelace (ada@example.com)');
    expect(buttonLabels(posted.blocks)).toEqual(['Apply merge', 'Dismiss']);

    const [row] = await db
      .select()
      .from(schema.crmMergeProposals)
      .where(eq(schema.crmMergeProposals.id, proposalId));
    expect(buttonValues(posted.blocks)[0]).toBe(
      `crm_merge_proposal:${proposalId}#${mergeFingerprint(row!)}`,
    );

    const link = await notificationLink('crm_merge_proposal', proposalId);
    expect(link?.slackTs).toBe(posted.ts);
    expect(link?.resolvedAt).toBeNull();
  });

  it('links the card at the proposal, not the dashboard root', async () => {
    const api = new FakeSlackApi();
    const worker = new SlackBridgeWorker(db, api);
    const proposalId = await seedMergeProposal();

    await emit('crm.merge_proposal.proposed', mergePayload(proposalId));
    await worker.tick();

    expect(api.posted[0]!.text).toContain(`/dashboard/review/${proposalId}`);
  });

  it('names the org in the link where routes are org-scoped', async () => {
    registerOrgScopedDashboard(true);
    try {
      const api = new FakeSlackApi();
      const worker = new SlackBridgeWorker(db, api);
      const proposalId = await seedMergeProposal();

      await emit('crm.merge_proposal.proposed', mergePayload(proposalId));
      await worker.tick();

      expect(api.posted[0]!.text).toContain(`/o/${orgId}/dashboard/review/${proposalId}`);
    } finally {
      registerOrgScopedDashboard(false);
    }
  });

  it('routes to the approvals channel, falling back to escalations before default', async () => {
    const api = new FakeSlackApi();
    const worker = new SlackBridgeWorker(db, api);
    await addRoute('escalations', 'C_ESCALATIONS');
    await addRoute('approvals', 'C_APPROVALS');

    await emit('crm.merge_proposal.proposed', mergePayload(await seedMergeProposal()));
    await worker.tick();
    expect(api.posted[0]!.channel).toBe('C_APPROVALS');

    await db
      .delete(schema.slackChannelRoutes)
      .where(eq(schema.slackChannelRoutes.slackChannelId, 'C_APPROVALS'));
    await emit('crm.merge_proposal.proposed', mergePayload(await seedMergeProposal()));
    await worker.tick();
    expect(api.posted[1]!.channel).toBe('C_ESCALATIONS');
  });

  it('fails terminally when no route exists', async () => {
    const api = new FakeSlackApi();
    const worker = new SlackBridgeWorker(db, api);
    await db
      .delete(schema.slackChannelRoutes)
      .where(eq(schema.slackChannelRoutes.integrationId, integrationId));

    await emit('crm.merge_proposal.proposed', mergePayload(await seedMergeProposal()));
    const result = await worker.tick();
    expect(result.failed).toBe(1);
    const [delivery] = await db
      .select()
      .from(schema.slackDeliveries)
      .where(eq(schema.slackDeliveries.integrationId, integrationId));
    expect(delivery!.error).toBe('no_route');
    expect(delivery!.deliveredAt).not.toBeNull();
  });

  it('resolves the message in place when the proposal is applied', async () => {
    const api = new FakeSlackApi();
    const worker = new SlackBridgeWorker(db, api);
    const proposalId = await seedMergeProposal();

    await emit('crm.merge_proposal.proposed', mergePayload(proposalId));
    await worker.tick();

    await db
      .update(schema.crmMergeProposals)
      .set({
        status: 'applied',
        decidedByActorType: 'user',
        decidedByActorId: userId,
        decidedAt: new Date(),
      })
      .where(eq(schema.crmMergeProposals.id, proposalId));
    await emit('crm.merge_proposal.applied', mergePayload(proposalId, 'applied'));
    await worker.tick();

    expect(api.updated).toHaveLength(1);
    const updated = api.updated[0]!;
    expect(updated.ts).toBe(api.posted[0]!.ts);
    expect(updated.text).toContain('*Merge applied* by *Dana Decider*');
    expect(actionIds(updated.blocks)).toEqual([]);

    const link = await notificationLink('crm_merge_proposal', proposalId);
    expect(link?.resolvedAt).not.toBeNull();
  });

  it('ignores resolutions for subjects that never surfaced', async () => {
    const api = new FakeSlackApi();
    const worker = new SlackBridgeWorker(db, api);
    const proposalId = await seedMergeProposal();

    await emit('crm.merge_proposal.dismissed', mergePayload(proposalId, 'dismissed'));
    const result = await worker.tick();
    expect(result.delivered).toBe(1);
    expect(api.posted).toHaveLength(0);
    expect(api.updated).toHaveLength(0);
  });

  it('keeps the resolution queued behind a failing pending head (subject ordering)', async () => {
    const api = new FakeSlackApi();
    const worker = new SlackBridgeWorker(db, api);
    const proposalId = await seedMergeProposal();

    api.failNextPosts = 1;
    await emit('crm.merge_proposal.proposed', mergePayload(proposalId));
    await emit('crm.merge_proposal.applied', mergePayload(proposalId, 'applied'));

    const result = await worker.tick();
    expect(result.attempted).toBe(1);
    expect(result.failed).toBe(1);
    expect(api.updated).toHaveLength(0);

    const deliveries = await db
      .select()
      .from(schema.slackDeliveries)
      .where(eq(schema.slackDeliveries.integrationId, integrationId));
    const resolution = deliveries.find((d) => d.eventType === 'crm.merge_proposal.applied');
    expect(resolution!.attempt).toBe(0);
    expect(resolution!.deliveredAt).toBeNull();
  });

  it('refreshes the pending message on a re-propose instead of posting again', async () => {
    const api = new FakeSlackApi();
    const worker = new SlackBridgeWorker(db, api);
    const proposalId = await seedMergeProposal();

    await emit('crm.merge_proposal.proposed', mergePayload(proposalId));
    await worker.tick();
    await emit('crm.merge_proposal.proposed', mergePayload(proposalId));
    await worker.tick();

    expect(api.posted).toHaveLength(1);
    expect(api.updated).toHaveLength(1);
    expect(actionIds(api.updated[0]!.blocks)).toHaveLength(2);
  });

  it('applies a second resolution as a no-op', async () => {
    const api = new FakeSlackApi();
    const worker = new SlackBridgeWorker(db, api);
    const proposalId = await seedMergeProposal();

    await emit('crm.merge_proposal.proposed', mergePayload(proposalId));
    await worker.tick();
    await db
      .update(schema.crmMergeProposals)
      .set({ status: 'dismissed' })
      .where(eq(schema.crmMergeProposals.id, proposalId));
    await emit('crm.merge_proposal.dismissed', mergePayload(proposalId, 'dismissed'));
    await emit('crm.merge_proposal.dismissed', mergePayload(proposalId, 'dismissed'));
    const result = await worker.tick();

    expect(result.delivered).toBe(2);
    expect(api.updated).toHaveLength(1);
  });

  it('posts outreach drafts as thread replies under a campaign parent, then resolves on sent', async () => {
    const api = new FakeSlackApi();
    const worker = new SlackBridgeWorker(db, api);
    const proposalId = await seedOutreachProposal();

    await emit('outreach.proposal.created', { proposalId, conversationId: 'ccv_red_herring' });

    const [delivery] = await db
      .select()
      .from(schema.slackDeliveries)
      .where(eq(schema.slackDeliveries.integrationId, integrationId));
    expect(delivery!.conversationId).toBeNull();

    await worker.tick();
    expect(api.posted).toHaveLength(2);
    const parent = api.posted[0]!;
    expect(parent.threadTs).toBeUndefined();
    expect(parent.text).toContain('Outreach drafts awaiting approval — Spring launch');
    const reply = api.posted[1]!;
    expect(reply.threadTs).toBe(parent.ts);
    expect(reply.text).toContain('Outreach draft awaiting approval');
    expect(reply.text).toContain('Hello from Munin');
    expect(reply.text).toContain('> We just launched — want a demo?');
    expect(buttonLabels(reply.blocks)).toEqual(['Approve & send', 'Dismiss']);

    expect(api.updated).toHaveLength(1);
    expect(api.updated[0]!.ts).toBe(parent.ts);
    expect(api.updated[0]!.text).toContain('1 draft pending');

    const parentLink = await notificationLink('outreach_campaign', campaignId);
    expect(parentLink?.slackTs).toBe(parent.ts);
    expect(parentLink?.resolvedAt).toBeNull();

    await db
      .update(schema.outreachProposals)
      .set({
        status: 'sent',
        decidedByActorType: 'user',
        decidedByActorId: userId,
        decidedAt: new Date(),
      })
      .where(eq(schema.outreachProposals.id, proposalId));
    await emit('outreach.proposal.sent', { proposalId });
    await worker.tick();

    expect(api.updated).toHaveLength(3);
    expect(api.updated[1]!.ts).toBe(reply.ts);
    expect(api.updated[1]!.text).toContain('*Approved — email sent* by *Dana Decider*');
    expect(actionIds(api.updated[1]!.blocks)).toEqual([]);
    expect(api.updated[2]!.ts).toBe(parent.ts);
    expect(api.updated[2]!.text).toContain('All outreach drafts handled — Spring launch');

    const resolvedParent = await notificationLink('outreach_campaign', campaignId);
    expect(resolvedParent?.resolvedAt).not.toBeNull();
  });

  it('binds the approve button to the draft it rendered, and rebinds it when the draft is revised', async () => {
    const api = new FakeSlackApi();
    const worker = new SlackBridgeWorker(db, api);
    const proposalId = await seedOutreachProposal();

    await emit('outreach.proposal.created', { proposalId });
    await worker.tick();

    const [filed] = await db
      .select()
      .from(schema.outreachProposals)
      .where(eq(schema.outreachProposals.id, proposalId));
    const reply = api.posted[1]!;
    expect(buttonValues(reply.blocks)[0]).toBe(
      `outreach_proposal:${proposalId}#${draftFingerprint(filed!)}`,
    );

    await db
      .update(schema.outreachProposals)
      .set({ draftBody: 'Rewritten pitch — want a demo next week?', revisionCount: 1 })
      .where(eq(schema.outreachProposals.id, proposalId));
    await emit('outreach.proposal.updated', { proposalId });
    await worker.tick();

    const [revised] = await db
      .select()
      .from(schema.outreachProposals)
      .where(eq(schema.outreachProposals.id, proposalId));
    const rerendered = api.updated.find((u) => u.ts === reply.ts);
    expect(draftFingerprint(revised!)).not.toBe(draftFingerprint(filed!));
    expect(buttonValues(rerendered?.blocks)[0]).toBe(
      `outreach_proposal:${proposalId}#${draftFingerprint(revised!)}`,
    );
  });

  it('reuses the campaign parent for further drafts and bumps the pending count', async () => {
    const api = new FakeSlackApi();
    const worker = new SlackBridgeWorker(db, api);
    const firstId = await seedOutreachProposal();
    const secondId = await seedOutreachProposal(contactBId);

    await emit('outreach.proposal.created', { proposalId: firstId });
    await emit('outreach.proposal.created', { proposalId: secondId });
    await worker.tick();

    expect(api.posted).toHaveLength(3);
    const parent = api.posted[0]!;
    expect(api.posted[1]!.threadTs).toBe(parent.ts);
    expect(api.posted[2]!.threadTs).toBe(parent.ts);
    const lastParentUpdate = api.updated.filter((u) => u.ts === parent.ts).at(-1);
    expect(lastParentUpdate!.text).toContain('2 drafts pending');
  });

  it('rotates to a fresh parent on a new day, marking the old one moved', async () => {
    const api = new FakeSlackApi();
    const worker = new SlackBridgeWorker(db, api);
    const firstId = await seedOutreachProposal();

    await emit('outreach.proposal.created', { proposalId: firstId });
    await worker.tick();

    const staleTs = `${Math.floor(Date.now() / 1000) - 25 * 3600}.000001`;
    await db
      .update(schema.slackNotificationLinks)
      .set({ slackTs: staleTs })
      .where(
        and(
          eq(schema.slackNotificationLinks.subjectType, 'outreach_campaign'),
          eq(schema.slackNotificationLinks.subjectId, campaignId),
        ),
      );

    const secondId = await seedOutreachProposal(contactBId);
    await emit('outreach.proposal.created', { proposalId: secondId });
    await worker.tick();

    expect(api.posted).toHaveLength(4);
    const newParent = api.posted[2]!;
    expect(newParent.threadTs).toBeUndefined();
    expect(newParent.text).toContain('Outreach drafts awaiting approval — Spring launch');
    expect(api.posted[3]!.threadTs).toBe(newParent.ts);

    const movedNotice = api.updated.find((u) => u.ts === staleTs);
    expect(movedNotice!.text).toContain('continued in a newer thread');

    const parentLink = await notificationLink('outreach_campaign', campaignId);
    expect(parentLink?.slackTs).toBe(newParent.ts);
    expect(parentLink?.resolvedAt).toBeNull();
  });

  it('rotates to a fresh parent when a new wave starts after the previous one resolved', async () => {
    const api = new FakeSlackApi();
    const worker = new SlackBridgeWorker(db, api);
    const firstId = await seedOutreachProposal();

    await emit('outreach.proposal.created', { proposalId: firstId });
    await worker.tick();
    await db
      .update(schema.outreachProposals)
      .set({ status: 'dismissed' })
      .where(eq(schema.outreachProposals.id, firstId));
    await emit('outreach.proposal.dismissed', { proposalId: firstId });
    await worker.tick();

    const firstParentTs = api.posted[0]!.ts;
    const secondId = await seedOutreachProposal();
    await emit('outreach.proposal.created', { proposalId: secondId });
    await worker.tick();

    expect(api.posted).toHaveLength(4);
    const newParent = api.posted[2]!;
    expect(newParent.threadTs).toBeUndefined();
    expect(newParent.ts).not.toBe(firstParentTs);
    expect(api.posted[3]!.threadTs).toBe(newParent.ts);
    expect(api.updated.some((u) => u.text.includes('continued in a newer thread'))).toBe(false);

    const parentLink = await notificationLink('outreach_campaign', campaignId);
    expect(parentLink?.slackTs).toBe(newParent.ts);
    expect(parentLink?.resolvedAt).toBeNull();
  });

  it('skips outreach draft edits that never surfaced', async () => {
    const api = new FakeSlackApi();
    const worker = new SlackBridgeWorker(db, api);
    const proposalId = await seedOutreachProposal();

    await emit('outreach.proposal.updated', { proposalId });
    const result = await worker.tick();
    expect(result.delivered).toBe(1);
    expect(api.posted).toHaveLength(0);
    expect(api.updated).toHaveLength(0);
  });

  it('shows a publish button only when the KB candidate proposes a target space', async () => {
    const api = new FakeSlackApi();
    const worker = new SlackBridgeWorker(db, api);
    const withTarget = await seedKbCandidate([
      'curation',
      'candidate',
      'target:support-faq',
      'source:ccv_src',
    ]);
    const withoutTarget = await seedKbCandidate(['curation', 'candidate']);

    await emit('kb.curation_candidate.proposed', {
      candidateDocumentId: withTarget,
      title: 'Weekend hours',
      proposedTargetSpaceSlug: 'support-faq',
      sourceConversationId: 'ccv_src',
      spaceId,
    });
    await emit('kb.curation_candidate.proposed', {
      candidateDocumentId: withoutTarget,
      title: 'Weekend hours',
      proposedTargetSpaceSlug: null,
      sourceConversationId: null,
      spaceId,
    });
    await worker.tick();

    expect(api.posted).toHaveLength(2);
    expect(buttonLabels(api.posted[0]!.blocks)).toEqual(['Publish to support-faq', 'Dismiss']);
    expect(buttonLabels(api.posted[1]!.blocks)).toEqual(['Dismiss']);
    expect(api.posted[1]!.text).toContain('No target space proposed');

    const [doc] = await db
      .select()
      .from(schema.kbDocuments)
      .where(eq(schema.kbDocuments.id, withTarget));
    expect(buttonValues(api.posted[0]!.blocks)[0]).toBe(
      `kb_curation_candidate:${withTarget}#${doc!.version}`,
    );
  });

  async function seedSocialDraft(
    overrides: Partial<typeof schema.socialPostDrafts.$inferInsert> = {},
  ): Promise<string> {
    const [draft] = await db
      .insert(schema.socialPostDrafts)
      .values({
        orgId,
        platform: 'linkedin',
        setId: 'spd_set_approvals',
        variantLabel: 'contrarian',
        body: 'Agentic support, explained in three minutes.',
        linkUrl: 'https://example.test/blog/agentic-support',
        linkUtm: {
          utm_source: 'linkedin',
          utm_medium: 'social',
          utm_campaign: 'spd_set_approvals',
          utm_content: 'contrarian',
        },
        proposedByActorType: 'agent',
        proposedByActorId: 'agt_approvals_test',
        ...overrides,
      })
      .returning();
    return draft!.id;
  }

  function socialPayload(draftId: string): Record<string, unknown> {
    return { draftId, platform: 'linkedin', variantLabel: 'contrarian' };
  }

  it('posts a social draft with a publish button bound to the wording it rendered', async () => {
    const api = new FakeSlackApi();
    const worker = new SlackBridgeWorker(db, api);
    const draftId = await seedSocialDraft();

    await emit('social.post_draft.proposed', socialPayload(draftId));
    await worker.tick();

    expect(api.posted).toHaveLength(1);
    const posted = api.posted[0]!;
    expect(posted.text).toContain('*contrarian* angle — LinkedIn post awaiting review');
    expect(posted.text).toContain('Publishing posts it to your own LinkedIn account.');
    expect(posted.text).toContain('utm_source=linkedin');
    expect(buttonLabels(posted.blocks)).toEqual(['Publish to LinkedIn', 'Dismiss']);

    const [row] = await db
      .select()
      .from(schema.socialPostDrafts)
      .where(eq(schema.socialPostDrafts.id, draftId));
    expect(buttonValues(posted.blocks)[0]).toBe(
      `social_post_draft:${draftId}#${socialDraftFingerprint(row!)}`,
    );

    const link = await notificationLink('social_post_draft', draftId);
    expect(link?.resolvedAt).toBeNull();
  });

  it('rebinds the publish button when the draft is revised, and posts nothing for a revision it never carried', async () => {
    const api = new FakeSlackApi();
    const worker = new SlackBridgeWorker(db, api);
    const draftId = await seedSocialDraft({ setId: 'spd_set_rebind' });
    const unseenId = await seedSocialDraft({ setId: 'spd_set_unseen' });

    await emit('social.post_draft.proposed', socialPayload(draftId));
    await worker.tick();
    const firstValue = buttonValues(api.posted[0]!.blocks)[0];

    await db
      .update(schema.socialPostDrafts)
      .set({ body: 'Rewritten, tighter.' })
      .where(eq(schema.socialPostDrafts.id, draftId));
    await emit('social.post_draft.revised', socialPayload(draftId));
    await emit('social.post_draft.revised', socialPayload(unseenId));
    await worker.tick();

    expect(api.posted).toHaveLength(1);
    expect(api.updated).toHaveLength(1);
    expect(api.updated[0]!.text).toContain('Rewritten, tighter.');
    expect(buttonValues(api.updated[0]!.blocks)[0]).not.toBe(firstValue);
  });

  it('resolves the card as posted, naming the person it went out under', async () => {
    const api = new FakeSlackApi();
    const worker = new SlackBridgeWorker(db, api);
    const draftId = await seedSocialDraft();

    await emit('social.post_draft.proposed', socialPayload(draftId));
    await worker.tick();

    await db
      .update(schema.socialPostDrafts)
      .set({
        status: 'published',
        decidedByActorType: 'user',
        decidedByActorId: userId,
        publishedAt: new Date(),
        externalPostId: 'urn:li:share:77',
      })
      .where(eq(schema.socialPostDrafts.id, draftId));
    await emit('social.post_draft.published', socialPayload(draftId));
    await worker.tick();

    expect(api.updated).toHaveLength(1);
    expect(api.updated[0]!.text).toContain('*Posted* by *Dana Decider*');
    expect(actionIds(api.updated[0]!.blocks)).toEqual([]);
    expect((await notificationLink('social_post_draft', draftId))?.resolvedAt).toBeTruthy();
  });

  it('closes the card when the platform refused the post, rather than leaving a live button', async () => {
    const api = new FakeSlackApi();
    const worker = new SlackBridgeWorker(db, api);
    const draftId = await seedSocialDraft();

    await emit('social.post_draft.proposed', socialPayload(draftId));
    await worker.tick();

    await db
      .update(schema.socialPostDrafts)
      .set({
        status: 'failed',
        decidedByActorType: 'user',
        decidedByActorId: userId,
        lastError: 'LinkedIn refused the post (422)',
      })
      .where(eq(schema.socialPostDrafts.id, draftId));
    await emit('social.post_draft.failed', socialPayload(draftId));
    await worker.tick();

    expect(api.updated).toHaveLength(1);
    expect(api.updated[0]!.text).toContain('The platform refused the post');
    expect(actionIds(api.updated[0]!.blocks)).toEqual([]);
  });

  it('threads the variants of one set under a parent, and leaves a set of one standalone', async () => {
    const api = new FakeSlackApi();
    const worker = new SlackBridgeWorker(db, api);
    const a = await seedSocialDraft({ setId: 'spd_set_multi', variantLabel: 'practitioner' });
    const b = await seedSocialDraft({ setId: 'spd_set_multi', variantLabel: 'data' });
    const alone = await seedSocialDraft({ setId: 'spd_set_alone', variantLabel: 'single' });

    await emit('social.post_draft.proposed', socialPayload(a));
    await emit('social.post_draft.proposed', socialPayload(b));
    await emit('social.post_draft.proposed', socialPayload(alone));
    await worker.tick();

    expect(api.posted).toHaveLength(4);
    const parent = api.posted[0]!;
    expect(parent.threadTs).toBeUndefined();
    expect(parent.text).toContain('LinkedIn post — 2 angles awaiting review');
    expect(parent.text).toContain('practitioner · data — publish one');
    expect(api.posted[1]!.threadTs).toBe(parent.ts);
    expect(api.posted[2]!.threadTs).toBe(parent.ts);
    expect(api.posted[3]!.threadTs).toBeUndefined();
    expect(api.posted[3]!.text).toContain('LinkedIn post awaiting review');
  });

  it('warns on the set parent if a sibling of the published variant is somehow still open', async () => {
    const api = new FakeSlackApi();
    const worker = new SlackBridgeWorker(db, api);
    const a = await seedSocialDraft({ setId: 'spd_set_multi', variantLabel: 'practitioner' });
    const b = await seedSocialDraft({ setId: 'spd_set_multi', variantLabel: 'data' });

    await emit('social.post_draft.proposed', socialPayload(a));
    await emit('social.post_draft.proposed', socialPayload(b));
    await worker.tick();
    const parentTs = api.posted[0]!.ts;

    await db
      .update(schema.socialPostDrafts)
      .set({
        status: 'published',
        decidedByActorType: 'user',
        decidedByActorId: userId,
        publishedAt: new Date(),
      })
      .where(eq(schema.socialPostDrafts.id, a));
    await emit('social.post_draft.published', socialPayload(a));
    await worker.tick();

    const parentUpdate = api.updated.filter((u) => u.ts === parentTs).at(-1);
    expect(parentUpdate!.text).toContain('published — variant practitioner');
    expect(parentUpdate!.text).toContain('Dana Decider');
    expect(parentUpdate!.text).toContain('1 other variant is still open');
    expect(await notificationLink('social_post_set', 'spd_set_multi')).toBeTruthy();
  });

  it('closes the set parent once every variant has been decided', async () => {
    const api = new FakeSlackApi();
    const worker = new SlackBridgeWorker(db, api);
    const a = await seedSocialDraft({ setId: 'spd_set_multi', variantLabel: 'practitioner' });
    const b = await seedSocialDraft({ setId: 'spd_set_multi', variantLabel: 'data' });

    await emit('social.post_draft.proposed', socialPayload(a));
    await emit('social.post_draft.proposed', socialPayload(b));
    await worker.tick();
    const parentTs = api.posted[0]!.ts;

    for (const [id, status] of [
      [a, 'published'],
      [b, 'dismissed'],
    ] as const) {
      await db
        .update(schema.socialPostDrafts)
        .set({ status, decidedByActorType: 'user', decidedByActorId: userId })
        .where(eq(schema.socialPostDrafts.id, id));
      await emit(`social.post_draft.${status}`, socialPayload(id));
    }
    await worker.tick();

    const parentUpdate = api.updated.filter((u) => u.ts === parentTs).at(-1);
    expect(parentUpdate!.text).toContain('published — variant practitioner');
    expect(parentUpdate!.text).toContain('The other 1 variant was dismissed');
    expect((await notificationLink('social_post_set', 'spd_set_multi'))?.resolvedAt).toBeTruthy();
  });

  async function seedCmsDraft(
    overrides: Partial<typeof schema.cmsEntries.$inferInsert> = {},
  ): Promise<string> {
    const [entry] = await db
      .insert(schema.cmsEntries)
      .values({
        orgId,
        collectionId,
        slug: `agentic-support-${randomUUID().slice(0, 8)}`,
        locale: 'en',
        status: 'draft',
        data: { title: 'Agentic support', body: 'Three minutes on why it works.' },
        contentHash: 'hash',
        createdByType: 'agent',
        createdById: 'agt_approvals_test',
        updatedByType: 'agent',
        updatedById: 'agt_approvals_test',
        ...overrides,
      })
      .returning();
    return entry!.id;
  }

  it('posts a CMS draft with a publish button bound to the version it rendered', async () => {
    const api = new FakeSlackApi();
    const worker = new SlackBridgeWorker(db, api);
    const entryId = await seedCmsDraft();

    await emit('cms.entry.created', {
      entryId,
      collectionSlug: 'blog',
      slug: 'agentic-support',
      locale: 'en',
      status: 'draft',
      version: 1,
    });
    await worker.tick();

    expect(api.posted).toHaveLength(1);
    const posted = api.posted[0]!;
    expect(posted.channel).toBe('C_DEFAULT');
    expect(posted.text).toContain('CMS draft awaiting review');
    expect(posted.text).toContain('Agentic support');
    expect(posted.text).toContain('Blog');
    expect(buttonLabels(posted.blocks)).toEqual(['Publish', 'Dismiss']);
    expect(buttonValues(posted.blocks)[0]).toBe(`cms_draft_entry:${entryId}#1`);
  });

  it('never raises a card for an entry created straight to published', async () => {
    const api = new FakeSlackApi();
    const worker = new SlackBridgeWorker(db, api);
    const entryId = await seedCmsDraft({ status: 'published' });

    await emit('cms.entry.created', {
      entryId,
      collectionSlug: 'blog',
      slug: 'agentic-support',
      locale: 'en',
      status: 'published',
      version: 1,
    });
    await worker.tick();

    expect(api.posted).toHaveLength(0);
  });

  it('says it once when the card and the announcement would land in the same channel', async () => {
    const api = new FakeSlackApi();
    const worker = new SlackBridgeWorker(db, api);
    const entryId = await seedCmsDraft();

    await emit('cms.entry.created', {
      entryId,
      collectionSlug: 'blog',
      slug: 'agentic-support',
      locale: 'en',
      status: 'draft',
      version: 1,
    });
    await worker.tick();
    expect(api.posted).toHaveLength(1);

    await db
      .update(schema.cmsEntries)
      .set({ status: 'published', publishedAt: new Date(), version: 2 })
      .where(eq(schema.cmsEntries.id, entryId));
    await emit('cms.entry.published', {
      entryId,
      collectionSlug: 'blog',
      slug: 'agentic-support',
      locale: 'en',
      title: 'Agentic support',
      previousStatus: 'draft',
      url: 'https://example.test/blog/agentic-support',
    });
    await worker.tick();

    expect(api.posted).toHaveLength(1);
    expect(api.updated).toHaveLength(1);
    expect(api.updated[0]!.text).toContain(':rocket: *Published*');
    expect(api.updated[0]!.text).toContain('Read it live');
    expect(api.updated[0]!.text).not.toContain('read the entry in Munin first');
  });

  it('still announces a publish that never had a card', async () => {
    const api = new FakeSlackApi();
    const worker = new SlackBridgeWorker(db, api);
    const entryId = await seedCmsDraft({ status: 'published' });

    await emit('cms.entry.published', {
      entryId,
      collectionSlug: 'blog',
      slug: 'agentic-support',
      locale: 'en',
      title: 'Agentic support',
      previousStatus: 'scheduled',
      url: 'https://example.test/blog/agentic-support',
    });
    await worker.tick();

    expect(api.posted).toHaveLength(1);
    expect(api.posted[0]!.text).toContain('Read it live');
  });

  it('resolves the draft card in the approvals channel and announces in the content channel', async () => {
    const api = new FakeSlackApi();
    const worker = new SlackBridgeWorker(db, api);
    await addRoute('content', 'C_CONTENT');
    const entryId = await seedCmsDraft();

    await emit('cms.entry.created', {
      entryId,
      collectionSlug: 'blog',
      slug: 'agentic-support',
      locale: 'en',
      status: 'draft',
      version: 1,
    });
    await worker.tick();
    expect(api.posted).toHaveLength(1);

    await db
      .update(schema.cmsEntries)
      .set({ status: 'published', publishedAt: new Date(), version: 2 })
      .where(eq(schema.cmsEntries.id, entryId));
    await emit('cms.entry.published', {
      entryId,
      collectionSlug: 'blog',
      slug: 'agentic-support',
      locale: 'en',
      title: 'Agentic support',
      previousStatus: 'draft',
      url: 'https://example.test/blog/agentic-support',
    });
    await worker.tick();

    const announcement = api.posted.find((m) => m.channel === 'C_CONTENT');
    expect(announcement!.text).toContain(':rocket: *Published*');
    expect(api.updated).toHaveLength(1);
    expect(api.updated[0]!.channel).toBe('C_DEFAULT');
    expect(api.updated[0]!.text).toContain(':rocket: *Published*');
    expect(actionIds(api.updated[0]!.blocks)).toEqual([]);
  });

  it('closes the draft card when the entry is archived instead of published', async () => {
    const api = new FakeSlackApi();
    const worker = new SlackBridgeWorker(db, api);
    const entryId = await seedCmsDraft();

    await emit('cms.entry.created', {
      entryId,
      collectionSlug: 'blog',
      slug: 'agentic-support',
      locale: 'en',
      status: 'draft',
      version: 1,
    });
    await worker.tick();

    await db
      .update(schema.cmsEntries)
      .set({ status: 'archived', archivedAt: new Date(), version: 2 })
      .where(eq(schema.cmsEntries.id, entryId));
    await emit('cms.entry.archived', {
      entryId,
      collectionSlug: 'blog',
      slug: 'agentic-support',
      locale: 'en',
      status: 'archived',
      version: 2,
    });
    await worker.tick();

    expect(api.updated).toHaveLength(1);
    expect(api.updated[0]!.text).toContain('*Archived*');
    expect(actionIds(api.updated[0]!.blocks)).toEqual([]);
  });

  it('rebinds the publish button to the new version when the draft is edited', async () => {
    const api = new FakeSlackApi();
    const worker = new SlackBridgeWorker(db, api);
    const entryId = await seedCmsDraft();
    const unseenId = await seedCmsDraft();

    await emit('cms.entry.created', {
      entryId,
      collectionSlug: 'blog',
      slug: 'agentic-support',
      locale: 'en',
      status: 'draft',
      version: 1,
    });
    await worker.tick();

    await db
      .update(schema.cmsEntries)
      .set({ version: 2, data: { title: 'Agentic support, revised' } })
      .where(eq(schema.cmsEntries.id, entryId));
    await emit('cms.entry.updated', { entryId, collectionSlug: 'blog', status: 'draft', version: 2 });
    await emit('cms.entry.updated', { entryId: unseenId, collectionSlug: 'blog', status: 'draft', version: 2 });
    await worker.tick();

    expect(api.posted).toHaveLength(1);
    expect(api.updated).toHaveLength(1);
    expect(api.updated[0]!.text).toContain('Agentic support, revised');
    expect(buttonValues(api.updated[0]!.blocks)[0]).toBe(`cms_draft_entry:${entryId}#2`);
  });

  it('threads the locales of one article under a parent, and leaves a single-locale entry standalone', async () => {
    const api = new FakeSlackApi();
    const worker = new SlackBridgeWorker(db, api);
    const group = 'cmg_agentic_support';
    const nb = await seedCmsDraft({ translationGroupId: group, locale: 'nb' });
    const en = await seedCmsDraft({ translationGroupId: group, locale: 'en' });
    const alone = await seedCmsDraft({ locale: 'en' });

    for (const entryId of [nb, en, alone]) {
      await emit('cms.entry.created', {
        entryId,
        collectionSlug: 'blog',
        locale: 'en',
        status: 'draft',
        version: 1,
      });
    }
    await worker.tick();

    expect(api.posted).toHaveLength(4);
    const parent = api.posted[0]!;
    expect(parent.threadTs).toBeUndefined();
    expect(parent.text).toContain('2 locales awaiting review');
    expect(parent.text).toContain('nb · en pending');
    expect(api.posted[1]!.threadTs).toBe(parent.ts);
    expect(api.posted[2]!.threadTs).toBe(parent.ts);
    expect(api.posted[3]!.threadTs).toBeUndefined();
  });

  it('moves a locale card that already posted alone into the thread once a sibling arrives', async () => {
    const api = new FakeSlackApi();
    const worker = new SlackBridgeWorker(db, api);
    const group = 'cmg_agentic_support';
    const nb = await seedCmsDraft({ translationGroupId: group, locale: 'nb' });

    await emit('cms.entry.created', {
      entryId: nb,
      collectionSlug: 'blog',
      locale: 'nb',
      status: 'draft',
      version: 1,
    });
    await worker.tick();

    expect(api.posted).toHaveLength(1);
    const stranded = api.posted[0]!;
    expect(stranded.threadTs).toBeUndefined();

    const en = await seedCmsDraft({ translationGroupId: group, locale: 'en' });
    await emit('cms.entry.created', {
      entryId: en,
      collectionSlug: 'blog',
      locale: 'en',
      status: 'draft',
      version: 1,
    });
    await worker.tick();

    const parent = api.posted[1]!;
    expect(parent.threadTs).toBeUndefined();
    expect(parent.text).toContain('2 locales awaiting review');
    expect(api.posted.slice(2).map((p) => p.threadTs)).toEqual([parent.ts, parent.ts]);
    expect(api.deleted).toEqual([{ channel: stranded.channel, ts: stranded.ts }]);

    const [moved] = await db
      .select()
      .from(schema.slackNotificationLinks)
      .where(
        and(
          eq(schema.slackNotificationLinks.subjectType, 'cms_draft_entry'),
          eq(schema.slackNotificationLinks.subjectId, nb),
        ),
      );
    expect(moved!.slackTs).toBe(api.posted[2]!.ts);
    expect(moved!.slackThreadTs).toBe(parent.ts);
  });

  it('leaves an already-threaded locale card alone when a third locale arrives', async () => {
    const api = new FakeSlackApi();
    const worker = new SlackBridgeWorker(db, api);
    const group = 'cmg_agentic_support';
    const nb = await seedCmsDraft({ translationGroupId: group, locale: 'nb' });
    const en = await seedCmsDraft({ translationGroupId: group, locale: 'en' });

    for (const entryId of [nb, en]) {
      await emit('cms.entry.created', { entryId, collectionSlug: 'blog', status: 'draft', version: 1 });
    }
    await worker.tick();
    expect(api.deleted).toEqual([]);

    const da = await seedCmsDraft({ translationGroupId: group, locale: 'da' });
    await emit('cms.entry.created', { entryId: da, collectionSlug: 'blog', status: 'draft', version: 1 });
    await worker.tick();

    expect(api.deleted).toEqual([]);
    expect(api.posted).toHaveLength(4);
    expect(api.posted[3]!.threadTs).toBe(api.posted[0]!.ts);
  });

  it('closes the locale parent once every locale of the article is decided', async () => {
    const api = new FakeSlackApi();
    const worker = new SlackBridgeWorker(db, api);
    const group = 'cmg_agentic_support';
    const nb = await seedCmsDraft({ translationGroupId: group, locale: 'nb' });
    const en = await seedCmsDraft({ translationGroupId: group, locale: 'en' });

    for (const entryId of [nb, en]) {
      await emit('cms.entry.created', {
        entryId,
        collectionSlug: 'blog',
        locale: 'en',
        status: 'draft',
        version: 1,
      });
    }
    await worker.tick();
    const parentTs = api.posted[0]!.ts;

    await db
      .update(schema.cmsEntries)
      .set({ status: 'published', publishedAt: new Date() })
      .where(eq(schema.cmsEntries.id, nb));
    await emit('cms.entry.published', { entryId: nb, collectionSlug: 'blog', previousStatus: 'draft' });
    await worker.tick();

    const midway = api.updated.filter((u) => u.ts === parentTs).at(-1);
    expect(midway!.text).toContain('en pending');

    await db
      .update(schema.cmsEntries)
      .set({ status: 'archived', archivedAt: new Date() })
      .where(eq(schema.cmsEntries.id, en));
    await emit('cms.entry.archived', { entryId: en, collectionSlug: 'blog', status: 'archived' });
    await worker.tick();

    const parentUpdate = api.updated.filter((u) => u.ts === parentTs).at(-1);
    expect(parentUpdate!.text).toContain('All 2 locales handled');
    expect((await notificationLink('cms_draft_group', group))?.resolvedAt).toBeTruthy();
  });

  it('resolves a KB candidate from the event payload after the row is deleted', async () => {
    const api = new FakeSlackApi();
    const worker = new SlackBridgeWorker(db, api);
    const candidateId = await seedKbCandidate(['curation', 'candidate', 'target:support-faq']);

    await emit('kb.curation_candidate.proposed', {
      candidateDocumentId: candidateId,
      title: 'Weekend hours',
      proposedTargetSpaceSlug: 'support-faq',
      sourceConversationId: null,
      spaceId,
    });
    await worker.tick();

    await db.delete(schema.kbDocuments).where(eq(schema.kbDocuments.id, candidateId));
    await emit('kb.curation_candidate.published', {
      candidateDocumentId: candidateId,
      publishedDocumentId: 'kbd_published',
      targetSpaceSlug: 'support-faq',
      targetSpaceId: spaceId,
      title: 'Weekend hours',
    });
    await worker.tick();

    expect(api.updated).toHaveLength(1);
    expect(api.updated[0]!.text).toContain('*Published to the knowledge base*');
    expect(actionIds(api.updated[0]!.blocks)).toEqual([]);
  });
});
