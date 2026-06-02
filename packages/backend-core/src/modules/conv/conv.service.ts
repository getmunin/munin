import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { schema } from '@getmunin/db';
import { and, asc, desc, eq, ilike, inArray, isNotNull, isNull, notInArray, or, sql, type SQL } from 'drizzle-orm';
import { getCurrentContext, WebhookDispatcher } from '@getmunin/core';
import { CuratorJobsService } from '../curator/curator-jobs.service.ts';
import { ConversationClaimsService } from './conv.claims.service.ts';
import { AlertsService } from '../system-alerts/system-alerts.service.ts';
import { toIsoString } from '../../common/iso.ts';

export class ConvInvalidError extends Error {
  readonly code = 'conv_invalid';
  constructor(message: string) {
    super(`conv_invalid: ${message}`);
  }
}

export class HandoverActiveError extends Error {
  readonly code = 'handover_active';
  constructor(public readonly conversationId: string) {
    super(`handover_active: a human has taken over conversation ${conversationId}`);
  }
}

export class AgentReplyRaceError extends Error {
  readonly code = 'agent_reply_race';
  constructor(
    public readonly conversationId: string,
    public readonly conflictMessageId: string,
  ) {
    super(
      `agent_reply_race: another agent reply (${conflictMessageId}) was posted to conversation ${conversationId} since the caller's sinceMessageId; skipping duplicate`,
    );
  }
}

export const CHANNEL_TYPES = ['email', 'voice', 'chat', 'sms'] as const;
export const STATUSES = ['open', 'snoozed', 'closed', 'spam'] as const;
export const AGENT_MODES = ['auto', 'draft_only', 'off'] as const;
export type ChannelType = (typeof CHANNEL_TYPES)[number];
export type ConversationStatus = (typeof STATUSES)[number];
export type AgentMode = (typeof AGENT_MODES)[number];

export interface ChannelDto {
  id: string;
  type: ChannelType;
  vendor: string;
  name: string;
  active: boolean;
  config: Record<string, unknown>;
  createdAt: string;
}

export interface TopicDto {
  id: string;
  name: string;
  slug: string;
  color: string | null;
}

export interface MessageDto {
  id: string;
  conversationId: string;
  authorType: 'user' | 'agent' | 'end_user' | 'system';
  authorId: string;
  authorName: string | null;
  body: string;
  internal: boolean;
  inReplyToId: string | null;
  attachments: unknown[];
  metadata: Record<string, unknown>;
  createdAt: string;
  seenAt: string | null;
}

export interface ConversationSummary {
  id: string;
  displayId: number;
  status: ConversationStatus;
  channelId: string;
  /**
   * The channel kind (e.g. 'email' | 'chat' | 'sms' | 'voice'). Populated by
   * endpoints that JOIN conv_channels — currently only `GET /v1/conversations/:id`.
   * Other endpoints omit the field rather than fabricating a value; consumers that
   * need it should call the detail endpoint.
   */
  channelType?: string;
  endUserId: string | null;
  contactId: string | null;
  topicId: string | null;
  assigneeUserId: string | null;
  subject: string | null;
  lastMessageAt: string | null;
  lastInboundPreview?: string | null;
  needsHumanAttention: boolean;
  needsHumanAttentionAt: string | null;
  agentMode: AgentMode;
  outreachCampaignId: string | null;
  /**
   * True while a voice call is in progress for this conversation. The chat
   * agent runner uses this to skip auto-replies — the voice channel owns the
   * conversation's reply loop until the call ends, regardless of vendor. Set
   * by `WidgetVoiceService` on call start (writes `voiceActive: true` +
   * `voiceStartedAt` into `conv_conversations.metadata`); cleared by the
   * active voice adapter when the call ends.
   */
  voiceActive: boolean;
  updatedAt: string;
  createdAt: string;
}

export interface ConversationDetail extends ConversationSummary {
  messages: MessageDto[];
  /**
   * The assistant's configured name (`assistants.name`) for the owning org,
   * or null if unset. Runtime consumers fall back to no name preamble when
   * null; the wire format carries the configured value verbatim so each
   * caller controls its own fallback policy.
   */
  assistantName: string | null;
  endUserLocale: string | null;
}

@Injectable()
export class ConvService {
  constructor(
    @Inject(WebhookDispatcher) private readonly webhooks: WebhookDispatcher,
    @Inject(ConversationClaimsService) private readonly claims: ConversationClaimsService,
    @Inject(CuratorJobsService) private readonly curatorJobs: CuratorJobsService,
    @Inject(AlertsService) private readonly alerts: AlertsService,
  ) {}

  // ─── Channels ───────────────────────────────────────────────────────────

  async listChannels(): Promise<ChannelDto[]> {
    const ctx = getCurrentContext();
    const rows = await ctx.db
      .select()
      .from(schema.convChannels)
      .where(isNull(schema.convChannels.archivedAt))
      .orderBy(asc(schema.convChannels.name));
    return rows.map(toChannelDto);
  }

  async archiveChannel(channelId: string): Promise<void> {
    const ctx = getCurrentContext();
    const [row] = await ctx.db
      .update(schema.convChannels)
      .set({ archivedAt: new Date(), active: false })
      .where(
        and(
          eq(schema.convChannels.id, channelId),
          isNull(schema.convChannels.archivedAt),
        ),
      )
      .returning({ id: schema.convChannels.id });
    if (!row) {
      throw new NotFoundException(`channel ${channelId} not found or already archived`);
    }
    await ctx.db
      .update(schema.apiKeys)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(schema.apiKeys.channelId, channelId),
          isNull(schema.apiKeys.revokedAt),
        ),
      );
    await this.alerts.resolveAlert({ source: 'channel_inbound', subjectId: channelId });
  }

  async setChannelActive(channelId: string, active: boolean): Promise<ChannelDto> {
    const ctx = getCurrentContext();
    const [row] = await ctx.db
      .update(schema.convChannels)
      .set({ active, updatedAt: new Date() })
      .where(
        and(
          eq(schema.convChannels.id, channelId),
          isNull(schema.convChannels.archivedAt),
        ),
      )
      .returning();
    if (!row) {
      throw new NotFoundException(`channel ${channelId} not found or archived`);
    }
    if (active) {
      await this.alerts.resolveAlert({ source: 'channel_inbound', subjectId: channelId });
    }
    return toChannelDto(row);
  }

  async createChannel(input: {
    type: ChannelType;
    vendor: string;
    name: string;
    config?: Record<string, unknown>;
  }): Promise<ChannelDto> {
    const ctx = getCurrentContext();
    const actor = ctx.actor!;
    const [row] = await ctx.db
      .insert(schema.convChannels)
      .values({
        orgId: actor.orgId,
        type: input.type,
        vendor: input.vendor,
        name: input.name,
        config: input.config ?? {},
      })
      .returning();
    return toChannelDto(row!);
  }

  async firstActiveChannel(typeHint?: ChannelType): Promise<ChannelDto | null> {
    const ctx = getCurrentContext();
    const filters: SQL[] = [eq(schema.convChannels.active, true)];
    if (typeHint) filters.push(eq(schema.convChannels.type, typeHint));
    const rows = await ctx.db
      .select()
      .from(schema.convChannels)
      .where(and(...filters))
      .orderBy(asc(schema.convChannels.createdAt))
      .limit(1);
    return rows[0] ? toChannelDto(rows[0]) : null;
  }

  // ─── Topics ─────────────────────────────────────────────────────────────

  async listTopics(): Promise<TopicDto[]> {
    const ctx = getCurrentContext();
    const rows = await ctx.db
      .select()
      .from(schema.convTopics)
      .orderBy(asc(schema.convTopics.name));
    return rows.map(toTopicDto);
  }

  async createTopic(input: {
    name: string;
    slug: string;
    color?: string;
  }): Promise<TopicDto> {
    const ctx = getCurrentContext();
    const actor = ctx.actor!;
    if (!isValidSlug(input.slug)) {
      throw new ConvInvalidError('slug must be lowercase letters, digits and hyphens (1-64 chars)');
    }
    const [row] = await ctx.db
      .insert(schema.convTopics)
      .values({
        orgId: actor.orgId,
        name: input.name,
        slug: input.slug,
        color: input.color ?? null,
      })
      .returning();
    return toTopicDto(row!);
  }

  async setTopic(input: {
    conversationId: string;
    topicId: string | null;
  }): Promise<ConversationSummary> {
    const ctx = getCurrentContext();
    const actor = ctx.actor!;
    if (input.topicId !== null) {
      const topicRows = await ctx.db
        .select({ id: schema.convTopics.id })
        .from(schema.convTopics)
        .where(
          and(
            eq(schema.convTopics.id, input.topicId),
            eq(schema.convTopics.orgId, actor.orgId),
          ),
        )
        .limit(1);
      if (!topicRows[0]) {
        throw new NotFoundException(`conv_topic_not_found: ${input.topicId}`);
      }
    }
    const [updated] = await ctx.db
      .update(schema.convConversations)
      .set({ topicId: input.topicId, updatedAt: new Date() })
      .where(eq(schema.convConversations.id, input.conversationId))
      .returning();
    if (!updated) {
      throw new NotFoundException(`conv_not_found: conversation ${input.conversationId}`);
    }
    return toConversationSummary(updated);
  }

  // ─── Conversations ──────────────────────────────────────────────────────

  async listConversationsByIds(
    ids: string[],
    options: { excludeStatuses?: readonly ConversationStatus[] } = {},
  ): Promise<ConversationSummary[]> {
    if (ids.length === 0) return [];
    const ctx = getCurrentContext();
    const filters: SQL[] = [inArray(schema.convConversations.id, ids)];
    if (options.excludeStatuses && options.excludeStatuses.length > 0) {
      filters.push(notInArray(schema.convConversations.status, [...options.excludeStatuses]));
    }
    const rows = await ctx.db
      .select()
      .from(schema.convConversations)
      .where(and(...filters));
    return rows.map((r) => toConversationSummary(r));
  }

  async listConversations(input: {
    status?: ConversationStatus;
    excludeStatuses?: readonly ConversationStatus[];
    assigneeUserId?: string;
    topicId?: string;
    endUserId?: string;
    needsHumanAttention?: boolean;
    limit?: number;
  }): Promise<ConversationSummary[]> {
    const page = await this.listConversationsPage({ ...input });
    return page.items;
  }

  async listConversationsPage(input: {
    status?: ConversationStatus;
    excludeStatuses?: readonly ConversationStatus[];
    assigneeUserId?: string;
    topicId?: string;
    endUserId?: string;
    needsHumanAttention?: boolean;
    limit?: number;
    cursor?: { lastMessageAt: string | null; id: string };
  }): Promise<{ items: ConversationSummary[]; nextCursor: { lastMessageAt: string | null; id: string } | null }> {
    const ctx = getCurrentContext();
    const limit = clampLimit(input.limit, 50, 200);
    const filters: SQL[] = [];
    if (input.status) filters.push(eq(schema.convConversations.status, input.status));
    if (input.excludeStatuses && input.excludeStatuses.length > 0) {
      filters.push(notInArray(schema.convConversations.status, [...input.excludeStatuses]));
    }
    if (input.assigneeUserId) filters.push(eq(schema.convConversations.assigneeUserId, input.assigneeUserId));
    if (input.topicId) filters.push(eq(schema.convConversations.topicId, input.topicId));
    if (input.endUserId) filters.push(eq(schema.convConversations.endUserId, input.endUserId));
    if (input.needsHumanAttention !== undefined) {
      filters.push(eq(schema.convConversations.needsHumanAttention, input.needsHumanAttention));
    }
    if (input.cursor) {
      const { lastMessageAt, id } = input.cursor;
      if (lastMessageAt === null) {
        filters.push(sql`${schema.convConversations.id} < ${id} AND ${schema.convConversations.lastMessageAt} IS NULL`);
      } else {
        filters.push(
          sql`(${schema.convConversations.lastMessageAt}, ${schema.convConversations.id}) < (${new Date(lastMessageAt)}, ${id})`,
        );
      }
    }

    const rows = await ctx.db
      .select({
        conv: schema.convConversations,
        lastInboundPreview: sql<string | null>`(
          SELECT body FROM conv_messages
          WHERE conversation_id = "conv_conversations"."id"
            AND author_type = 'end_user'
            AND internal = false
          ORDER BY created_at DESC
          LIMIT 1
        )`,
      })
      .from(schema.convConversations)
      .where(filters.length === 0 ? undefined : and(...filters))
      .orderBy(
        desc(schema.convConversations.needsHumanAttention),
        desc(schema.convConversations.lastMessageAt),
        desc(schema.convConversations.createdAt),
      )
      .limit(limit + 1);

    const items = rows
      .slice(0, limit)
      .map((row) => toConversationSummary(row.conv, undefined, row.lastInboundPreview));
    const last = items[items.length - 1];
    const nextCursor =
      rows.length > limit && last ? { lastMessageAt: last.lastMessageAt, id: last.id } : null;
    return { items, nextCursor };
  }

  async getConversation(id: string): Promise<ConversationDetail> {
    const ctx = getCurrentContext();
    const conversations = await ctx.db
      .select({
        conv: schema.convConversations,
        channelType: schema.convChannels.type,
        assistantName: schema.assistants.name,
        endUserLocale: sql<string | null>`(${schema.endUsers.metadata}->>'locale')`.as('end_user_locale'),
      })
      .from(schema.convConversations)
      .innerJoin(schema.convChannels, eq(schema.convChannels.id, schema.convConversations.channelId))
      .leftJoin(schema.assistants, eq(schema.assistants.orgId, schema.convConversations.orgId))
      .leftJoin(schema.endUsers, eq(schema.endUsers.id, schema.convConversations.endUserId))
      .where(eq(schema.convConversations.id, id))
      .limit(1);
    const row = conversations[0];
    if (!row) throw new NotFoundException(`conv_not_found: conversation ${id}`);

    const reads = ctx.db
      .select({
        messageId: schema.convMessageReads.messageId,
        seenAt: sql<string | null>`MIN(${schema.convMessageReads.readAt})`.as('seen_at'),
      })
      .from(schema.convMessageReads)
      .where(eq(schema.convMessageReads.conversationId, id))
      .groupBy(schema.convMessageReads.messageId)
      .as('reads');

    const rows = await ctx.db
      .select({
        msg: schema.convMessages,
        seenAt: reads.seenAt,
      })
      .from(schema.convMessages)
      .leftJoin(reads, eq(reads.messageId, schema.convMessages.id))
      .where(eq(schema.convMessages.conversationId, id))
      .orderBy(asc(schema.convMessages.createdAt));

    const messages = rows.map((r) => r.msg);
    const authorNames = await this.loadAuthorNames(messages);
    return {
      ...toConversationSummary(row.conv, row.channelType),
      messages: rows.map((r) => toMessageDto(r.msg, authorNames, r.seenAt)),
      assistantName: row.assistantName ?? null,
      endUserLocale: row.endUserLocale ?? null,
    };
  }

  private async loadAuthorNames(
    messages: ReadonlyArray<typeof schema.convMessages.$inferSelect>,
  ): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    const ctx = getCurrentContext();
    const userIds = [
      ...new Set(messages.filter((m) => m.authorType === 'user').map((m) => m.authorId)),
    ];
    if (userIds.length > 0) {
      const rows = await ctx.db
        .select({ id: schema.users.id, name: schema.users.name, email: schema.users.email })
        .from(schema.users)
        .where(inArray(schema.users.id, userIds));
      for (const r of rows) out.set(r.id, r.name ?? r.email);
    }
    const contactIds = [
      ...new Set(messages.filter((m) => m.authorType === 'end_user').map((m) => m.authorId)),
    ];
    if (contactIds.length > 0) {
      const rows = await ctx.db
        .select({
          id: schema.convContacts.id,
          name: schema.convContacts.name,
          email: schema.convContacts.email,
        })
        .from(schema.convContacts)
        .where(inArray(schema.convContacts.id, contactIds));
      for (const r of rows) {
        const label = r.name ?? r.email;
        if (label) out.set(r.id, label);
      }
    }
    return out;
  }

  async createConversation(input: {
    channelId: string;
    body: string;
    subject?: string;
    endUserId?: string;
    contactId?: string;
    topicId?: string;
    outreachCampaignId?: string;
    agentMode?: AgentMode;
    authorType: 'user' | 'agent' | 'end_user' | 'system';
    authorId: string;
  }): Promise<ConversationDetail> {
    const ctx = getCurrentContext();
    const actor = ctx.actor!;
    const channelRows = await ctx.db
      .select({
        id: schema.convChannels.id,
        active: schema.convChannels.active,
        type: schema.convChannels.type,
      })
      .from(schema.convChannels)
      .where(eq(schema.convChannels.id, input.channelId))
      .limit(1);
    if (!channelRows[0]) throw new NotFoundException(`conv_not_found: channel ${input.channelId}`);
    if (!channelRows[0].active) {
      throw new ConvInvalidError(`channel ${input.channelId} is not active`);
    }
    const channelType = channelRows[0].type;

    const conv = await this.insertConversationWithRetry({
      orgId: actor.orgId,
      channelId: input.channelId,
      contactId: input.contactId ?? null,
      endUserId: input.endUserId ?? null,
      topicId: input.topicId ?? null,
      subject: input.subject ?? null,
      outreachCampaignId: input.outreachCampaignId ?? null,
      agentMode: input.agentMode ?? 'auto',
    });

    const [firstMsg] = await ctx.db
      .insert(schema.convMessages)
      .values({
        orgId: actor.orgId,
        conversationId: conv.id,
        authorType: input.authorType,
        authorId: input.authorId,
        body: input.body,
        internal: false,
      })
      .returning();
    await ctx.db
      .update(schema.convConversations)
      .set({ lastMessageAt: new Date() })
      .where(eq(schema.convConversations.id, conv.id));

    await this.webhooks.emit({
      type: 'conversation.created',
      payload: { conversationId: conv.id, displayId: conv.displayId, channelId: conv.channelId },
    });
    await this.webhooks.emit({
      type:
        input.authorType === 'end_user'
          ? 'conversation.message.received'
          : 'conversation.message.sent',
      payload: {
        conversationId: conv.id,
        messageId: firstMsg!.id,
        authorType: input.authorType,
        internal: false,
      },
    });

    if (
      channelType === 'email' &&
      input.authorType !== 'end_user' &&
      input.authorType !== 'system'
    ) {
      await this.enqueueEmailOutbound(firstMsg!.id, conv.id, conv.channelId);
    }

    return this.getConversation(conv.id);
  }

  async sendMessage(input: {
    conversationId: string;
    body: string;
    internal?: boolean;
    inReplyToId?: string;
    authorType: 'user' | 'agent' | 'end_user' | 'system';
    authorId: string;
    preserveAttention?: boolean;
    sinceMessageId?: string;
    claim?: boolean;
  }): Promise<MessageDto> {
    const ctx = getCurrentContext();
    const actor = ctx.actor!;
    const convRows = await ctx.db
      .select({
        id: schema.convConversations.id,
        channelId: schema.convConversations.channelId,
        channelType: schema.convChannels.type,
        needsHumanAttention: schema.convConversations.needsHumanAttention,
        outreachCampaignId: schema.convConversations.outreachCampaignId,
        agentMode: schema.convConversations.agentMode,
      })
      .from(schema.convConversations)
      .innerJoin(schema.convChannels, eq(schema.convChannels.id, schema.convConversations.channelId))
      .where(eq(schema.convConversations.id, input.conversationId))
      .limit(1);
    const conv = convRows[0];
    if (!conv) throw new NotFoundException(`conv_not_found: conversation ${input.conversationId}`);

    if (input.authorType === 'agent' && (await this.claims.isHeldByOther(input.conversationId))) {
      throw new HandoverActiveError(input.conversationId);
    }

    if (
      input.authorType === 'agent' &&
      !input.internal &&
      input.sinceMessageId
    ) {
      const conflictRows = await ctx.db
        .select({ id: schema.convMessages.id })
        .from(schema.convMessages)
        .where(
          and(
            eq(schema.convMessages.conversationId, input.conversationId),
            eq(schema.convMessages.authorType, 'agent'),
            eq(schema.convMessages.internal, false),
            sql`${schema.convMessages.createdAt} > (
              SELECT created_at FROM conv_messages WHERE id = ${input.sinceMessageId}
            )`,
          ),
        )
        .limit(1);
      if (conflictRows[0]) {
        throw new AgentReplyRaceError(input.conversationId, conflictRows[0].id);
      }
    }

    const [row] = await ctx.db
      .insert(schema.convMessages)
      .values({
        orgId: actor.orgId,
        conversationId: input.conversationId,
        authorType: input.authorType,
        authorId: input.authorId,
        body: input.body,
        internal: input.internal ?? false,
        inReplyToId: input.inReplyToId ?? null,
      })
      .returning();
    const clearAttention =
      (input.authorType === 'user' || input.authorType === 'agent') &&
      !input.internal &&
      !input.preserveAttention;
    await ctx.db
      .update(schema.convConversations)
      .set({
        lastMessageAt: new Date(),
        updatedAt: new Date(),
        ...(clearAttention
          ? { needsHumanAttention: false, needsHumanAttentionAt: null }
          : {}),
      })
      .where(eq(schema.convConversations.id, input.conversationId));

    if (
      actor.type === 'user' &&
      input.authorType === 'user' &&
      !input.internal &&
      input.claim !== false
    ) {
      try {
        await this.claims.claim({ conversationId: input.conversationId });
      } catch (err) {
        if (!(err instanceof Error && err.message.includes('claim_held_by_other'))) {
          throw err;
        }
      }
    }

    if (!row!.internal) {
      await this.webhooks.emit({
        type:
          input.authorType === 'end_user'
            ? 'conversation.message.received'
            : 'conversation.message.sent',
        payload: {
          conversationId: input.conversationId,
          messageId: row!.id,
          authorType: input.authorType,
          internal: false,
        },
      });

      if (
        input.authorType === 'end_user' &&
        conv.outreachCampaignId &&
        conv.agentMode === 'draft_only'
      ) {
        await this.curatorJobs.enqueue({
          jobUri: 'skill://outreach/draft-reply-email',
          userPrompt:
            `Run an outreach reply-draft pass for conversation ${input.conversationId}. ` +
            `Follow skill://outreach/draft-reply-email exactly. Read the thread, identify the prospect's ` +
            `intent on the latest end-user message, and file a draft via outreach_propose_reply. ` +
            `Do NOT send anything — drafts go to the operator review queue.`,
          sourceEventType: 'conversation.message.received',
          sourceEventPayload: {
            conversationId: input.conversationId,
            messageId: row!.id,
            outreachCampaignId: conv.outreachCampaignId,
          },
          dedupeKey: `outreach-draft-reply:msg:${row!.id}`,
        });
      }

      if (clearAttention && conv.needsHumanAttention) {
        await this.webhooks.emit({
          type: 'conversation.handover_resolved',
          payload: {
            conversationId: input.conversationId,
            messageId: row!.id,
            authorType: input.authorType,
          },
        });
        await this.curatorJobs.enqueue({
          jobUri: 'skill://kb/review-content',
          userPrompt:
            `Run a KB curation pass for conversation ${input.conversationId}. ` +
            `Follow the skill exactly. Per-conversation mode: skip the conv_list_conversations ` +
            `step and go straight to conv_get_conversation(${input.conversationId}). Extract the ` +
            `(end-user question, human-reply) pair, apply the skip rules, and file via ` +
            `kb_propose_curation_candidate if it's worth keeping.`,
          sourceEventType: 'conversation.handover_resolved',
          sourceEventPayload: {
            conversationId: input.conversationId,
            messageId: row!.id,
            authorType: input.authorType,
          },
          dedupeKey: `kb-curation:msg:${row!.id}`,
        });
      }

      // Enqueue an outbound delivery row for staff-authored messages on
      // email channels. The email-outbound worker picks these up, builds
      // the MIME, and ships them via SMTP. End-user-authored messages on
      // an email channel arrived via the IMAP poller — they're already
      // outside; no need to send them again.
      if (
        conv.channelType === 'email' &&
        input.authorType !== 'end_user' &&
        input.authorType !== 'system'
      ) {
        await this.enqueueEmailOutbound(row!.id, conv.id, conv.channelId);
      }
    }
    return toMessageDto(row!);
  }

  /**
   * Insert a `conv_message_deliveries` row for a freshly-created outbound
   * message on an email channel. Stamps `in_reply_to_header` from the
   * most-recent successful outbound on the same conversation so reply
   * chains hold. Lives on ConvService rather than EmailService to keep
   * sendMessage from importing the email module.
   */
  private async enqueueEmailOutbound(
    messageId: string,
    conversationId: string,
    channelId: string,
  ): Promise<void> {
    const ctx = getCurrentContext();
    const actor = ctx.actor!;
    const prior = await ctx.db
      .select({ messageIdHeader: schema.convMessageDeliveries.messageIdHeader })
      .from(schema.convMessageDeliveries)
      .innerJoin(
        schema.convMessages,
        eq(schema.convMessages.id, schema.convMessageDeliveries.messageId),
      )
      .where(
        and(
          eq(schema.convMessages.conversationId, conversationId),
          eq(schema.convMessageDeliveries.status, 'sent'),
          isNotNull(schema.convMessageDeliveries.messageIdHeader),
        ),
      )
      .orderBy(desc(schema.convMessageDeliveries.sentAt))
      .limit(1);
    await ctx.db.insert(schema.convMessageDeliveries).values({
      orgId: actor.orgId,
      messageId,
      channelId,
      status: 'queued',
      attempt: 0,
      nextAttemptAt: new Date(),
      inReplyToHeader: prior[0]?.messageIdHeader ?? null,
    });
  }

  async stripMessageSignature(input: {
    messageId: string;
    body: string;
    signatureText?: string;
  }): Promise<{ updated: boolean; reason?: string }> {
    const ctx = getCurrentContext();
    const actor = ctx.actor!;
    const rows = await ctx.db
      .select()
      .from(schema.convMessages)
      .where(eq(schema.convMessages.id, input.messageId))
      .limit(1);
    const row = rows[0];
    if (!row) return { updated: false, reason: 'message_not_found' };
    if (row.orgId !== actor.orgId) return { updated: false, reason: 'wrong_org' };
    if (row.authorType !== 'end_user') return { updated: false, reason: 'not_inbound' };

    const newBody = input.body.trim();
    if (!newBody) return { updated: false, reason: 'empty_body' };

    const originalBody = row.body;
    if (newBody === originalBody) return { updated: false, reason: 'no_change' };

    if (
      originalBody.length > 0 &&
      newBody.length < originalBody.length * 0.5 &&
      !looksLikeCompleteProse(newBody)
    ) {
      return { updated: false, reason: 'too_aggressive' };
    }

    const existingMeta = row.metadata ?? {};
    const patchedMeta: Record<string, unknown> = {
      ...existingMeta,
      preStripBody: originalBody,
      ...(input.signatureText ? { signatureText: input.signatureText } : {}),
    };

    await ctx.db
      .update(schema.convMessages)
      .set({ body: newBody, metadata: patchedMeta })
      .where(eq(schema.convMessages.id, input.messageId));
    return { updated: true };
  }

  async assignConversation(input: {
    id: string;
    assigneeUserId: string | null;
  }): Promise<ConversationSummary> {
    const ctx = getCurrentContext();
    const result = await ctx.db
      .update(schema.convConversations)
      .set({ assigneeUserId: input.assigneeUserId, updatedAt: new Date() })
      .where(eq(schema.convConversations.id, input.id))
      .returning();
    if (!result[0]) throw new NotFoundException(`conv_not_found: conversation ${input.id}`);
    await this.webhooks.emit({
      type: 'conversation.assigned',
      payload: { conversationId: input.id, assigneeUserId: input.assigneeUserId },
    });
    return toConversationSummary(result[0]);
  }

  async setAgentMode(input: {
    id: string;
    mode: AgentMode;
  }): Promise<ConversationSummary> {
    if (!AGENT_MODES.includes(input.mode)) {
      throw new ConvInvalidError(`agentMode must be one of ${AGENT_MODES.join(', ')}`);
    }
    const ctx = getCurrentContext();
    const [updated] = await ctx.db
      .update(schema.convConversations)
      .set({ agentMode: input.mode, updatedAt: new Date() })
      .where(eq(schema.convConversations.id, input.id))
      .returning();
    if (!updated) throw new NotFoundException(`conv_not_found: conversation ${input.id}`);
    await this.webhooks.emit({
      type: 'conversation.agent_mode_changed',
      payload: { conversationId: input.id, agentMode: input.mode },
    });
    return toConversationSummary(updated);
  }

  async changeStatus(input: {
    id: string;
    status: ConversationStatus;
    snoozeUntil?: string;
  }): Promise<ConversationSummary> {
    const ctx = getCurrentContext();
    if (input.status === 'snoozed' && !input.snoozeUntil) {
      throw new ConvInvalidError('snoozeUntil is required when status is "snoozed"');
    }
    const clearAttention = input.status === 'closed';
    const releaseRunner = input.status === 'closed';
    const result = await ctx.db
      .update(schema.convConversations)
      .set({
        status: input.status,
        snoozeUntil: input.snoozeUntil ? new Date(input.snoozeUntil) : null,
        updatedAt: new Date(),
        ...(clearAttention
          ? { needsHumanAttention: false, needsHumanAttentionAt: null }
          : {}),
        ...(releaseRunner
          ? { runnerHolder: null, runnerLeaseExpiresAt: null }
          : {}),
      })
      .where(eq(schema.convConversations.id, input.id))
      .returning();
    if (!result[0]) throw new NotFoundException(`conv_not_found: conversation ${input.id}`);
    await this.webhooks.emit({
      type: 'conversation.status_changed',
      payload: { conversationId: input.id, status: input.status },
    });
    if (input.status === 'closed') {
      await this.curatorJobs.enqueue({
        jobUri: 'skill://crm/extract-contact-from-message',
        userPrompt:
          `Run a CRM contact-extraction pass for conversation ${input.id}. ` +
          `Follow the skill exactly: read the conversation, extract identifying info ` +
          `from end-user messages, dedupe via crm_find_contact, then either create ` +
          `(crm_create_contact) or backfill empty fields (crm_update_contact). ` +
          `Skip silently if nothing identifying was volunteered.`,
        sourceEventType: 'conversation.status_changed',
        sourceEventPayload: { conversationId: input.id, status: 'closed' },
        dedupeKey: `crm-contact-extract:conv:${input.id}`,
      });
    }
    return toConversationSummary(result[0]);
  }

  async tryAcquireConversation(input: {
    conversationId: string;
    holder: string;
    leaseSeconds: number;
  }): Promise<{ acquired: boolean; leaseExpiresAt?: string; heldBy?: string | null }> {
    const ctx = getCurrentContext();
    const expiresAt = new Date(Date.now() + Math.max(30, input.leaseSeconds) * 1000);
    const result = await ctx.db
      .update(schema.convConversations)
      .set({
        runnerHolder: input.holder,
        runnerLeaseExpiresAt: expiresAt,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.convConversations.id, input.conversationId),
          or(
            isNull(schema.convConversations.runnerHolder),
            eq(schema.convConversations.runnerHolder, input.holder),
            sql`${schema.convConversations.runnerLeaseExpiresAt} IS NULL OR ${schema.convConversations.runnerLeaseExpiresAt} < now()`,
          ),
        ),
      )
      .returning({
        leaseExpiresAt: schema.convConversations.runnerLeaseExpiresAt,
      });

    if (result[0]) {
      return {
        acquired: true,
        leaseExpiresAt: result[0].leaseExpiresAt?.toISOString(),
      };
    }

    const [current] = await ctx.db
      .select({ runnerHolder: schema.convConversations.runnerHolder })
      .from(schema.convConversations)
      .where(eq(schema.convConversations.id, input.conversationId))
      .limit(1);
    if (!current) throw new NotFoundException(`conv_not_found: conversation ${input.conversationId}`);
    return { acquired: false, heldBy: current.runnerHolder };
  }

  async releaseConversationClaim(input: {
    conversationId: string;
    holder: string;
  }): Promise<{ released: boolean }> {
    const ctx = getCurrentContext();
    const result = await ctx.db
      .update(schema.convConversations)
      .set({
        runnerHolder: null,
        runnerLeaseExpiresAt: null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.convConversations.id, input.conversationId),
          eq(schema.convConversations.runnerHolder, input.holder),
        ),
      )
      .returning({ id: schema.convConversations.id });
    return { released: result.length > 0 };
  }

  async requestHandover(input: {
    conversationId: string;
    reason?: string;
    suggestedReply?: string;
    publicFallbackMessage?: string;
    postSystemNote?: boolean;
  }): Promise<ConversationSummary> {
    const ctx = getCurrentContext();
    const actor = ctx.actor!;
    const convRows = await ctx.db
      .select()
      .from(schema.convConversations)
      .where(eq(schema.convConversations.id, input.conversationId))
      .limit(1);
    const existing = convRows[0];
    if (!existing) {
      throw new NotFoundException(`conv_not_found: conversation ${input.conversationId}`);
    }

    if (existing.needsHumanAttention) {
      return toConversationSummary(existing);
    }

    const now = new Date();
    const reason = input.reason?.trim();
    if (input.postSystemNote !== false) {
      const body = reason ? `Agent requested handover: ${reason}` : 'Agent requested handover.';
      await ctx.db.insert(schema.convMessages).values({
        orgId: actor.orgId,
        conversationId: input.conversationId,
        authorType: 'system',
        authorId: actor.id,
        body,
        internal: true,
      });
    }

    const draft = input.suggestedReply?.trim();
    if (draft) {
      await ctx.db.insert(schema.convMessages).values({
        orgId: actor.orgId,
        conversationId: input.conversationId,
        authorType: 'agent',
        authorId: actor.id,
        body: draft,
        internal: true,
        metadata: { kind: 'draft_reply' },
      });
    }

    const publicFallback = input.publicFallbackMessage?.trim();
    if (publicFallback) {
      await ctx.db.insert(schema.convMessages).values({
        orgId: actor.orgId,
        conversationId: input.conversationId,
        authorType: 'agent',
        authorId: actor.id,
        body: publicFallback,
        internal: false,
        metadata: { kind: 'handover_fallback' },
      });
    }

    const [updated] = await ctx.db
      .update(schema.convConversations)
      .set({
        needsHumanAttention: true,
        needsHumanAttentionAt: now,
        lastMessageAt: now,
        updatedAt: now,
      })
      .where(eq(schema.convConversations.id, input.conversationId))
      .returning();

    await this.webhooks.emit({
      type: 'conversation.handover_requested',
      payload: {
        conversationId: input.conversationId,
        reason: reason ?? null,
      },
    });

    return toConversationSummary(updated!);
  }

  async searchMessages(input: { query: string; limit?: number }): Promise<MessageDto[]> {
    const ctx = getCurrentContext();
    const limit = clampLimit(input.limit, 25, 100);
    const trimmed = input.query.trim();
    if (!trimmed) return [];
    const rows = await ctx.db
      .select()
      .from(schema.convMessages)
      .where(or(ilike(schema.convMessages.body, `%${trimmed}%`)))
      .orderBy(desc(schema.convMessages.createdAt))
      .limit(limit);
    const authorNames = await this.loadAuthorNames(rows);
    return rows.map((r) => toMessageDto(r, authorNames));
  }

  /**
   * Insert a conversation, retrying on `display_id` collision (when two
   * concurrent inserts in the same org pick the same MAX+1). The unique
   * index on (org_id, display_id) makes this race detectable; we retry up
   * to 5 times before giving up.
   */
  private async insertConversationWithRetry(values: {
    orgId: string;
    channelId: string;
    contactId: string | null;
    endUserId: string | null;
    topicId: string | null;
    subject: string | null;
    outreachCampaignId?: string | null;
    agentMode?: AgentMode;
  }): Promise<typeof schema.convConversations.$inferSelect> {
    const ctx = getCurrentContext();
    let lastErr: unknown = null;
    for (let attempt = 0; attempt < 5; attempt++) {
      const nextRows = await ctx.db.execute<{ next: number } & Record<string, unknown>>(
        sql`SELECT conv_next_display_id(${values.orgId}) AS next`,
      );
      const displayId = nextRows[0]!.next + attempt;
      try {
        const [row] = await ctx.db
          .insert(schema.convConversations)
          .values({ ...values, displayId, status: 'open' })
          .returning();
        return row!;
      } catch (err) {
        lastErr = err;
        const msg = err instanceof Error ? err.message : String(err);
        if (!/conv_conversations_display_uq|duplicate key/i.test(msg)) throw err;
      }
    }
    throw new Error(`conv_conversations: failed to allocate display_id after retries: ${String(lastErr)}`);
  }
}

// ─── DTO mappers / helpers ─────────────────────────────────────────────────

function toChannelDto(row: typeof schema.convChannels.$inferSelect): ChannelDto {
  return {
    id: row.id,
    type: row.type as ChannelType,
    vendor: row.vendor,
    name: row.name,
    active: row.active,
    config: row.config,
    createdAt: row.createdAt.toISOString(),
  };
}

function toTopicDto(row: typeof schema.convTopics.$inferSelect): TopicDto {
  return { id: row.id, name: row.name, slug: row.slug, color: row.color };
}

function previewText(body: string | null): string | null {
  if (body === null) return null;
  const collapsed = body.replace(/\s+/g, ' ').trim();
  if (collapsed.length === 0) return null;
  return collapsed.length > 200 ? `${collapsed.slice(0, 199)}…` : collapsed;
}

function toConversationSummary(
  row: typeof schema.convConversations.$inferSelect,
  channelType?: string,
  lastInboundPreview?: string | null,
): ConversationSummary {
  return {
    id: row.id,
    displayId: row.displayId,
    status: row.status as ConversationStatus,
    channelId: row.channelId,
    ...(channelType ? { channelType } : {}),
    endUserId: row.endUserId,
    contactId: row.contactId,
    topicId: row.topicId,
    assigneeUserId: row.assigneeUserId,
    subject: row.subject,
    lastMessageAt: row.lastMessageAt?.toISOString() ?? null,
    ...(lastInboundPreview !== undefined
      ? { lastInboundPreview: previewText(lastInboundPreview) }
      : {}),
    needsHumanAttention: row.needsHumanAttention,
    needsHumanAttentionAt: row.needsHumanAttentionAt?.toISOString() ?? null,
    agentMode: row.agentMode as AgentMode,
    outreachCampaignId: row.outreachCampaignId,
    voiceActive: row.metadata.voiceActive === true,
    updatedAt: row.updatedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}

function toMessageDto(
  row: typeof schema.convMessages.$inferSelect,
  authorNames: Map<string, string> = new Map(),
  seenAt: Date | string | null = null,
): MessageDto {
  return {
    id: row.id,
    conversationId: row.conversationId,
    authorType: row.authorType as MessageDto['authorType'],
    authorId: row.authorId,
    authorName: authorNames.get(row.authorId) ?? null,
    body: row.body,
    internal: row.internal,
    inReplyToId: row.inReplyToId,
    attachments: row.attachments,
    metadata: row.metadata,
    createdAt: toIsoString(row.createdAt) ?? new Date(0).toISOString(),
    seenAt: toIsoString(seenAt),
  };
}


function isValidSlug(slug: string): boolean {
  return /^[a-z0-9][a-z0-9-]{0,63}$/.test(slug);
}

function clampLimit(value: number | undefined, fallback: number, max: number): number {
  if (value === undefined || value <= 0) return fallback;
  return Math.min(value, max);
}

function looksLikeCompleteProse(text: string): boolean {
  const trimmed = text.trim();
  if (!/[.!?]['")\]]*\s*$/.test(trimmed)) return false;
  const wordCount = trimmed.split(/\s+/).filter((w) => /\w/.test(w)).length;
  return wordCount >= 4;
}
