import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { and, eq, isNull, lt, lte, sql } from 'drizzle-orm';
import { schema, type Db } from '@getmunin/db';
import { describeError, parseEnvDisableFlag, parseEnvInt } from '@getmunin/core';
import { DB } from '../../common/db/db.module.ts';
import { withSchedulerLock } from '../../common/scheduler-lock/index.ts';
import { SlackApiClient, SlackApiError } from './slack-api.client.ts';
import { decryptSecretValue } from './slack.service.ts';
import {
  assignedText,
  escalationAlertText,
  handoverRequestedText,
  handoverResolvedText,
  messageBodyText,
  messageText,
  parentStateLine,
  parseMessageAttachments,
  releasedText,
  speakerIdentity,
  statusChangedText,
  takenOverText,
  threadParentBlocks,
  threadParentText,
  type AuthorKind,
  type ConversationSnapshot,
  type ParentState,
} from './slack-projection.ts';
import { readWebBaseUrl } from './slack.constants.ts';
import { mcpResourceOrigin } from '../../oauth/oauth.constants.ts';

const POLL_INTERVAL_MS = parseEnvInt({ name: 'MUNIN_SLACK_POLL_MS', default: 5000 });
const MAX_ATTEMPTS = 5;
const BATCH_SIZE = 25;
const MAX_DRAIN_ITERATIONS = 20;
const BACKOFF_BASE_MS = 30_000;

type IntegrationRow = typeof schema.slackIntegrations.$inferSelect;
type RouteRow = typeof schema.slackChannelRoutes.$inferSelect;
type DeliveryRow = typeof schema.slackDeliveries.$inferSelect;
type LinkRow = typeof schema.slackConversationLinks.$inferSelect;

/** Thrown for conditions retrying can't fix — marks the delivery done with a note. */
class TerminalDeliveryError extends Error {}

/**
 * Drains `slack_deliveries` and projects conversation events into Slack
 * threads (one thread per conversation, created lazily on the first event).
 * Same shape as WebhookWorker: service-role DB, advisory-lock singleton,
 * exponential backoff. Per-conversation ordering is head-of-line: a due row
 * waits while an earlier undelivered, still-retryable row for the same
 * conversation exists.
 */
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

  /**
   * The NOT EXISTS clause means a batch only ever contains the *head* row of
   * each conversation's queue — a failed head keeps its successors queued
   * (ordering), and a delivered head releases the next row. Iterating lets a
   * chain of events for one conversation drain within a single tick instead
   * of one per poll interval; a failing head leaves the loop naturally
   * because its backoff pushes it (and, via NOT EXISTS, its successors) out
   * of the due set.
   */
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
              WHERE earlier.conversation_id = slack_deliveries.conversation_id
                AND earlier.delivered_at IS NULL
                AND earlier.attempt < ${MAX_ATTEMPTS}
                AND earlier.created_at < slack_deliveries.created_at
            )`,
          ),
        )
        .orderBy(schema.slackDeliveries.createdAt)
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
    routes: RouteRow[];
    token: string;
  }): Promise<void> {
    const { row, payload, routes, token } = input;
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
      case 'conversation.message.received':
      case 'conversation.message.sent':
        return await this.mirrorMessage({ row, payload, context, link, token });
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
    try {
      posted = await this.api.postMessage({
        token,
        channel: link.slackChannelId,
        threadTs: link.slackThreadTs,
        text: messageBodyText(snapshot),
        username: identity.username,
        iconEmoji: identity.iconEmoji,
        iconUrl: identity.avatarKey
          ? `${mcpResourceOrigin()}/v1/slack/avatars/${identity.avatarKey}.png`
          : undefined,
      });
    } catch (err) {
      if (!(err instanceof SlackApiError) || err.apiError !== 'missing_scope') throw err;
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
      })
      .onConflictDoNothing();
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
      .select({ userId: schema.claims.userId, agentId: schema.claims.agentId })
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
    else if (claim?.agentId) claimedBy = 'AI agent';

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

    const snapshot: ConversationSnapshot = {
      displayId: conversation.displayId,
      subject: conversation.subject,
      channelType: channel?.type ?? 'unknown',
      channelName: channel?.name ?? null,
      contactName: contact?.name ?? null,
      contactEmail: contact?.email ?? null,
      contactPhone: contact?.phone ?? null,
      dashboardUrl: `${readWebBaseUrl()}/dashboard`,
    };
    return { conversation, contact: contact ?? null, snapshot };
  }

  private async authorName(
    kind: AuthorKind,
    authorId: string,
    context: ConversationContext,
  ): Promise<string | null> {
    if (kind === 'user') return await this.userName(authorId);
    if (kind === 'end_user') {
      return context.contact?.name ?? context.contact?.email ?? context.contact?.phone ?? null;
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
    if (holderType === 'agent') return 'the AI agent';
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
  contact: typeof schema.convContacts.$inferSelect | null;
  snapshot: ConversationSnapshot;
}

export { POLL_INTERVAL_MS as SLACK_POLL_INTERVAL_MS };
