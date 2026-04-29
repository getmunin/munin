import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { schema } from '@getmunin/db';
import { and, asc, desc, eq, ilike, isNotNull, or, sql, type SQL } from 'drizzle-orm';
import { getCurrentContext, WebhookDispatcher } from '@getmunin/core';

export class ConvInvalidError extends Error {
  readonly code = 'conv_invalid';
  constructor(message: string) {
    super(`conv_invalid: ${message}`);
  }
}

export const CHANNEL_TYPES = ['email', 'voice', 'chat', 'sms'] as const;
export const STATUSES = ['open', 'snoozed', 'closed', 'spam'] as const;
export type ChannelType = (typeof CHANNEL_TYPES)[number];
export type ConversationStatus = (typeof STATUSES)[number];

export interface ChannelDto {
  id: string;
  type: ChannelType;
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
  body: string;
  internal: boolean;
  inReplyToId: string | null;
  attachments: unknown[];
  createdAt: string;
}

export interface ConversationSummary {
  id: string;
  displayId: number;
  status: ConversationStatus;
  channelId: string;
  endUserId: string | null;
  contactId: string | null;
  topicId: string | null;
  assigneeUserId: string | null;
  subject: string | null;
  lastMessageAt: string | null;
  updatedAt: string;
  createdAt: string;
}

export interface ConversationDetail extends ConversationSummary {
  messages: MessageDto[];
}

@Injectable()
export class ConvService {
  constructor(@Inject(WebhookDispatcher) private readonly webhooks: WebhookDispatcher) {}

  // ─── Channels ───────────────────────────────────────────────────────────

  async listChannels(): Promise<ChannelDto[]> {
    const ctx = getCurrentContext();
    const rows = await ctx.db
      .select()
      .from(schema.convChannels)
      .orderBy(asc(schema.convChannels.name));
    return rows.map(toChannelDto);
  }

  async createChannel(input: {
    type: ChannelType;
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

  // ─── Conversations ──────────────────────────────────────────────────────

  async listConversations(input: {
    status?: ConversationStatus;
    assigneeUserId?: string;
    topicId?: string;
    endUserId?: string;
    limit?: number;
  }): Promise<ConversationSummary[]> {
    const ctx = getCurrentContext();
    const limit = clampLimit(input.limit, 50, 200);
    const filters: SQL[] = [];
    if (input.status) filters.push(eq(schema.convConversations.status, input.status));
    if (input.assigneeUserId) filters.push(eq(schema.convConversations.assigneeUserId, input.assigneeUserId));
    if (input.topicId) filters.push(eq(schema.convConversations.topicId, input.topicId));
    if (input.endUserId) filters.push(eq(schema.convConversations.endUserId, input.endUserId));

    const rows = await ctx.db
      .select()
      .from(schema.convConversations)
      .where(filters.length === 0 ? undefined : and(...filters))
      .orderBy(desc(schema.convConversations.lastMessageAt), desc(schema.convConversations.createdAt))
      .limit(limit);
    return rows.map(toConversationSummary);
  }

  async getConversation(id: string): Promise<ConversationDetail> {
    const ctx = getCurrentContext();
    const conversations = await ctx.db
      .select()
      .from(schema.convConversations)
      .where(eq(schema.convConversations.id, id))
      .limit(1);
    const conv = conversations[0];
    if (!conv) throw new NotFoundException(`conv_not_found: conversation ${id}`);

    const messages = await ctx.db
      .select()
      .from(schema.convMessages)
      .where(eq(schema.convMessages.conversationId, id))
      .orderBy(asc(schema.convMessages.createdAt));

    return {
      ...toConversationSummary(conv),
      messages: messages.map(toMessageDto),
    };
  }

  async createConversation(input: {
    channelId: string;
    body: string;
    subject?: string;
    endUserId?: string;
    contactId?: string;
    topicId?: string;
    authorType: 'user' | 'agent' | 'end_user' | 'system';
    authorId: string;
  }): Promise<ConversationDetail> {
    const ctx = getCurrentContext();
    const actor = ctx.actor!;
    const channelRows = await ctx.db
      .select({ id: schema.convChannels.id, active: schema.convChannels.active })
      .from(schema.convChannels)
      .where(eq(schema.convChannels.id, input.channelId))
      .limit(1);
    if (!channelRows[0]) throw new NotFoundException(`conv_not_found: channel ${input.channelId}`);
    if (!channelRows[0].active) {
      throw new ConvInvalidError(`channel ${input.channelId} is not active`);
    }

    const conv = await this.insertConversationWithRetry({
      orgId: actor.orgId,
      channelId: input.channelId,
      contactId: input.contactId ?? null,
      endUserId: input.endUserId ?? null,
      topicId: input.topicId ?? null,
      subject: input.subject ?? null,
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

    return this.getConversation(conv.id);
  }

  async sendMessage(input: {
    conversationId: string;
    body: string;
    internal?: boolean;
    inReplyToId?: string;
    authorType: 'user' | 'agent' | 'end_user' | 'system';
    authorId: string;
  }): Promise<MessageDto> {
    const ctx = getCurrentContext();
    const actor = ctx.actor!;
    const convRows = await ctx.db
      .select({
        id: schema.convConversations.id,
        channelId: schema.convConversations.channelId,
        channelType: schema.convChannels.type,
      })
      .from(schema.convConversations)
      .innerJoin(schema.convChannels, eq(schema.convChannels.id, schema.convConversations.channelId))
      .where(eq(schema.convConversations.id, input.conversationId))
      .limit(1);
    const conv = convRows[0];
    if (!conv) throw new NotFoundException(`conv_not_found: conversation ${input.conversationId}`);

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
    await ctx.db
      .update(schema.convConversations)
      .set({ lastMessageAt: new Date(), updatedAt: new Date() })
      .where(eq(schema.convConversations.id, input.conversationId));

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

  async changeStatus(input: {
    id: string;
    status: ConversationStatus;
    snoozeUntil?: string;
  }): Promise<ConversationSummary> {
    const ctx = getCurrentContext();
    if (input.status === 'snoozed' && !input.snoozeUntil) {
      throw new ConvInvalidError('snoozeUntil is required when status is "snoozed"');
    }
    const result = await ctx.db
      .update(schema.convConversations)
      .set({
        status: input.status,
        snoozeUntil: input.snoozeUntil ? new Date(input.snoozeUntil) : null,
        updatedAt: new Date(),
      })
      .where(eq(schema.convConversations.id, input.id))
      .returning();
    if (!result[0]) throw new NotFoundException(`conv_not_found: conversation ${input.id}`);
    await this.webhooks.emit({
      type: 'conversation.status_changed',
      payload: { conversationId: input.id, status: input.status },
    });
    return toConversationSummary(result[0]);
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
    return rows.map(toMessageDto);
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
    name: row.name,
    active: row.active,
    config: row.config,
    createdAt: row.createdAt.toISOString(),
  };
}

function toTopicDto(row: typeof schema.convTopics.$inferSelect): TopicDto {
  return { id: row.id, name: row.name, slug: row.slug, color: row.color };
}

function toConversationSummary(
  row: typeof schema.convConversations.$inferSelect,
): ConversationSummary {
  return {
    id: row.id,
    displayId: row.displayId,
    status: row.status as ConversationStatus,
    channelId: row.channelId,
    endUserId: row.endUserId,
    contactId: row.contactId,
    topicId: row.topicId,
    assigneeUserId: row.assigneeUserId,
    subject: row.subject,
    lastMessageAt: row.lastMessageAt?.toISOString() ?? null,
    updatedAt: row.updatedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}

function toMessageDto(row: typeof schema.convMessages.$inferSelect): MessageDto {
  return {
    id: row.id,
    conversationId: row.conversationId,
    authorType: row.authorType as MessageDto['authorType'],
    authorId: row.authorId,
    body: row.body,
    internal: row.internal,
    inReplyToId: row.inReplyToId,
    attachments: row.attachments,
    createdAt: row.createdAt.toISOString(),
  };
}

function isValidSlug(slug: string): boolean {
  return /^[a-z0-9][a-z0-9-]{0,63}$/.test(slug);
}

function clampLimit(value: number | undefined, fallback: number, max: number): number {
  if (value === undefined || value <= 0) return fallback;
  return Math.min(value, max);
}
