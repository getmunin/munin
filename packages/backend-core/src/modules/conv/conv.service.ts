import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { schema } from '@getmunin/db';
import { and, asc, desc, eq, gte, ilike, inArray, isNotNull, isNull, lte, ne, notInArray, or, sql, type SQL } from 'drizzle-orm';
import { getCurrentContext, sameAfterNormalizing, WebhookDispatcher } from '@getmunin/core';
import type { MessageComponent } from '@getmunin/types';
import { CuratorJobsService } from '../curator/curator-jobs.service.ts';
import { buildSetTopicAndTitleJob } from './set-topic-job.ts';
import { buildDeltaCurationPrompt, buildGapCurationPrompt } from './curation-job.ts';
import { applyTenancyGUCs } from '../../common/tenancy/tenancy.interceptor.ts';
import { ConversationClaimsService } from './conv.claims.service.ts';
import { countSignatureHints, isTrailingSignatureSplit } from './email/reply-history.ts';
import { readPendingSetup } from './channels/channel-admin.ts';
import { publicChannelConfig } from './channels/public-config.ts';
import { AlertsService } from '../system-alerts/system-alerts.service.ts';
import { toIsoString } from '../../common/iso.ts';
import { newImportResult, resolveId } from '../../common/transfer/transfer.helpers.ts';
import type { IdMap, ImportResult } from '../../common/transfer/transfer.types.ts';

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
export const HANDOVER_FILTERS = ['active', 'resolved', 'never'] as const;
export type HandoverFilter = (typeof HANDOVER_FILTERS)[number];

const DELIVERABLE_CHANNEL_TYPES: readonly string[] = ['email', 'sms'];
export type ChannelType = (typeof CHANNEL_TYPES)[number];
export type ConversationStatus = (typeof STATUSES)[number];
export type AgentMode = (typeof AGENT_MODES)[number];

const AWAITING_REPLY_LOOKBACK_MINUTES = 60;
const AUTO_CLOSE_THRESHOLD_DAYS = 2;

export interface ChannelDto {
  id: string;
  type: ChannelType;
  vendor: string;
  name: string;
  active: boolean;
  config: Record<string, unknown>;
  defaultAgentMode: AgentMode;
  needsCredentials: boolean;
  createdAt: string;
}

export interface TopicDto {
  id: string;
  name: string;
  slug: string;
  color: string | null;
}

export interface ApprovedDraftStamp {
  draftMessageId: string;
  draftBody: string;
  edited: boolean;
  retrievedDocumentIds: string[];
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
  firstOpenedAt: string | null;
  lastOpenedAt: string | null;
  openCount: number | null;
}

export interface EmailOpenStatsChannel {
  channelId: string;
  channelName: string;
  trackOpens: boolean;
  sent: number;
  opened: number;
  totalOpens: number;
  openRate: number | null;
}

export interface EmailOpenStats {
  since: string;
  sinceDays: number;
  channels: EmailOpenStatsChannel[];
  totals: Omit<EmailOpenStatsChannel, 'channelId' | 'channelName' | 'trackOpens'>;
}

export interface ConversationSummary {
  id: string;
  displayId: number;
  status: ConversationStatus;
  channelId: string;
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
  handoverResolvedAt: string | null;
  agentMode: AgentMode;
  outreachCampaignId: string | null;
  voiceActive: boolean;
  updatedAt: string;
  createdAt: string;
}

export interface ConversationQueueItem extends ConversationSummary {
  channelType: string;
  customerName: string | null;
  customerEmail: string | null;
  topicName: string | null;
  topicSlug: string | null;
  topicAgentMode: AgentMode | null;
  claim: { holderId: string; holderName: string | null; expiresAt: string } | null;
  noteCount: number;
  hasPendingDraft: boolean;
}

export interface ConversationDetail extends ConversationSummary {
  messages: MessageDto[];
  assistantName: string | null;
  endUserLocale: string | null;
  contactEmail: string | null;
  contactName: string | null;
  contactPhone: string | null;
}

export interface ConvChannelExport {
  id: string;
  type: ChannelType;
  vendor: string;
  name: string;
  active: boolean;
}

export interface ConvConversationExport {
  id: string;
  channelId: string;
  subject: string | null;
  status: ConversationStatus;
  topicSlug: string | null;
  agentMode: AgentMode;
}

export interface ConvMessageExport {
  id: string;
  conversationId: string;
  authorType: 'user' | 'agent' | 'end_user' | 'system';
  authorId: string;
  body: string;
  internal: boolean;
  inReplyToId: string | null;
}

export interface ConvExportData {
  channels: ConvChannelExport[];
  conversations: ConvConversationExport[];
  messages: ConvMessageExport[];
}

@Injectable()
export class ConvService {
  private readonly logger = new Logger(ConvService.name);

  constructor(
    @Inject(WebhookDispatcher) private readonly webhooks: WebhookDispatcher,
    @Inject(ConversationClaimsService) private readonly claims: ConversationClaimsService,
    @Inject(CuratorJobsService) private readonly curatorJobs: CuratorJobsService,
    @Inject(AlertsService) private readonly alerts: AlertsService,
  ) {}


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
    const existing = await ctx.db
      .select({ id: schema.convTopics.id })
      .from(schema.convTopics)
      .where(and(eq(schema.convTopics.orgId, actor.orgId), eq(schema.convTopics.slug, input.slug)))
      .limit(1);
    if (existing[0]) {
      throw new ConflictException(`conv_topic_slug_conflict: ${input.slug}`);
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

  async setSubject(input: {
    conversationId: string;
    subject: string | null;
  }): Promise<ConversationSummary> {
    const ctx = getCurrentContext();
    const [updated] = await ctx.db
      .update(schema.convConversations)
      .set({ subject: input.subject, updatedAt: new Date() })
      .where(eq(schema.convConversations.id, input.conversationId))
      .returning();
    if (!updated) {
      throw new NotFoundException(`conv_not_found: conversation ${input.conversationId}`);
    }
    await this.webhooks.emit({
      type: 'conversation.subject_changed',
      payload: { conversationId: input.conversationId, subject: input.subject },
    });
    return toConversationSummary(updated);
  }


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
    handover?: HandoverFilter;
    since?: string;
    limit?: number;
  }): Promise<ConversationSummary[]> {
    const page = await this.listConversationsPage({ ...input });
    return page.items;
  }

  private buildConversationListFilters(input: {
    status?: ConversationStatus;
    excludeStatuses?: readonly ConversationStatus[];
    assigneeUserId?: string;
    topicId?: string;
    endUserId?: string;
    needsHumanAttention?: boolean;
    handover?: HandoverFilter;
    since?: string;
    cursor?: { lastMessageAt: string | null; id: string; needsHumanAttention?: boolean };
  }): SQL[] {
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
    if (input.handover === 'active') {
      filters.push(eq(schema.convConversations.needsHumanAttention, true));
    } else if (input.handover === 'resolved') {
      filters.push(isNotNull(schema.convConversations.handoverResolvedAt));
    } else if (input.handover === 'never') {
      filters.push(eq(schema.convConversations.needsHumanAttention, false));
      filters.push(isNull(schema.convConversations.handoverResolvedAt));
    }
    if (input.since) {
      const since = new Date(input.since);
      if (Number.isNaN(since.getTime())) {
        throw new ConvInvalidError(`since must be an ISO 8601 timestamp, got "${input.since}"`);
      }
      filters.push(gte(schema.convConversations.lastMessageAt, since));
    }
    if (input.cursor) {
      const { lastMessageAt, id, needsHumanAttention } = input.cursor;
      const activityTail =
        lastMessageAt === null
          ? sql`((${schema.convConversations.lastMessageAt} IS NULL AND ${schema.convConversations.id} < ${id}) OR ${schema.convConversations.lastMessageAt} IS NOT NULL)`
          : sql`(${schema.convConversations.lastMessageAt} IS NOT NULL AND (${schema.convConversations.lastMessageAt}, ${schema.convConversations.id}) < (${new Date(lastMessageAt).toISOString()}::timestamptz, ${id}))`;
      if (needsHumanAttention === undefined) {
        filters.push(activityTail);
      } else {
        filters.push(
          sql`(${schema.convConversations.needsHumanAttention} < ${needsHumanAttention} OR (${schema.convConversations.needsHumanAttention} = ${needsHumanAttention} AND ${activityTail}))`,
        );
      }
    }
    return filters;
  }

  private lastInboundPreviewSql() {
    return sql<string | null>`(
          SELECT body FROM conv_messages
          WHERE conversation_id = "conv_conversations"."id"
            AND author_type = 'end_user'
            AND internal = false
          ORDER BY created_at DESC
          LIMIT 1
        )`;
  }

  async listConversationsPage(input: {
    status?: ConversationStatus;
    excludeStatuses?: readonly ConversationStatus[];
    assigneeUserId?: string;
    topicId?: string;
    endUserId?: string;
    needsHumanAttention?: boolean;
    handover?: HandoverFilter;
    since?: string;
    limit?: number;
    cursor?: { lastMessageAt: string | null; id: string; needsHumanAttention?: boolean };
  }): Promise<{
    items: ConversationSummary[];
    nextCursor: { lastMessageAt: string | null; id: string; needsHumanAttention: boolean } | null;
  }> {
    const ctx = getCurrentContext();
    const limit = clampLimit(input.limit, 50, 200);
    const filters = this.buildConversationListFilters(input);

    const rows = await ctx.db
      .select({
        conv: schema.convConversations,
        lastInboundPreview: this.lastInboundPreviewSql(),
      })
      .from(schema.convConversations)
      .where(filters.length === 0 ? undefined : and(...filters))
      .orderBy(
        desc(schema.convConversations.needsHumanAttention),
        desc(schema.convConversations.lastMessageAt),
        desc(schema.convConversations.id),
      )
      .limit(limit + 1);

    const items = rows
      .slice(0, limit)
      .map((row) => toConversationSummary(row.conv, undefined, row.lastInboundPreview));
    const last = items[items.length - 1];
    const nextCursor =
      rows.length > limit && last
        ? {
            lastMessageAt: last.lastMessageAt,
            id: last.id,
            needsHumanAttention: last.needsHumanAttention,
          }
        : null;
    return { items, nextCursor };
  }

  async listConversationQueuePage(input: {
    status?: ConversationStatus;
    excludeStatuses?: readonly ConversationStatus[];
    assigneeUserId?: string;
    topicId?: string;
    endUserId?: string;
    needsHumanAttention?: boolean;
    handover?: HandoverFilter;
    since?: string;
    limit?: number;
    cursor?: { lastMessageAt: string | null; id: string; needsHumanAttention?: boolean };
  }): Promise<{ items: ConversationQueueItem[]; nextCursor: { lastMessageAt: string | null; id: string } | null }> {
    const ctx = getCurrentContext();
    const limit = clampLimit(input.limit, 50, 200);
    const filters = this.buildConversationListFilters({
      ...input,
      cursor: input.cursor
        ? { lastMessageAt: input.cursor.lastMessageAt, id: input.cursor.id }
        : undefined,
    });

    const rows = await ctx.db
      .select({
        conv: schema.convConversations,
        lastInboundPreview: this.lastInboundPreviewSql(),
        channelType: schema.convChannels.type,
        contactName: schema.convContacts.name,
        contactEmail: schema.convContacts.email,
        endUserName: schema.endUsers.name,
        endUserEmail: schema.endUsers.email,
        topicName: schema.convTopics.name,
        topicSlug: schema.convTopics.slug,
        topicAgentMode: schema.convTopics.agentMode,
      })
      .from(schema.convConversations)
      .innerJoin(schema.convChannels, eq(schema.convChannels.id, schema.convConversations.channelId))
      .leftJoin(schema.convContacts, eq(schema.convContacts.id, schema.convConversations.contactId))
      .leftJoin(schema.endUsers, eq(schema.endUsers.id, schema.convConversations.endUserId))
      .leftJoin(schema.convTopics, eq(schema.convTopics.id, schema.convConversations.topicId))
      .where(filters.length === 0 ? undefined : and(...filters))
      .orderBy(
        desc(schema.convConversations.lastMessageAt),
        desc(schema.convConversations.id),
      )
      .limit(limit + 1);

    const page = rows.slice(0, limit);
    const pageIds = page.map((r) => r.conv.id);

    const claimByConversation = new Map<
      string,
      { holderId: string; holderName: string | null; expiresAt: string }
    >();
    const statsByConversation = new Map<string, { noteCount: number; pendingDrafts: number }>();
    if (pageIds.length > 0) {
      const claimRows = await ctx.db
        .select({
          entityId: schema.claims.entityId,
          userId: schema.claims.userId,
          holderName: schema.users.name,
          expiresAt: schema.claims.expiresAt,
          createdAt: schema.claims.createdAt,
        })
        .from(schema.claims)
        .leftJoin(schema.users, eq(schema.users.id, schema.claims.userId))
        .where(
          and(
            eq(schema.claims.entityType, 'conversation'),
            inArray(schema.claims.entityId, pageIds),
            sql`${schema.claims.expiresAt} > now()`,
          ),
        )
        .orderBy(desc(schema.claims.createdAt));
      for (const row of claimRows) {
        if (!row.userId || claimByConversation.has(row.entityId)) continue;
        claimByConversation.set(row.entityId, {
          holderId: row.userId,
          holderName: row.holderName,
          expiresAt: row.expiresAt.toISOString(),
        });
      }

      const statRows = await ctx.db
        .select({
          conversationId: schema.convMessages.conversationId,
          noteCount: sql<number>`COUNT(*) FILTER (
            WHERE ${schema.convMessages.authorType} IN ('user', 'agent')
              AND COALESCE(${schema.convMessages.metadata} ->> 'kind', '') NOT LIKE 'draft_reply%'
          )::int`,
          pendingDrafts: sql<number>`COUNT(*) FILTER (
            WHERE ${schema.convMessages.metadata} ->> 'kind' = 'draft_reply'
          )::int`,
        })
        .from(schema.convMessages)
        .where(
          and(
            inArray(schema.convMessages.conversationId, pageIds),
            eq(schema.convMessages.internal, true),
          ),
        )
        .groupBy(schema.convMessages.conversationId);
      for (const row of statRows) {
        statsByConversation.set(row.conversationId, {
          noteCount: row.noteCount,
          pendingDrafts: row.pendingDrafts,
        });
      }
    }

    const items = page.map((row): ConversationQueueItem => {
      const stats = statsByConversation.get(row.conv.id);
      const summary = toConversationSummary(row.conv, row.channelType, row.lastInboundPreview);
      const topicAgentMode = (row.topicAgentMode as AgentMode | null) ?? null;
      return {
        ...summary,
        agentMode: topicAgentMode ?? summary.agentMode,
        channelType: row.channelType,
        customerName: row.contactName ?? row.endUserName ?? null,
        customerEmail: row.contactEmail ?? row.endUserEmail ?? null,
        topicName: row.topicName,
        topicSlug: row.topicSlug,
        topicAgentMode,
        claim: claimByConversation.get(row.conv.id) ?? null,
        noteCount: stats?.noteCount ?? 0,
        hasPendingDraft: (stats?.pendingDrafts ?? 0) > 0,
      };
    });
    const last = items[items.length - 1];
    const nextCursor =
      rows.length > limit && last ? { lastMessageAt: last.lastMessageAt, id: last.id } : null;
    return { items, nextCursor };
  }

  async listConversationsAwaitingAgentReply(input?: {
    limit?: number;
    lookbackMinutes?: number;
  }): Promise<Array<{ id: string }>> {
    const ctx = getCurrentContext();
    const limit = clampLimit(input?.limit, 50, 200);
    const lookbackMinutes = input?.lookbackMinutes ?? AWAITING_REPLY_LOOKBACK_MINUTES;
    return ctx.db
      .select({ id: schema.convConversations.id })
      .from(schema.convConversations)
      .innerJoin(
        schema.convChannels,
        eq(schema.convChannels.id, schema.convConversations.channelId),
      )
      .where(
        and(
          eq(schema.convConversations.status, 'open'),
          eq(schema.convConversations.agentMode, 'auto'),
          isNull(schema.convConversations.assigneeUserId),
          isNotNull(schema.convConversations.endUserId),
          sql`${schema.convChannels.type} <> 'voice'`,
          sql`${schema.convConversations.lastMessageAt} > now() - make_interval(mins => ${lookbackMinutes})`,
          sql`(
            ${schema.convConversations.runnerLeaseExpiresAt} IS NULL
            OR ${schema.convConversations.runnerLeaseExpiresAt} < now()
          )`,
          sql`(
            SELECT author_type FROM conv_messages
            WHERE conversation_id = ${schema.convConversations.id}
              AND internal = false
            ORDER BY created_at DESC
            LIMIT 1
          ) = 'end_user'`,
        ),
      )
      .orderBy(desc(schema.convConversations.lastMessageAt))
      .limit(limit);
  }

  async listConversationsAwaitingUserReply(input?: {
    limit?: number;
    thresholdDays?: number;
  }): Promise<Array<{ id: string }>> {
    const ctx = getCurrentContext();
    const limit = clampLimit(input?.limit, 100, 500);
    const thresholdDays = input?.thresholdDays ?? AUTO_CLOSE_THRESHOLD_DAYS;
    return ctx.db
      .select({ id: schema.convConversations.id })
      .from(schema.convConversations)
      .innerJoin(
        schema.convChannels,
        eq(schema.convChannels.id, schema.convConversations.channelId),
      )
      .where(
        and(
          eq(schema.convConversations.status, 'open'),
          isNotNull(schema.convConversations.endUserId),
          eq(schema.convConversations.needsHumanAttention, false),
          sql`${schema.convChannels.type} <> 'voice'`,
          sql`${schema.convConversations.lastMessageAt} < now() - make_interval(days => ${thresholdDays})`,
          sql`(
            SELECT author_type FROM conv_messages
            WHERE conversation_id = ${schema.convConversations.id}
              AND internal = false
            ORDER BY created_at DESC
            LIMIT 1
          ) IN ('agent', 'user')`,
        ),
      )
      .orderBy(asc(schema.convConversations.lastMessageAt))
      .limit(limit);
  }

  async autoCloseInactive(input?: { thresholdDays?: number }): Promise<number> {
    const thresholdDays = input?.thresholdDays ?? AUTO_CLOSE_THRESHOLD_DAYS;
    const stale = await this.listConversationsAwaitingUserReply({ thresholdDays });
    for (const { id } of stale) {
      await this.changeStatus({ id, status: 'closed' });
    }
    return stale.length;
  }

  async getConversation(id: string): Promise<ConversationDetail> {
    const ctx = getCurrentContext();
    const conversations = await ctx.db
      .select({
        conv: schema.convConversations,
        channelType: schema.convChannels.type,
        assistantName: schema.assistants.name,
        endUserLocale: sql<string | null>`(${schema.endUsers.metadata}->>'locale')`.as('end_user_locale'),
        endUserEmail: schema.endUsers.email,
        endUserName: schema.endUsers.name,
        endUserPhone: schema.endUsers.phone,
        contactEmail: schema.convContacts.email,
        contactName: schema.convContacts.name,
        contactPhone: schema.convContacts.phone,
        topicAgentMode: schema.convTopics.agentMode,
      })
      .from(schema.convConversations)
      .innerJoin(schema.convChannels, eq(schema.convChannels.id, schema.convConversations.channelId))
      .leftJoin(schema.assistants, eq(schema.assistants.orgId, schema.convConversations.orgId))
      .leftJoin(schema.endUsers, eq(schema.endUsers.id, schema.convConversations.endUserId))
      .leftJoin(schema.convContacts, eq(schema.convContacts.id, schema.convConversations.contactId))
      .leftJoin(schema.convTopics, eq(schema.convTopics.id, schema.convConversations.topicId))
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

    const opens = ctx.db
      .select({
        messageId: schema.convMessageDeliveries.messageId,
        firstOpenedAt: sql<string | null>`MIN(${schema.convMessageDeliveries.firstOpenedAt})`.as(
          'first_opened_at',
        ),
        lastOpenedAt: sql<string | null>`MAX(${schema.convMessageDeliveries.lastOpenedAt})`.as(
          'last_opened_at',
        ),
        openCount: sql<number>`COALESCE(SUM(${schema.convMessageDeliveries.openCount}), 0)::int`.as(
          'open_count',
        ),
      })
      .from(schema.convMessageDeliveries)
      .innerJoin(
        schema.convMessages,
        eq(schema.convMessages.id, schema.convMessageDeliveries.messageId),
      )
      .where(eq(schema.convMessages.conversationId, id))
      .groupBy(schema.convMessageDeliveries.messageId)
      .as('opens');

    const rows = await ctx.db
      .select({
        msg: schema.convMessages,
        seenAt: reads.seenAt,
        firstOpenedAt: opens.firstOpenedAt,
        lastOpenedAt: opens.lastOpenedAt,
        openCount: opens.openCount,
      })
      .from(schema.convMessages)
      .leftJoin(reads, eq(reads.messageId, schema.convMessages.id))
      .leftJoin(opens, eq(opens.messageId, schema.convMessages.id))
      .where(eq(schema.convMessages.conversationId, id))
      .orderBy(asc(schema.convMessages.createdAt));

    const messages = rows.map((r) => r.msg);
    const authorNames = await this.loadAuthorNames(messages);
    const summary = toConversationSummary(row.conv, row.channelType);
    return {
      ...summary,
      agentMode: (row.topicAgentMode as AgentMode | null) ?? summary.agentMode,
      messages: rows.map((r) =>
        toMessageDto(r.msg, authorNames, r.seenAt, {
          firstOpenedAt: r.firstOpenedAt,
          lastOpenedAt: r.lastOpenedAt,
          openCount: r.openCount,
        }),
      ),
      assistantName: row.assistantName ?? null,
      endUserLocale: row.endUserLocale ?? null,
      contactEmail: row.contactEmail ?? row.endUserEmail ?? null,
      contactName: row.contactName ?? row.endUserName ?? null,
      contactPhone: row.contactPhone ?? row.endUserPhone ?? null,
    };
  }

  async getEmailOpenStats(input?: {
    channelId?: string;
    sinceDays?: number;
  }): Promise<EmailOpenStats> {
    const ctx = getCurrentContext();
    const sinceDays = clampLimit(input?.sinceDays, 30, 365);
    const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);

    if (input?.channelId) {
      const existing = await ctx.db
        .select({ id: schema.convChannels.id, type: schema.convChannels.type })
        .from(schema.convChannels)
        .where(eq(schema.convChannels.id, input.channelId))
        .limit(1);
      const channel = existing[0];
      if (!channel) {
        throw new NotFoundException(`conv_not_found: channel ${input.channelId}`);
      }
      if (channel.type !== 'email') {
        throw new BadRequestException(
          `conv_invalid: channel ${input.channelId} is a ${channel.type} channel; opens are tracked on email channels only`,
        );
      }
    }

    const rows = await ctx.db
      .select({
        channelId: schema.convChannels.id,
        channelName: schema.convChannels.name,
        trackOpens: sql<boolean>`COALESCE((${schema.convChannels.config}->'outbound'->>'trackOpens')::boolean, false)`,
        sent: sql<number>`COUNT(${schema.convMessageDeliveries.id})::int`,
        opened: sql<number>`COUNT(${schema.convMessageDeliveries.firstOpenedAt})::int`,
        totalOpens: sql<number>`COALESCE(SUM(${schema.convMessageDeliveries.openCount}), 0)::int`,
      })
      .from(schema.convChannels)
      .leftJoin(
        schema.convMessageDeliveries,
        and(
          eq(schema.convMessageDeliveries.channelId, schema.convChannels.id),
          eq(schema.convMessageDeliveries.status, 'sent'),
          gte(schema.convMessageDeliveries.sentAt, since),
        ),
      )
      .where(
        and(
          eq(schema.convChannels.type, 'email'),
          input?.channelId ? eq(schema.convChannels.id, input.channelId) : undefined,
        ),
      )
      .groupBy(schema.convChannels.id, schema.convChannels.name, schema.convChannels.config)
      .orderBy(asc(schema.convChannels.name));

    const channels = rows.map((r) => ({
      channelId: r.channelId,
      channelName: r.channelName,
      trackOpens: r.trackOpens,
      sent: r.sent,
      opened: r.opened,
      totalOpens: r.totalOpens,
      openRate: toOpenRate(r.opened, r.sent),
    }));

    const sent = channels.reduce((acc, c) => acc + c.sent, 0);
    const opened = channels.reduce((acc, c) => acc + c.opened, 0);
    return {
      since: since.toISOString(),
      sinceDays,
      channels,
      totals: {
        sent,
        opened,
        totalOpens: channels.reduce((acc, c) => acc + c.totalOpens, 0),
        openRate: toOpenRate(opened, sent),
      },
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
        defaultAgentMode: schema.convChannels.defaultAgentMode,
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
      agentMode: input.agentMode ?? (channelRows[0].defaultAgentMode as AgentMode),
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
      DELIVERABLE_CHANNEL_TYPES.includes(channelType) &&
      input.authorType !== 'end_user' &&
      input.authorType !== 'system'
    ) {
      await this.enqueueOutboundDelivery(firstMsg!.id, conv.id, conv.channelId);
    }

    if (input.authorType === 'end_user' && !input.topicId) {
      await this.enqueueTopicAndTitleJob(conv.id, channelType);
    }

    return this.getConversation(conv.id);
  }

  private async enqueueTopicAndTitleJob(conversationId: string, channelType: string): Promise<void> {
    const ctx = getCurrentContext();
    if (!ctx.actor) return;
    try {
      await ctx.db.execute(sql`SELECT set_config('app.bypass_rls', 'on', true)`);
      await this.curatorJobs.enqueue(buildSetTopicAndTitleJob({ conversationId, channelType }));
    } catch (err) {
      this.logger.warn(
        `failed to enqueue set-topic-and-title for ${conversationId}: ${(err as Error).message}`,
      );
    } finally {
      await applyTenancyGUCs(ctx.db, ctx.actor);
    }
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
    components?: MessageComponent[];
    fromDraftId?: string;
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

    if (
      input.authorType === 'agent' &&
      !input.internal &&
      (await this.claims.isHeldByOther(input.conversationId))
    ) {
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

    const attachComponents =
      !!input.components?.length &&
      !input.internal &&
      (input.authorType === 'agent' || input.authorType === 'user');

    const approvedDraft = input.fromDraftId
      ? await this.loadApprovedDraft(input.conversationId, input.fromDraftId, input.body)
      : null;

    const isNote =
      (input.internal ?? false) &&
      !input.fromDraftId &&
      (input.authorType === 'user' || input.authorType === 'agent');

    const metadata = {
      ...(attachComponents ? { components: input.components } : {}),
      ...(approvedDraft ? { approvedDraft: approvedDraft.stamp } : {}),
      ...(isNote ? { kind: 'internal_note' } : {}),
    };

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
        ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
      })
      .returning();

    if (approvedDraft) {
      await ctx.db
        .update(schema.convMessages)
        .set({
          metadata: sql`${schema.convMessages.metadata} || jsonb_build_object(
            'kind', 'draft_reply_sent',
            'sentMessageId', ${row!.id}::text
          )`,
        })
        .where(eq(schema.convMessages.id, approvedDraft.stamp.draftMessageId));
    }

    if (!row!.internal && (input.authorType === 'agent' || input.authorType === 'user')) {
      await this.supersedePendingDrafts(input.conversationId, row!.id);
    }

    const clearAttention =
      (input.authorType === 'user' || input.authorType === 'agent') &&
      !input.internal &&
      !input.preserveAttention;
    await ctx.db
      .update(schema.convConversations)
      .set({
        ...(input.internal ? {} : { lastMessageAt: new Date() }),
        updatedAt: new Date(),
        ...(clearAttention
          ? {
              needsHumanAttention: false,
              needsHumanAttentionAt: null,
              handoverResolvedAt: stampHandoverResolved(),
            }
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

    if (isNote) {
      await this.webhooks.emit({
        type: 'conversation.note_added',
        payload: {
          conversationId: input.conversationId,
          messageId: row!.id,
          authorType: input.authorType,
        },
      });
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
        const [campaign] = await ctx.db
          .select({ autoDraftReplies: schema.outreachCampaigns.autoDraftReplies })
          .from(schema.outreachCampaigns)
          .where(eq(schema.outreachCampaigns.id, conv.outreachCampaignId))
          .limit(1);
        if (campaign?.autoDraftReplies) {
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
        if (!approvedDraft || approvedDraft.stamp.edited) {
          await this.curatorJobs.enqueue({
            jobUri: 'skill://kb/review-content',
            userPrompt: approvedDraft
              ? buildDeltaCurationPrompt({
                  conversationId: input.conversationId,
                  draftMessageId: approvedDraft.stamp.draftMessageId,
                  sentMessageId: row!.id,
                  retrievedDocumentIds: approvedDraft.stamp.retrievedDocumentIds,
                })
              : buildGapCurationPrompt(input.conversationId),
            sourceEventType: 'conversation.handover_resolved',
            sourceEventPayload: {
              conversationId: input.conversationId,
              messageId: row!.id,
              authorType: input.authorType,
              ...(approvedDraft
                ? {
                    draftMessageId: approvedDraft.stamp.draftMessageId,
                    retrievedDocumentIds: approvedDraft.stamp.retrievedDocumentIds,
                  }
                : {}),
            },
            dedupeKey: `kb-curation:msg:${row!.id}`,
          });
        }
      }

      if (
        DELIVERABLE_CHANNEL_TYPES.includes(conv.channelType) &&
        input.authorType !== 'end_user' &&
        input.authorType !== 'system'
      ) {
        await this.enqueueOutboundDelivery(row!.id, conv.id, conv.channelId);
      }
    }
    return toMessageDto(row!);
  }

  private async enqueueOutboundDelivery(
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
      isOverAggressiveCut(originalBody, newBody) &&
      !removedTailIsSignature(originalBody, newBody, input.signatureText)
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
    await this.webhooks.emit({
      type: 'conversation.message.body_revised',
      payload: {
        conversationId: row.conversationId,
        messageId: input.messageId,
        authorType: row.authorType,
        internal: row.internal,
        reason: 'signature_stripped',
      },
    });
    return { updated: true };
  }

  async assignConversation(input: {
    id: string;
    assigneeUserId: string | null;
  }): Promise<ConversationSummary> {
    const ctx = getCurrentContext();
    const actor = ctx.actor!;
    if (input.assigneeUserId !== null) {
      const member = await ctx.db
        .select({ userId: schema.orgMembers.userId })
        .from(schema.orgMembers)
        .where(
          and(
            eq(schema.orgMembers.orgId, actor.orgId),
            eq(schema.orgMembers.userId, input.assigneeUserId),
          ),
        )
        .limit(1);
      if (!member[0]) {
        throw new BadRequestException(
          `conv_invalid: user ${input.assigneeUserId} is not a member of this org`,
        );
      }
    }
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
          ? {
              needsHumanAttention: false,
              needsHumanAttentionAt: null,
              handoverResolvedAt: stampHandoverResolved(),
            }
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
          `from end-user messages, dedupe via crm_lookup_contact, then either create ` +
          `(crm_create_contact) or backfill empty fields (crm_update_contact). ` +
          `Skip silently if nothing identifying was volunteered.`,
        sourceEventType: 'conversation.status_changed',
        sourceEventPayload: { conversationId: input.id, status: 'closed' },
        dedupeKey: `crm-contact-extract:conv:${input.id}`,
      });
    }
    return toConversationSummary(result[0]);
  }

  async wakeDueSnoozedConversations(): Promise<number> {
    const ctx = getCurrentContext();
    const now = new Date();
    const woken = await ctx.db
      .update(schema.convConversations)
      .set({
        status: 'open',
        snoozeUntil: null,
        needsHumanAttention: true,
        needsHumanAttentionAt: now,
        handoverResolvedAt: null,
        updatedAt: now,
      })
      .where(
        and(
          eq(schema.convConversations.status, 'snoozed'),
          isNotNull(schema.convConversations.snoozeUntil),
          lte(schema.convConversations.snoozeUntil, now),
        ),
      )
      .returning({ id: schema.convConversations.id });
    for (const row of woken) {
      await this.webhooks.emit({
        type: 'conversation.status_changed',
        payload: { conversationId: row.id, status: 'open' },
      });
    }
    return woken.length;
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
        authorType: 'agent',
        authorId: actor.id,
        body,
        internal: true,
        metadata: { kind: 'internal_note' },
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
        handoverResolvedAt: null,
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

  private async loadApprovedDraft(
    conversationId: string,
    draftId: string,
    sentBody: string,
  ): Promise<{ stamp: ApprovedDraftStamp }> {
    const ctx = getCurrentContext();
    const [draft] = await ctx.db
      .select({ id: schema.convMessages.id, body: schema.convMessages.body, metadata: schema.convMessages.metadata })
      .from(schema.convMessages)
      .where(
        and(
          eq(schema.convMessages.id, draftId),
          eq(schema.convMessages.conversationId, conversationId),
          eq(schema.convMessages.internal, true),
          sql`${schema.convMessages.metadata} ->> 'kind' = 'draft_reply'`,
        ),
      )
      .limit(1);
    if (!draft) {
      throw new BadRequestException({
        message: `conv_invalid: ${draftId} is not a pending draft on conversation ${conversationId}`,
        code: 'conv_invalid',
      });
    }
    const retrieved = draft.metadata['retrievedDocumentIds'];
    return {
      stamp: {
        draftMessageId: draft.id,
        draftBody: draft.body,
        edited: !sameAfterNormalizing(draft.body, sentBody),
        retrievedDocumentIds: Array.isArray(retrieved)
          ? retrieved.filter((v): v is string => typeof v === 'string')
          : [],
      },
    };
  }

  async setDraftReply(input: {
    conversationId: string;
    body: string;
    retrievedDocumentIds?: string[];
    rationale?: string;
    toolNames?: string[];
  }): Promise<{ id: string }> {
    const ctx = getCurrentContext();
    const actor = ctx.actor!;
    const [conv] = await ctx.db
      .select({ id: schema.convConversations.id })
      .from(schema.convConversations)
      .where(eq(schema.convConversations.id, input.conversationId))
      .limit(1);
    if (!conv) {
      throw new NotFoundException(`conv_not_found: conversation ${input.conversationId}`);
    }
    const [row] = await ctx.db
      .insert(schema.convMessages)
      .values({
        orgId: actor.orgId,
        conversationId: input.conversationId,
        authorType: 'agent',
        authorId: actor.id,
        body: input.body,
        internal: true,
        metadata: {
          kind: 'draft_reply',
          ...(input.retrievedDocumentIds?.length
            ? { retrievedDocumentIds: input.retrievedDocumentIds }
            : {}),
          ...(input.rationale ? { rationale: input.rationale } : {}),
          ...(input.toolNames?.length ? { toolNames: input.toolNames } : {}),
        },
      })
      .returning({ id: schema.convMessages.id });
    await this.supersedePendingDrafts(input.conversationId, row!.id, row!.id);
    await this.webhooks.emit({
      type: 'conversation.draft_ready',
      payload: { conversationId: input.conversationId, messageId: row!.id },
    });
    return { id: row!.id };
  }

  private async supersedePendingDrafts(
    conversationId: string,
    supersededByMessageId: string,
    excludeMessageId?: string,
  ): Promise<void> {
    const ctx = getCurrentContext();
    await ctx.db
      .update(schema.convMessages)
      .set({
        metadata: sql`${schema.convMessages.metadata} || jsonb_build_object(
          'kind', 'draft_reply_superseded',
          'supersededByMessageId', ${supersededByMessageId}::text
        )`,
      })
      .where(
        and(
          eq(schema.convMessages.conversationId, conversationId),
          eq(schema.convMessages.authorType, 'agent'),
          eq(schema.convMessages.internal, true),
          sql`${schema.convMessages.metadata} ->> 'kind' = 'draft_reply'`,
          ...(excludeMessageId ? [ne(schema.convMessages.id, excludeMessageId)] : []),
        ),
      );
  }

  async clearDraftReply(conversationId: string): Promise<{ cleared: number }> {
    const ctx = getCurrentContext();
    const actor = ctx.actor;
    const [latest] = await ctx.db
      .select({ id: schema.convMessages.id })
      .from(schema.convMessages)
      .where(
        and(
          eq(schema.convMessages.conversationId, conversationId),
          eq(schema.convMessages.authorType, 'agent'),
          eq(schema.convMessages.internal, true),
          sql`${schema.convMessages.metadata} ->> 'kind' = 'draft_reply'`,
        ),
      )
      .orderBy(desc(schema.convMessages.createdAt))
      .limit(1);
    if (!latest) return { cleared: 0 };
    const rejectedByUserId =
      actor?.type === 'user' ? (actor.userId ?? actor.id) : null;
    await ctx.db
      .update(schema.convMessages)
      .set({
        metadata: sql`${schema.convMessages.metadata} || jsonb_build_object(
          'kind', 'draft_reply_rejected',
          'rejectedAt', to_jsonb(now()),
          'rejectedByUserId', ${rejectedByUserId}::text
        )`,
      })
      .where(eq(schema.convMessages.id, latest.id));
    return { cleared: 1 };
  }

  async requestDraft(conversationId: string): Promise<{ requested: boolean }> {
    const ctx = getCurrentContext();
    const actor = ctx.actor!;
    const convRows = await ctx.db
      .select({
        id: schema.convConversations.id,
        status: schema.convConversations.status,
        endUserId: schema.convConversations.endUserId,
        agentMode: schema.convConversations.agentMode,
        topicAgentMode: schema.convTopics.agentMode,
        channelType: schema.convChannels.type,
      })
      .from(schema.convConversations)
      .innerJoin(schema.convChannels, eq(schema.convChannels.id, schema.convConversations.channelId))
      .leftJoin(schema.convTopics, eq(schema.convTopics.id, schema.convConversations.topicId))
      .where(eq(schema.convConversations.id, conversationId))
      .limit(1);
    const conv = convRows[0];
    if (!conv) throw new NotFoundException(`conv_not_found: conversation ${conversationId}`);
    if (conv.status !== 'open') {
      throw new BadRequestException({
        message: `conv_draft_request_invalid: conversation ${conversationId} is ${conv.status}; drafts can only be requested on open conversations`,
        code: 'conv_draft_request_invalid',
      });
    }
    if (conv.channelType === 'voice') {
      throw new BadRequestException({
        message: `conv_draft_request_invalid: conversation ${conversationId} is a voice conversation; the voice vendor owns its replies`,
        code: 'conv_draft_request_invalid',
      });
    }
    if (!conv.endUserId) {
      throw new BadRequestException({
        message: `conv_draft_request_invalid: conversation ${conversationId} has no end-user to reply to`,
        code: 'conv_draft_request_invalid',
      });
    }
    if ((conv.topicAgentMode ?? conv.agentMode) === 'off') {
      throw new BadRequestException({
        message: `conv_draft_request_invalid: the agent is turned off for conversation ${conversationId}`,
        code: 'conv_draft_request_invalid',
      });
    }
    const [pending] = await ctx.db
      .select({ id: schema.convMessages.id })
      .from(schema.convMessages)
      .where(
        and(
          eq(schema.convMessages.conversationId, conversationId),
          eq(schema.convMessages.internal, true),
          sql`${schema.convMessages.metadata} ->> 'kind' = 'draft_reply'`,
        ),
      )
      .limit(1);
    if (pending) {
      throw new ConflictException({
        message: `conv_draft_pending: conversation ${conversationId} already has a draft pending review`,
        code: 'conv_draft_pending',
      });
    }
    await this.webhooks.emit({
      type: 'conversation.draft_requested',
      payload: {
        conversationId,
        requestedByUserId: actor.type === 'user' ? (actor.userId ?? actor.id) : null,
      },
    });
    return { requested: true };
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


  async exportConv(): Promise<ConvExportData> {
    const ctx = getCurrentContext();
    const [channels, conversations, messages] = await Promise.all([
      ctx.db
        .select()
        .from(schema.convChannels)
        .where(isNull(schema.convChannels.archivedAt))
        .orderBy(asc(schema.convChannels.createdAt)),
      ctx.db
        .select({
          conv: schema.convConversations,
          topicSlug: schema.convTopics.slug,
        })
        .from(schema.convConversations)
        .leftJoin(schema.convTopics, eq(schema.convTopics.id, schema.convConversations.topicId))
        .orderBy(asc(schema.convConversations.createdAt)),
      ctx.db
        .select()
        .from(schema.convMessages)
        .orderBy(asc(schema.convMessages.createdAt)),
    ]);
    return {
      channels: channels.map((c) => ({
        id: c.id,
        type: c.type as ChannelType,
        vendor: c.vendor,
        name: c.name,
        active: c.active,
      })),
      conversations: conversations.map((r) => ({
        id: r.conv.id,
        channelId: r.conv.channelId,
        subject: r.conv.subject,
        status: r.conv.status as ConversationStatus,
        topicSlug: r.topicSlug ?? null,
        agentMode: r.conv.agentMode as AgentMode,
      })),
      messages: messages.map((m) => ({
        id: m.id,
        conversationId: m.conversationId,
        authorType: m.authorType as ConvMessageExport['authorType'],
        authorId: m.authorId,
        body: m.body,
        internal: m.internal,
        inReplyToId: m.inReplyToId,
      })),
    };
  }

  async importConv(data: ConvExportData, priorIdMap: IdMap = {}): Promise<ImportResult> {
    const ctx = getCurrentContext();
    const actor = ctx.actor!;
    const result = newImportResult();
    result.idMap = { ...priorIdMap };

    for (const channel of data.channels) {
      const existing = await this.findChannelForImport(channel.type, channel.vendor, channel.name);
      if (existing) {
        result.idMap[channel.id] = existing.id;
        result.skipped++;
      } else {
        const [row] = await ctx.db
          .insert(schema.convChannels)
          .values({
            orgId: actor.orgId,
            type: channel.type,
            vendor: channel.vendor,
            name: channel.name,
            active: channel.active,
            config: {},
          })
          .returning();
        result.idMap[channel.id] = row!.id;
        result.created++;
        result.warnings.push(
          `channel "${channel.name}" imported without credentials — re-enter them on this server`,
        );
      }
    }

    const topicIdBySlug = await this.loadTopicIdsBySlug();

    for (const conv of data.conversations) {
      const targetChannelId = resolveId(result.idMap, conv.channelId);
      if (!targetChannelId) {
        result.warnings.push(
          `conversation ${conv.id} skipped: source channel ${conv.channelId} was not part of this import`,
        );
        result.skipped++;
        continue;
      }
      if (result.idMap[conv.id]) {
        result.skipped++;
        continue;
      }
      const created = await this.insertConversationWithRetry({
        orgId: actor.orgId,
        channelId: targetChannelId,
        contactId: null,
        endUserId: null,
        topicId: conv.topicSlug ? topicIdBySlug.get(conv.topicSlug) ?? null : null,
        subject: conv.subject,
        agentMode: conv.agentMode,
      });
      if (conv.status !== 'open') {
        await ctx.db
          .update(schema.convConversations)
          .set({ status: conv.status, updatedAt: new Date() })
          .where(eq(schema.convConversations.id, created.id));
      }
      result.idMap[conv.id] = created.id;
      result.created++;
    }

    const lastMessageAtByConv = new Map<string, Date>();
    for (const msg of data.messages) {
      const targetConversationId = resolveId(result.idMap, msg.conversationId);
      if (!targetConversationId) {
        result.warnings.push(
          `message ${msg.id} skipped: source conversation ${msg.conversationId} was not part of this import`,
        );
        result.skipped++;
        continue;
      }
      if (result.idMap[msg.id]) {
        result.skipped++;
        continue;
      }
      let internal = msg.internal;
      if (msg.authorType === 'system' && !internal) {
        internal = true;
        result.warnings.push(
          `message ${msg.id} imported as internal: system messages are staff-only notes and cannot be public`,
        );
      }
      const [row] = await ctx.db
        .insert(schema.convMessages)
        .values({
          orgId: actor.orgId,
          conversationId: targetConversationId,
          authorType: msg.authorType,
          authorId: msg.authorId,
          body: msg.body,
          internal,
          inReplyToId: resolveId(result.idMap, msg.inReplyToId) ?? null,
        })
        .returning();
      result.idMap[msg.id] = row!.id;
      result.created++;
      lastMessageAtByConv.set(targetConversationId, row!.createdAt);
    }

    for (const [conversationId, lastMessageAt] of lastMessageAtByConv) {
      await ctx.db
        .update(schema.convConversations)
        .set({ lastMessageAt })
        .where(eq(schema.convConversations.id, conversationId));
    }

    result.warnings.push(
      'messages have no natural key — re-running this import creates duplicate messages for any conversation not already in the supplied idMap',
    );
    return result;
  }

  private async findChannelForImport(
    type: ChannelType,
    vendor: string,
    name: string,
  ): Promise<{ id: string } | null> {
    const ctx = getCurrentContext();
    const rows = await ctx.db
      .select({ id: schema.convChannels.id })
      .from(schema.convChannels)
      .where(
        and(
          eq(schema.convChannels.type, type),
          eq(schema.convChannels.vendor, vendor),
          eq(schema.convChannels.name, name),
          isNull(schema.convChannels.archivedAt),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  private async loadTopicIdsBySlug(): Promise<Map<string, string>> {
    const ctx = getCurrentContext();
    const rows = await ctx.db
      .select({ id: schema.convTopics.id, slug: schema.convTopics.slug })
      .from(schema.convTopics);
    const out = new Map<string, string>();
    for (const r of rows) out.set(r.slug, r.id);
    return out;
  }

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


function toChannelDto(row: typeof schema.convChannels.$inferSelect): ChannelDto {
  return {
    id: row.id,
    type: row.type as ChannelType,
    vendor: row.vendor,
    name: row.name,
    active: row.active,
    config: publicChannelConfig(row.config),
    defaultAgentMode: row.defaultAgentMode as AgentMode,
    needsCredentials: channelNeedsCredentials(row),
    createdAt: row.createdAt.toISOString(),
  };
}

function channelNeedsCredentials(row: typeof schema.convChannels.$inferSelect): boolean {
  if (readPendingSetup(row.config)) return true;
  if (row.type !== 'email') return false;
  const config = row.config as {
    outbound?: { provider?: string; encryptedPassword?: string };
    inbound?: { encryptedPassword?: string };
  };
  const smtpMissing = config.outbound?.provider === 'smtp' && !config.outbound.encryptedPassword;
  const imapMissing = !!config.inbound && !config.inbound.encryptedPassword;
  return smtpMissing || imapMissing;
}

function toTopicDto(row: typeof schema.convTopics.$inferSelect): TopicDto {
  return { id: row.id, name: row.name, slug: row.slug, color: row.color };
}

function stampHandoverResolved(): SQL {
  return sql`CASE WHEN ${schema.convConversations.needsHumanAttention} THEN now()
                  ELSE ${schema.convConversations.handoverResolvedAt} END`;
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
    handoverResolvedAt: row.handoverResolvedAt?.toISOString() ?? null,
    agentMode: row.agentMode as AgentMode,
    outreachCampaignId: row.outreachCampaignId,
    voiceActive: row.metadata.voiceActive === true,
    updatedAt: row.updatedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}

interface MessageOpens {
  firstOpenedAt: Date | string | null;
  lastOpenedAt: Date | string | null;
  openCount: number | null;
}

function toMessageDto(
  row: typeof schema.convMessages.$inferSelect,
  authorNames: Map<string, string> = new Map(),
  seenAt: Date | string | null = null,
  opens: MessageOpens | null = null,
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
    firstOpenedAt: toIsoString(opens?.firstOpenedAt ?? null),
    lastOpenedAt: toIsoString(opens?.lastOpenedAt ?? null),
    openCount: opens?.openCount ?? null,
  };
}


function toOpenRate(opened: number, sent: number): number | null {
  if (sent <= 0) return null;
  return Math.round((opened / sent) * 1000) / 1000;
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

const MAX_SIGNATURE_CUT_RATIO = 0.5;
const MIN_SIGNATURE_CONTACT_HINTS = 2;

function isOverAggressiveCut(original: string, next: string): boolean {
  return (
    original.length > 0 &&
    next.length < original.length * MAX_SIGNATURE_CUT_RATIO &&
    !looksLikeCompleteProse(next)
  );
}

function removedTailIsSignature(
  original: string,
  next: string,
  signature: string | null | undefined,
): boolean {
  if (signature == null) return false;
  return (
    isTrailingSignatureSplit(original, next, signature) &&
    countSignatureHints(signature) >= MIN_SIGNATURE_CONTACT_HINTS
  );
}
