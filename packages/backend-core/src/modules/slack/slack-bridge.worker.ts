import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { and, eq, isNull, lt, lte, sql } from 'drizzle-orm';
import { schema, type Db } from '@getmunin/db';
import { describeError, parseEnvDisableFlag, parseEnvInt, readApiBaseUrl } from '@getmunin/core';
import { DB } from '../../common/db/db.module.ts';
import { formatPhoneNumber } from '../../common/format-phone.ts';
import { withSchedulerLock } from '../../common/scheduler-lock/index.ts';
import { SlackApiClient, SlackApiError } from './slack-api.client.ts';
import { slackAvatarFilename } from './slack-avatars.controller.ts';
import { decryptSecretValue } from './slack.service.ts';
import {
  approvalBlocks,
  approvalResolvedLine,
  assignedText,
  cmsEntryPublishedText,
  encodeApprovalValue,
  escalationAlertText,
  handoverRequestedText,
  handoverResolvedText,
  kbCandidateApprovalText,
  mergeProposalApprovalText,
  messageBodyText,
  messageText,
  outreachCampaignParentMovedText,
  outreachCampaignParentText,
  outreachProposalApprovalText,
  parentStateLine,
  parseMessageAttachments,
  releasedText,
  speakerIdentity,
  statusChangedText,
  takenOverText,
  threadParentBlocks,
  threadParentText,
  type ApprovalOutcome,
  type ApprovalResolution,
  type AuthorKind,
  type ConversationSnapshot,
  type ParentState,
  type SlackBlock,
} from './slack-projection.ts';
import {
  SLACK_ANNOUNCEMENT_EVENT_TYPES,
  SLACK_APPROVAL_EVENT_TYPES,
  approvalSubjectRef,
  readWebBaseUrl,
} from './slack.constants.ts';
import { draftFingerprint } from '../outreach/proposal-fingerprint.ts';
import { mergeFingerprint } from '../crm/merge-fingerprint.ts';

const POLL_INTERVAL_MS = parseEnvInt({ name: 'MUNIN_SLACK_POLL_MS', default: 5000 });
const MAX_ATTEMPTS = 5;
const BATCH_SIZE = 25;
const MAX_DRAIN_ITERATIONS = 20;
const BACKOFF_BASE_MS = 30_000;

type IntegrationRow = typeof schema.slackIntegrations.$inferSelect;
type RouteRow = typeof schema.slackChannelRoutes.$inferSelect;
type DeliveryRow = typeof schema.slackDeliveries.$inferSelect;
type LinkRow = typeof schema.slackConversationLinks.$inferSelect;

class TerminalDeliveryError extends Error {}

function avatarIconUrl(avatarKey: string | undefined): string | undefined {
  if (!avatarKey) return undefined;
  const file = slackAvatarFilename(avatarKey);
  return file ? `${readApiBaseUrl()}/v1/slack/avatars/${file}` : undefined;
}

function slackTsIsToday(slackTs: string): boolean {
  const postedAtSec = Number.parseFloat(slackTs);
  if (!Number.isFinite(postedAtSec)) return false;
  const day = (d: Date) => d.toISOString().slice(0, 10);
  return day(new Date(postedAtSec * 1000)) === day(new Date());
}

@Injectable()
export class SlackBridgeWorker implements OnModuleInit, OnModuleDestroy {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private disabled =
    parseEnvDisableFlag('MUNIN_SLACK_WORKER_DISABLED') || process.env.NODE_ENV === 'test';

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(SlackApiClient) private readonly api: SlackApiClient,
  ) {}

  onModuleInit(): void {
    if (this.disabled) return;
    this.timer = setInterval(() => {
      void withSchedulerLock(this.db, 'slack-bridge-worker', () => this.tick());
    }, POLL_INTERVAL_MS);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async tick(): Promise<{ attempted: number; delivered: number; failed: number }> {
    if (this.running) return { attempted: 0, delivered: 0, failed: 0 };
    this.running = true;
    try {
      return await this.drain();
    } finally {
      this.running = false;
    }
  }

  private async drain(): Promise<{ attempted: number; delivered: number; failed: number }> {
    let attempted = 0;
    let delivered = 0;
    let failed = 0;
    for (let i = 0; i < MAX_DRAIN_ITERATIONS; i += 1) {
      const rows = await this.db
        .select()
        .from(schema.slackDeliveries)
        .where(
          and(
            isNull(schema.slackDeliveries.deliveredAt),
            lt(schema.slackDeliveries.attempt, MAX_ATTEMPTS),
            lte(schema.slackDeliveries.nextAttemptAt, new Date()),
            sql`NOT EXISTS (
              SELECT 1 FROM slack_deliveries earlier
              WHERE (earlier.conversation_id = slack_deliveries.conversation_id
                     OR earlier.subject_key = slack_deliveries.subject_key)
                AND earlier.delivered_at IS NULL
                AND earlier.attempt < ${MAX_ATTEMPTS}
                AND (earlier.order_at, earlier.order_seq, earlier.created_at, earlier.id)
                    < (slack_deliveries.order_at, slack_deliveries.order_seq,
                       slack_deliveries.created_at, slack_deliveries.id)
            )`,
          ),
        )
        .orderBy(
          schema.slackDeliveries.orderAt,
          schema.slackDeliveries.orderSeq,
          schema.slackDeliveries.createdAt,
          schema.slackDeliveries.id,
        )
        .limit(BATCH_SIZE);
      if (rows.length === 0) break;

      attempted += rows.length;
      for (const row of rows) {
        const outcome = await this.attemptOne(row);
        if (outcome === 'delivered') delivered += 1;
        else failed += 1;
      }
    }
    return { attempted, delivered, failed };
  }

  private async attemptOne(row: DeliveryRow): Promise<'delivered' | 'failed'> {
    try {
      const [integration] = await this.db
        .select()
        .from(schema.slackIntegrations)
        .where(eq(schema.slackIntegrations.id, row.integrationId))
        .limit(1);
      if (!integration || !integration.active) {
        throw new TerminalDeliveryError('integration_inactive');
      }

      const [eventRow] = await this.db
        .select()
        .from(schema.events)
        .where(eq(schema.events.id, row.eventId))
        .limit(1);
      if (!eventRow) throw new TerminalDeliveryError('event_missing');

      const routes = await this.db
        .select()
        .from(schema.slackChannelRoutes)
        .where(eq(schema.slackChannelRoutes.integrationId, integration.id));

      const token = await decryptSecretValue(this.db, integration.encryptedBotToken);
      await this.handleEvent({
        row,
        integration,
        payload: eventRow.payload,
        actorId: eventRow.actorId,
        routes,
        token,
      });
      await this.finish(row, null);
      return 'delivered';
    } catch (err) {
      if (err instanceof TerminalDeliveryError) {
        await this.finish(row, err.message);
        return 'failed';
      }
      await this.recordFailure(row, err);
      return 'failed';
    }
  }

  private async handleEvent(input: {
    row: DeliveryRow;
    integration: IntegrationRow;
    payload: Record<string, unknown>;
    actorId: string | null;
    routes: RouteRow[];
    token: string;
  }): Promise<void> {
    const { row, payload, routes, token } = input;
    if (SLACK_APPROVAL_EVENT_TYPES.includes(row.eventType)) {
      return await this.handleNotification(input);
    }
    if (SLACK_ANNOUNCEMENT_EVENT_TYPES.includes(row.eventType)) {
      return await this.handleAnnouncement(input);
    }
    if (!row.conversationId) return;

    const context = await this.loadConversation(row.conversationId);
    if (!context) throw new TerminalDeliveryError('conversation_missing');

    const mirrorRoute =
      routes.find((r) => r.convChannelId === context.conversation.channelId) ??
      routes.find((r) => r.purpose === 'default' && !r.convChannelId);
    if (!mirrorRoute) throw new TerminalDeliveryError('no_default_route');
    const escalationRoute =
      routes.find((r) => r.purpose === 'escalations' && !r.convChannelId) ?? mirrorRoute;

    const link = await this.ensureLink(input.integration, mirrorRoute, context, token);

    switch (row.eventType) {
      case 'conversation.created':
        return;
      case 'conversation.subject_changed':
        return await this.syncParent(link, context, token);
      case 'conversation.message.received':
      case 'conversation.message.sent':
        return await this.mirrorMessage({ row, payload, context, link, token });
      case 'conversation.message.body_revised':
        return await this.reviseMirroredMessage({ payload, context, token });
      case 'conversation.handover_requested': {
        const reason = typeof payload.reason === 'string' ? payload.reason : null;
        await this.postThreadReply(token, link, handoverRequestedText(reason));
        await this.api.postMessage({
          token,
          channel: escalationRoute.slackChannelId,
          text: escalationAlertText(context.snapshot, reason, escalationRoute.mention),
        });
        return await this.syncParent(link, context, token);
      }
      case 'conversation.handover_resolved':
        await this.postThreadReply(token, link, handoverResolvedText());
        return await this.syncParent(link, context, token);
      case 'conversation.status_changed': {
        const status = typeof payload.status === 'string' ? payload.status : 'unknown';
        await this.postThreadReply(token, link, statusChangedText(status));
        return await this.syncParent(link, context, token);
      }
      case 'conversation.assigned': {
        const assigneeUserId =
          typeof payload.assigneeUserId === 'string' ? payload.assigneeUserId : null;
        const name = assigneeUserId ? await this.userName(assigneeUserId) : null;
        await this.postThreadReply(token, link, assignedText(name));
        return await this.syncParent(link, context, token);
      }
      case 'conversation.taken_over': {
        const name = await this.holderName(payload);
        await this.postThreadReply(token, link, takenOverText(name));
        return await this.syncParent(link, context, token);
      }
      case 'conversation.released': {
        const name = await this.holderName(payload);
        await this.postThreadReply(token, link, releasedText(name));
        return await this.syncParent(link, context, token);
      }
      default:
        return;
    }
  }

  private async mirrorMessage(input: {
    row: DeliveryRow;
    payload: Record<string, unknown>;
    context: ConversationContext;
    link: LinkRow;
    token: string;
  }): Promise<void> {
    const { row, payload, context, link, token } = input;
    const messageId = typeof payload.messageId === 'string' ? payload.messageId : null;
    if (!messageId) return;

    const [existingLink] = await this.db
      .select({ id: schema.slackMessageLinks.id })
      .from(schema.slackMessageLinks)
      .where(eq(schema.slackMessageLinks.messageId, messageId))
      .limit(1);
    if (existingLink) return;

    const [message] = await this.db
      .select()
      .from(schema.convMessages)
      .where(eq(schema.convMessages.id, messageId))
      .limit(1);
    if (!message) throw new TerminalDeliveryError('message_missing');

    const authorKind = message.authorType as AuthorKind;
    const authorName = await this.authorName(authorKind, message.authorId, context);
    const snapshot = {
      authorKind,
      authorName,
      internal: message.internal,
      body: message.body,
      attachments: parseMessageAttachments(message.attachments),
    };
    const identity = speakerIdentity(authorKind, authorName);
    let posted;
    let authorLabeled = false;
    try {
      posted = await this.api.postMessage({
        token,
        channel: link.slackChannelId,
        threadTs: link.slackThreadTs,
        text: messageBodyText(snapshot),
        username: identity.username,
        iconEmoji: identity.iconEmoji,
        iconUrl: avatarIconUrl(identity.avatarKey),
      });
    } catch (err) {
      if (!(err instanceof SlackApiError) || err.apiError !== 'missing_scope') throw err;
      authorLabeled = true;
      posted = await this.api.postMessage({
        token,
        channel: link.slackChannelId,
        threadTs: link.slackThreadTs,
        text: messageText(snapshot),
      });
    }
    await this.db
      .insert(schema.slackMessageLinks)
      .values({
        orgId: row.orgId,
        conversationId: message.conversationId,
        messageId,
        slackChannelId: posted.channel,
        slackTs: posted.ts,
        origin: 'mirrored',
        authorLabeled,
      })
      .onConflictDoNothing();
  }

  private async reviseMirroredMessage(input: {
    payload: Record<string, unknown>;
    context: ConversationContext;
    token: string;
  }): Promise<void> {
    const { payload, context, token } = input;
    const messageId = typeof payload.messageId === 'string' ? payload.messageId : null;
    if (!messageId) return;

    const [link] = await this.db
      .select()
      .from(schema.slackMessageLinks)
      .where(eq(schema.slackMessageLinks.messageId, messageId))
      .limit(1);
    if (!link || link.origin !== 'mirrored') return;

    const [message] = await this.db
      .select()
      .from(schema.convMessages)
      .where(eq(schema.convMessages.id, messageId))
      .limit(1);
    if (!message) throw new TerminalDeliveryError('message_missing');

    const authorKind = message.authorType as AuthorKind;
    const snapshot = {
      authorKind,
      authorName: await this.authorName(authorKind, message.authorId, context),
      internal: message.internal,
      body: message.body,
      attachments: parseMessageAttachments(message.attachments),
    };
    await this.api.updateMessage({
      token,
      channel: link.slackChannelId,
      ts: link.slackTs,
      text: link.authorLabeled ? messageText(snapshot) : messageBodyText(snapshot),
    });
  }

  private async handleAnnouncement(input: {
    integration: IntegrationRow;
    payload: Record<string, unknown>;
    routes: RouteRow[];
    token: string;
  }): Promise<void> {
    const { integration, payload, routes, token } = input;
    const route =
      routes.find((r) => r.purpose === 'content' && !r.convChannelId) ??
      routes.find((r) => r.purpose === 'default' && !r.convChannelId);
    if (!route) throw new TerminalDeliveryError('no_route');

    const str = (v: unknown): string | null =>
      typeof v === 'string' && v.length > 0 ? v : null;
    const text = cmsEntryPublishedText({
      title: str(payload.title) ?? str(payload.slug) ?? 'an entry',
      collectionSlug: str(payload.collectionSlug),
      locale: str(payload.locale),
      url: str(payload.url),
    });

    const groupId = str(payload.translationGroupId);
    const sibling = groupId
      ? await this.translationGroupLink(integration.id, groupId)
      : null;
    const threadTs =
      sibling &&
      sibling.slackChannelId === route.slackChannelId &&
      slackTsIsToday(sibling.slackTs)
        ? sibling.slackTs
        : undefined;

    let posted;
    try {
      posted = await this.api.postMessage({
        token,
        channel: route.slackChannelId,
        text,
        threadTs,
      });
    } catch (err) {
      if (err instanceof SlackApiError && err.apiError === 'not_in_channel') {
        throw new TerminalDeliveryError('bot_not_in_channel');
      }
      throw err;
    }
    if (groupId && !threadTs) {
      await this.db
        .insert(schema.slackNotificationLinks)
        .values({
          orgId: integration.orgId,
          integrationId: integration.id,
          subjectType: 'cms_translation_group',
          subjectId: groupId,
          slackChannelId: posted.channel,
          slackTs: posted.ts,
        })
        .onConflictDoUpdate({
          target: [
            schema.slackNotificationLinks.integrationId,
            schema.slackNotificationLinks.subjectType,
            schema.slackNotificationLinks.subjectId,
          ],
          set: { slackChannelId: posted.channel, slackTs: posted.ts },
        });
    }
  }

  private async translationGroupLink(
    integrationId: string,
    translationGroupId: string,
  ): Promise<{ slackChannelId: string; slackTs: string } | null> {
    const [link] = await this.db
      .select({
        slackChannelId: schema.slackNotificationLinks.slackChannelId,
        slackTs: schema.slackNotificationLinks.slackTs,
      })
      .from(schema.slackNotificationLinks)
      .where(
        and(
          eq(schema.slackNotificationLinks.integrationId, integrationId),
          eq(schema.slackNotificationLinks.subjectType, 'cms_translation_group'),
          eq(schema.slackNotificationLinks.subjectId, translationGroupId),
        ),
      )
      .limit(1);
    return link ?? null;
  }

  private async handleNotification(input: {
    row: DeliveryRow;
    integration: IntegrationRow;
    payload: Record<string, unknown>;
    actorId: string | null;
    token: string;
    routes: RouteRow[];
  }): Promise<void> {
    const { row, integration, payload, actorId, routes, token } = input;
    const route =
      routes.find((r) => r.purpose === 'approvals' && !r.convChannelId) ??
      routes.find((r) => r.purpose === 'escalations' && !r.convChannelId) ??
      routes.find((r) => r.purpose === 'default' && !r.convChannelId);
    if (!route) throw new TerminalDeliveryError('no_route');

    const subject = approvalSubjectRef(row.eventType, payload);
    if (!subject) throw new TerminalDeliveryError('subject_ref_missing');

    const [link] = await this.db
      .select()
      .from(schema.slackNotificationLinks)
      .where(
        and(
          eq(schema.slackNotificationLinks.integrationId, integration.id),
          eq(schema.slackNotificationLinks.subjectType, subject.subjectType),
          eq(schema.slackNotificationLinks.subjectId, subject.subjectId),
        ),
      )
      .limit(1);

    const outcome = approvalOutcomeFor(row.eventType);
    if (outcome) {
      if (!link || link.resolvedAt) return;
      const rendering = await this.renderApproval(subject, payload, actorId, outcome);
      await this.api.updateMessage({
        token,
        channel: link.slackChannelId,
        ts: link.slackTs,
        text: rendering.text,
        blocks: rendering.blocks,
      });
      await this.db
        .update(schema.slackNotificationLinks)
        .set({ resolvedAt: new Date() })
        .where(eq(schema.slackNotificationLinks.id, link.id));
      if (subject.subjectType === 'outreach_proposal') {
        await this.refreshOutreachParent(integration, subject.subjectId, token);
      }
      return;
    }

    const rendering = await this.renderApproval(subject, payload, actorId, null);
    if (link) {
      await this.api.updateMessage({
        token,
        channel: link.slackChannelId,
        ts: link.slackTs,
        text: rendering.text,
        blocks: rendering.blocks,
      });
      if (rendering.resolved && !link.resolvedAt) {
        await this.db
          .update(schema.slackNotificationLinks)
          .set({ resolvedAt: new Date() })
          .where(eq(schema.slackNotificationLinks.id, link.id));
        if (subject.subjectType === 'outreach_proposal') {
          await this.refreshOutreachParent(integration, subject.subjectId, token);
        }
      }
      return;
    }
    if (row.eventType === 'outreach.proposal.updated') return;

    let threadTs: string | undefined;
    let channel = route.slackChannelId;
    if (subject.subjectType === 'outreach_proposal') {
      const parent = await this.ensureOutreachParent(integration, route, subject.subjectId, token);
      if (parent) {
        threadTs = parent.slackTs;
        channel = parent.slackChannelId;
      }
    }

    let posted;
    try {
      posted = await this.api.postMessage({
        token,
        channel,
        threadTs,
        text: rendering.text,
        blocks: rendering.blocks,
      });
    } catch (err) {
      if (err instanceof SlackApiError && err.apiError === 'not_in_channel') {
        throw new TerminalDeliveryError('bot_not_in_channel');
      }
      throw err;
    }
    await this.db
      .insert(schema.slackNotificationLinks)
      .values({
        orgId: integration.orgId,
        integrationId: integration.id,
        subjectType: subject.subjectType,
        subjectId: subject.subjectId,
        slackChannelId: posted.channel,
        slackTs: posted.ts,
        resolvedAt: rendering.resolved ? new Date() : null,
      })
      .onConflictDoNothing();
    if (subject.subjectType === 'outreach_proposal') {
      await this.refreshOutreachParent(integration, subject.subjectId, token);
    }
  }

  private async outreachParentContext(proposalId: string): Promise<{
    campaignId: string;
    campaignName: string;
    pendingCount: number;
  } | null> {
    const [proposal] = await this.db
      .select({ campaignId: schema.outreachProposals.campaignId })
      .from(schema.outreachProposals)
      .where(eq(schema.outreachProposals.id, proposalId))
      .limit(1);
    if (!proposal) return null;
    const [campaign] = await this.db
      .select({ name: schema.outreachCampaigns.name })
      .from(schema.outreachCampaigns)
      .where(eq(schema.outreachCampaigns.id, proposal.campaignId))
      .limit(1);
    const [pending] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.outreachProposals)
      .where(
        and(
          eq(schema.outreachProposals.campaignId, proposal.campaignId),
          eq(schema.outreachProposals.status, 'pending'),
        ),
      );
    return {
      campaignId: proposal.campaignId,
      campaignName: campaign?.name ?? 'a campaign',
      pendingCount: pending?.count ?? 0,
    };
  }

  private async outreachParentLink(
    integrationId: string,
    campaignId: string,
  ): Promise<typeof schema.slackNotificationLinks.$inferSelect | null> {
    const [link] = await this.db
      .select()
      .from(schema.slackNotificationLinks)
      .where(
        and(
          eq(schema.slackNotificationLinks.integrationId, integrationId),
          eq(schema.slackNotificationLinks.subjectType, 'outreach_campaign'),
          eq(schema.slackNotificationLinks.subjectId, campaignId),
        ),
      )
      .limit(1);
    return link ?? null;
  }

  private async ensureOutreachParent(
    integration: IntegrationRow,
    route: RouteRow,
    proposalId: string,
    token: string,
  ): Promise<{ slackTs: string; slackChannelId: string } | null> {
    const context = await this.outreachParentContext(proposalId);
    if (!context) return null;
    const link = await this.outreachParentLink(integration.id, context.campaignId);
    if (
      link &&
      !link.resolvedAt &&
      link.slackChannelId === route.slackChannelId &&
      slackTsIsToday(link.slackTs)
    ) {
      return { slackTs: link.slackTs, slackChannelId: link.slackChannelId };
    }

    const text = outreachCampaignParentText(
      context.campaignName,
      context.pendingCount,
      `${readWebBaseUrl()}/dashboard`,
    );
    let posted;
    try {
      posted = await this.api.postMessage({ token, channel: route.slackChannelId, text });
    } catch (err) {
      if (err instanceof SlackApiError && err.apiError === 'not_in_channel') {
        throw new TerminalDeliveryError('bot_not_in_channel');
      }
      throw err;
    }
    if (link && !link.resolvedAt) {
      await this.api
        .updateMessage({
          token,
          channel: link.slackChannelId,
          ts: link.slackTs,
          text: outreachCampaignParentMovedText(context.campaignName),
        })
        .catch(() => undefined);
    }
    if (link) {
      await this.db
        .update(schema.slackNotificationLinks)
        .set({ slackChannelId: posted.channel, slackTs: posted.ts, resolvedAt: null })
        .where(eq(schema.slackNotificationLinks.id, link.id));
    } else {
      await this.db
        .insert(schema.slackNotificationLinks)
        .values({
          orgId: integration.orgId,
          integrationId: integration.id,
          subjectType: 'outreach_campaign',
          subjectId: context.campaignId,
          slackChannelId: posted.channel,
          slackTs: posted.ts,
        })
        .onConflictDoUpdate({
          target: [
            schema.slackNotificationLinks.integrationId,
            schema.slackNotificationLinks.subjectType,
            schema.slackNotificationLinks.subjectId,
          ],
          set: { slackChannelId: posted.channel, slackTs: posted.ts, resolvedAt: null },
        });
    }
    return { slackTs: posted.ts, slackChannelId: posted.channel };
  }

  private async refreshOutreachParent(
    integration: IntegrationRow,
    proposalId: string,
    token: string,
  ): Promise<void> {
    const context = await this.outreachParentContext(proposalId);
    if (!context) return;
    const link = await this.outreachParentLink(integration.id, context.campaignId);
    if (!link) return;
    await this.api.updateMessage({
      token,
      channel: link.slackChannelId,
      ts: link.slackTs,
      text: outreachCampaignParentText(
        context.campaignName,
        context.pendingCount,
        `${readWebBaseUrl()}/dashboard`,
      ),
    });
    if (context.pendingCount === 0 && !link.resolvedAt) {
      await this.db
        .update(schema.slackNotificationLinks)
        .set({ resolvedAt: new Date() })
        .where(eq(schema.slackNotificationLinks.id, link.id));
    }
  }

  private async renderApproval(
    subject: { subjectType: string; subjectId: string },
    payload: Record<string, unknown>,
    actorId: string | null,
    outcome: ApprovalOutcome | null,
  ): Promise<{ text: string; blocks: SlackBlock[]; resolved: boolean }> {
    const dashboardUrl = `${readWebBaseUrl()}/dashboard`;
    const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);

    let text: string;
    let approveLabel: string | null;
    let resolution: ApprovalResolution | null;
    let fingerprint: string | null = null;

    if (subject.subjectType === 'crm_merge_proposal') {
      const [proposal] = await this.db
        .select()
        .from(schema.crmMergeProposals)
        .where(eq(schema.crmMergeProposals.id, subject.subjectId))
        .limit(1);
      if (!proposal && !outcome) throw new TerminalDeliveryError('subject_missing');
      const contactAId = proposal?.contactAId ?? str(payload.contactAId);
      const contactBId = proposal?.contactBId ?? str(payload.contactBId);
      const keeperId = proposal?.recommendedKeeperId ?? str(payload.recommendedKeeperId);
      const labelA = contactAId ? await this.contactLabel(contactAId) : 'unknown contact';
      const labelB = contactBId ? await this.contactLabel(contactBId) : 'unknown contact';
      text = mergeProposalApprovalText({
        contactALabel: labelA,
        contactBLabel: labelB,
        keeperLabel: keeperId === contactBId ? labelB : labelA,
        confidence: proposal?.confidence ?? str(payload.confidence) ?? 'unknown',
        dashboardUrl,
      });
      fingerprint = proposal ? mergeFingerprint(proposal) : null;
      approveLabel = 'Apply merge';
      const status = proposal?.status ?? str(payload.status);
      const derived: ApprovalOutcome | null =
        outcome ?? (status === 'applied' ? 'applied' : status === 'dismissed' ? 'dismissed' : null);
      resolution = derived
        ? {
            outcome: derived,
            decidedByName: await this.decidedByName(
              proposal?.decidedByActorType ?? null,
              proposal?.decidedByActorId ?? null,
            ),
          }
        : null;
    } else if (subject.subjectType === 'outreach_proposal') {
      const [proposal] = await this.db
        .select()
        .from(schema.outreachProposals)
        .where(eq(schema.outreachProposals.id, subject.subjectId))
        .limit(1);
      if (!proposal && !outcome) throw new TerminalDeliveryError('subject_missing');
      const [campaign] = proposal
        ? await this.db
            .select({ name: schema.outreachCampaigns.name })
            .from(schema.outreachCampaigns)
            .where(eq(schema.outreachCampaigns.id, proposal.campaignId))
            .limit(1)
        : [];
      text = outreachProposalApprovalText({
        kind: proposal?.kind ?? 'draft',
        campaignName: campaign?.name ?? 'a campaign',
        contactLabel: proposal
          ? await this.contactLabel(proposal.contactId)
          : 'unknown contact',
        draftSubject: proposal?.draftSubject ?? null,
        draftBody: proposal?.draftBody ?? '',
        dashboardUrl,
      });
      fingerprint = proposal ? draftFingerprint(proposal) : null;
      approveLabel = 'Approve & send';
      const derived: ApprovalOutcome | null =
        outcome ??
        (proposal?.status === 'sent'
          ? 'sent'
          : proposal?.status === 'dismissed'
            ? 'dismissed'
            : proposal?.status === 'withdrawn'
              ? 'withdrawn'
              : null);
      resolution = derived
        ? {
            outcome: derived,
            decidedByName: await this.decidedByName(
              proposal?.decidedByActorType ?? null,
              proposal?.decidedByActorId ?? null,
            ),
          }
        : null;
    } else {
      const [doc] = await this.db
        .select()
        .from(schema.kbDocuments)
        .where(eq(schema.kbDocuments.id, subject.subjectId))
        .limit(1);
      if (!doc && !outcome) throw new TerminalDeliveryError('subject_missing');
      const tags = doc?.tags ?? [];
      const targetTag = tags.find((t) => t.startsWith('target:'))?.slice('target:'.length) ?? null;
      const sourceTag = tags.find((t) => t.startsWith('source:'))?.slice('source:'.length) ?? null;
      const revisesTag =
        tags.find((t) => t.startsWith('revises:'))?.slice('revises:'.length) ?? null;
      const target =
        targetTag ?? str(payload.proposedTargetSpaceSlug) ?? str(payload.targetSpaceSlug);
      const revisesTitle = revisesTag ? await this.documentTitle(revisesTag) : null;
      text = kbCandidateApprovalText({
        title: doc?.title ?? str(payload.title) ?? 'Untitled draft',
        proposedTargetSpaceSlug: target,
        sourceConversationId: sourceTag ?? str(payload.sourceConversationId),
        revisesDocumentTitle: revisesTitle,
        dashboardUrl,
      });
      fingerprint = doc ? String(doc.version) : null;
      approveLabel = revisesTag ? null : target ? `Publish to ${target}` : null;
      resolution = outcome
        ? { outcome, decidedByName: actorId ? await this.userName(actorId) : null }
        : null;
    }

    const value = encodeApprovalValue(
      subject.subjectType as Parameters<typeof encodeApprovalValue>[0],
      subject.subjectId,
      fingerprint,
    );
    return {
      text: resolution
        ? `${text}\n${approvalResolvedLine(resolution.outcome, resolution.decidedByName)}`
        : text,
      blocks: approvalBlocks(text, value, { approveLabel }, resolution),
      resolved: resolution !== null,
    };
  }

  private async contactLabel(contactId: string): Promise<string> {
    const [contact] = await this.db
      .select({ name: schema.crmContacts.name, email: schema.crmContacts.email })
      .from(schema.crmContacts)
      .where(eq(schema.crmContacts.id, contactId))
      .limit(1);
    if (!contact) return 'unknown contact';
    if (contact.name && contact.email) return `${contact.name} (${contact.email})`;
    return contact.name ?? contact.email ?? 'unknown contact';
  }

  private async decidedByName(
    actorType: string | null,
    decidedByActorId: string | null,
  ): Promise<string | null> {
    if (!decidedByActorId) return null;
    if (actorType === 'user') return await this.userName(decidedByActorId);
    return 'the AI agent';
  }

  private async ensureLink(
    integration: IntegrationRow,
    defaultRoute: RouteRow,
    context: ConversationContext,
    token: string,
  ): Promise<LinkRow> {
    const [existing] = await this.db
      .select()
      .from(schema.slackConversationLinks)
      .where(eq(schema.slackConversationLinks.conversationId, context.conversation.id))
      .limit(1);
    if (existing) return existing;

    const state = await this.loadParentState(context);
    let posted;
    try {
      posted = await this.api.postMessage({
        token,
        channel: defaultRoute.slackChannelId,
        text: `${threadParentText(context.snapshot)}\n${parentStateLine(state)}`,
        blocks: threadParentBlocks(context.snapshot, state, context.conversation.id),
      });
    } catch (err) {
      if (err instanceof SlackApiError && err.apiError === 'not_in_channel') {
        throw new TerminalDeliveryError('bot_not_in_channel');
      }
      throw err;
    }
    const [inserted] = await this.db
      .insert(schema.slackConversationLinks)
      .values({
        orgId: integration.orgId,
        integrationId: integration.id,
        conversationId: context.conversation.id,
        slackChannelId: posted.channel,
        slackThreadTs: posted.ts,
      })
      .onConflictDoNothing()
      .returning();
    if (inserted) return inserted;
    const [reread] = await this.db
      .select()
      .from(schema.slackConversationLinks)
      .where(eq(schema.slackConversationLinks.conversationId, context.conversation.id))
      .limit(1);
    if (!reread) throw new Error('slack_conversation_link_vanished');
    return reread;
  }

  private async syncParent(
    link: LinkRow,
    context: ConversationContext,
    token: string,
  ): Promise<void> {
    const state = await this.loadParentState(context);
    await this.api.updateMessage({
      token,
      channel: link.slackChannelId,
      ts: link.slackThreadTs,
      text: `${threadParentText(context.snapshot)}\n${parentStateLine(state)}`,
      blocks: threadParentBlocks(context.snapshot, state, context.conversation.id),
    });
  }

  private async loadParentState(context: ConversationContext): Promise<ParentState> {
    const conversation = context.conversation;
    const [claim] = await this.db
      .select({ userId: schema.claims.userId })
      .from(schema.claims)
      .where(
        and(
          eq(schema.claims.entityType, 'conversation'),
          eq(schema.claims.entityId, conversation.id),
          sql`${schema.claims.expiresAt} > now()`,
        ),
      )
      .orderBy(sql`${schema.claims.expiresAt} DESC`)
      .limit(1);
    let claimedBy: string | null = null;
    if (claim?.userId) claimedBy = (await this.userName(claim.userId)) ?? 'a teammate';

    const assignedTo = conversation.assigneeUserId
      ? await this.userName(conversation.assigneeUserId)
      : null;

    return {
      status: conversation.status,
      needsHumanAttention: conversation.needsHumanAttention,
      claimedBy,
      assignedTo,
    };
  }

  private async postThreadReply(token: string, link: LinkRow, text: string): Promise<void> {
    await this.api.postMessage({
      token,
      channel: link.slackChannelId,
      threadTs: link.slackThreadTs,
      text,
    });
  }

  private async loadConversation(conversationId: string): Promise<ConversationContext | null> {
    const [conversation] = await this.db
      .select()
      .from(schema.convConversations)
      .where(eq(schema.convConversations.id, conversationId))
      .limit(1);
    if (!conversation) return null;

    const [channel] = await this.db
      .select({ type: schema.convChannels.type, name: schema.convChannels.name })
      .from(schema.convChannels)
      .where(eq(schema.convChannels.id, conversation.channelId))
      .limit(1);
    const contact = conversation.contactId
      ? (
          await this.db
            .select()
            .from(schema.convContacts)
            .where(eq(schema.convContacts.id, conversation.contactId))
            .limit(1)
        )[0]
      : undefined;
    const endUser = conversation.endUserId
      ? (
          await this.db
            .select({
              name: schema.endUsers.name,
              email: schema.endUsers.email,
              phone: schema.endUsers.phone,
            })
            .from(schema.endUsers)
            .where(eq(schema.endUsers.id, conversation.endUserId))
            .limit(1)
        )[0]
      : undefined;

    const phone = contact?.phone ?? endUser?.phone ?? null;
    const snapshot: ConversationSnapshot = {
      displayId: conversation.displayId,
      subject: conversation.subject,
      channelType: channel?.type ?? 'unknown',
      channelName: channel?.name ?? null,
      contactName: contact?.name ?? endUser?.name ?? null,
      contactEmail: contact?.email ?? endUser?.email ?? null,
      contactPhone: phone ? formatPhoneNumber(phone) : null,
      dashboardUrl: `${readWebBaseUrl()}/dashboard`,
    };
    return { conversation, snapshot };
  }

  private async authorName(
    kind: AuthorKind,
    authorId: string,
    context: ConversationContext,
  ): Promise<string | null> {
    if (kind === 'user') return await this.userName(authorId);
    if (kind === 'end_user') {
      const { contactName, contactEmail, contactPhone } = context.snapshot;
      return contactName ?? contactEmail ?? contactPhone ?? null;
    }
    if (kind === 'agent') {
      const [assistant] = await this.db
        .select({ name: schema.assistants.name })
        .from(schema.assistants)
        .where(eq(schema.assistants.orgId, context.conversation.orgId))
        .limit(1);
      return assistant?.name ?? null;
    }
    return null;
  }

  private async documentTitle(documentId: string): Promise<string> {
    const [doc] = await this.db
      .select({ title: schema.kbDocuments.title })
      .from(schema.kbDocuments)
      .where(eq(schema.kbDocuments.id, documentId))
      .limit(1);
    return doc?.title ?? documentId;
  }

  private async userName(userId: string): Promise<string | null> {
    const [user] = await this.db
      .select({ name: schema.users.name, email: schema.users.email })
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .limit(1);
    return user?.name ?? user?.email ?? null;
  }

  private async holderName(payload: Record<string, unknown>): Promise<string> {
    const holderType = typeof payload.holderType === 'string' ? payload.holderType : null;
    const holderId = typeof payload.holderId === 'string' ? payload.holderId : null;
    if (holderType === 'user' && holderId) {
      return (await this.userName(holderId)) ?? 'a teammate';
    }
    return 'a teammate';
  }

  private async finish(row: DeliveryRow, error: string | null): Promise<void> {
    await this.db
      .update(schema.slackDeliveries)
      .set({
        attempt: row.attempt + 1,
        deliveredAt: new Date(),
        nextAttemptAt: null,
        error,
      })
      .where(eq(schema.slackDeliveries.id, row.id));
  }

  private async recordFailure(row: DeliveryRow, err: unknown): Promise<void> {
    const nextAttempt = row.attempt + 1;
    const final = nextAttempt >= MAX_ATTEMPTS;
    let backoff = BACKOFF_BASE_MS * 2 ** row.attempt;
    if (err instanceof SlackApiError && err.retryAfterMs) {
      backoff = Math.max(backoff, err.retryAfterMs);
    }
    const jitter = Math.floor(backoff * 0.1 * Math.random());
    await this.db
      .update(schema.slackDeliveries)
      .set({
        attempt: nextAttempt,
        error: describeError(err),
        nextAttemptAt: final ? null : new Date(Date.now() + backoff + jitter),
        deliveredAt: final ? new Date() : null,
      })
      .where(eq(schema.slackDeliveries.id, row.id));
  }
}

interface ConversationContext {
  conversation: typeof schema.convConversations.$inferSelect;
  snapshot: ConversationSnapshot;
}

function approvalOutcomeFor(eventType: string): ApprovalOutcome | null {
  switch (eventType) {
    case 'crm.merge_proposal.applied':
      return 'applied';
    case 'outreach.proposal.sent':
      return 'sent';
    case 'kb.curation_candidate.published':
      return 'published';
    case 'crm.merge_proposal.dismissed':
    case 'outreach.proposal.dismissed':
    case 'kb.curation_candidate.dismissed':
      return 'dismissed';
    case 'outreach.proposal.withdrawn':
      return 'withdrawn';
    default:
      return null;
  }
}

export { POLL_INTERVAL_MS as SLACK_POLL_INTERVAL_MS };
