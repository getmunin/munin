import { Inject, Injectable, Logger } from '@nestjs/common';
import { schema, type Db, type Tx } from '@getmunin/db';
import { and, desc, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import { parseEnvInt } from '@getmunin/core';
import { DB } from '../../../common/db/db.module.ts';
import {
  CONVERSATION_KEY_METADATA_FIELD,
  type ChannelAdapter,
  type ChannelRow,
  type InboundBatch,
  type InboundMode,
  type PollTickResult,
  type SendContext,
  type SendResult,
} from '../channels/adapter.ts';
import { ChannelIngestService } from '../channels/channel-ingest.service.ts';
import {
  ChannelSendDeferredError,
  ChannelSendTerminalError,
} from '../channels/send-outcome.ts';
import {
  RedditApiError,
  RedditClientService,
  stripFullnamePrefix,
  type RedditCredentials,
  type RedditInboxItem,
} from './reddit-client.service.ts';
import {
  REDDIT_CHANNEL_VENDOR,
  RedditService,
  jsonbToStored,
  type StoredRedditChannelConfig,
} from './reddit.service.ts';

const POLL_INTERVAL_MS = parseEnvInt({ name: 'MUNIN_REDDIT_INBOUND_POLL_MS', default: 300_000 });
const ENGAGEMENT_REFRESH_MS = parseEnvInt({
  name: 'MUNIN_REDDIT_ENGAGEMENT_REFRESH_MS',
  default: 3_600_000,
});
const UNREAD_PAGE_SIZE = 50;
const MAX_ENGAGEMENT_FULLNAMES = 300;
const INFO_BATCH_SIZE = 100;
const DEFAULT_DEFERRAL_SECONDS = 600;
const MAX_DM_SUBJECT_LENGTH = 100;

export const REDDIT_THREAD_KEY_PREFIX = 'reddit:thread:';

interface RedditCursor {
  lastSeenFullname?: string;
  lastSeenCreatedUtc?: number;
  lastEngagementRefreshAt?: string;
}

@Injectable()
export class RedditAdapter implements ChannelAdapter {
  readonly kind = 'chat' as const;
  readonly vendors = [REDDIT_CHANNEL_VENDOR] as const;
  readonly outboundDelivery = 'queued' as const;

  private readonly logger = new Logger(RedditAdapter.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(RedditClientService) private readonly client: RedditClientService,
    @Inject(RedditService) private readonly reddit: RedditService,
    @Inject(ChannelIngestService) private readonly ingest: ChannelIngestService,
  ) {}

  readonly inbound: InboundMode = {
    mode: 'poll',
    intervalMs: POLL_INTERVAL_MS,
    tick: (channel) => this.pollOne(channel),
  };

  async send(ctx: SendContext): Promise<SendResult> {
    const config = jsonbToStored(ctx.channel.config);
    const credentials = await this.reddit.loadCredentials(ctx.channel.id, config);
    try {
      if (isThreadConversation(ctx.conversation.metadata)) {
        return await this.sendComment(ctx, credentials);
      }
      return await this.sendDm(ctx, credentials, config);
    } catch (err) {
      throw translateSendError(err);
    }
  }

  private async sendComment(
    ctx: SendContext,
    credentials: RedditCredentials,
  ): Promise<SendResult> {
    const parentFullname = await this.resolveParentFullname(ctx);
    if (!parentFullname) {
      throw new ChannelSendTerminalError(
        'reddit_no_parent: the conversation carries no Reddit comment or post to reply to',
      );
    }
    const res = await this.client.postComment(credentials, {
      parentFullname,
      text: ctx.message.body,
    });
    if (!res.data.fullname) {
      this.logger.warn(
        `reddit comment on ${parentFullname} was accepted but returned no fullname; inbound replies will thread on the conversation key only`,
      );
    }
    return { providerMessageId: res.data.fullname, rawResponse: res.data };
  }

  private async sendDm(
    ctx: SendContext,
    credentials: RedditCredentials,
    config: StoredRedditChannelConfig,
  ): Promise<SendResult> {
    const to = ctx.contact?.handle?.trim();
    if (!to) {
      throw new ChannelSendTerminalError(
        'reddit_no_recipient: the conversation contact has no Reddit username',
      );
    }
    const res = await this.client.sendDm(credentials, {
      to,
      subject: resolveDmSubject(ctx, config.username),
      text: ctx.message.body,
    });
    return { providerMessageId: res.data.fullname, rawResponse: res.data };
  }

  private async resolveParentFullname(ctx: SendContext): Promise<string | null> {
    const explicit = readFullname(ctx.message.metadata, 'redditParentFullname');
    if (explicit) return explicit;

    const rows = await this.db
      .select({ metadata: schema.convMessages.metadata })
      .from(schema.convMessages)
      .where(
        and(
          eq(schema.convMessages.conversationId, ctx.conversation.id),
          eq(schema.convMessages.authorType, 'end_user'),
        ),
      )
      .orderBy(desc(schema.convMessages.createdAt))
      .limit(1);
    const latestInbound = readFullname(rows[0]?.metadata ?? {}, 'providerMessageId');
    if (latestInbound) return latestInbound;

    return readFullname(ctx.conversation.metadata, 'redditParentFullname');
  }

  private async pollOne(channel: ChannelRow): Promise<PollTickResult> {
    let config: StoredRedditChannelConfig;
    try {
      config = jsonbToStored(channel.config);
    } catch {
      return { messagesIngested: 0, lastError: 'reddit_config_unreadable' };
    }

    let state: { cursor: RedditCursor; lastPolledAt: Date | null };
    try {
      state = await this.readState(channel.id);
    } catch (err) {
      this.logger.warn(`reddit cursor read failed channel=${channel.id}: ${errorMessage(err)}`);
      return { messagesIngested: 0, lastError: `reddit_cursor_read_failed: ${errorMessage(err)}` };
    }
    if (
      state.lastPolledAt &&
      Date.now() - state.lastPolledAt.getTime() < POLL_INTERVAL_MS
    ) {
      return { messagesIngested: 0 };
    }

    let credentials: RedditCredentials;
    try {
      credentials = await this.reddit.loadCredentials(channel.id, config);
    } catch (err) {
      await this.writeCursor(channel.id, state.cursor);
      return { messagesIngested: 0, lastError: errorMessage(err) };
    }

    let items: RedditInboxItem[];
    try {
      const res = await this.client.listUnread(credentials, { limit: UNREAD_PAGE_SIZE });
      items = res.data;
    } catch (err) {
      await this.writeCursor(channel.id, state.cursor);
      return { messagesIngested: 0, lastError: errorMessage(err) };
    }

    const fresh = items.filter((item) => isAfterCursor(item, state.cursor));
    let ingested = 0;
    let lastError: string | null = null;

    if (fresh.length > 0) {
      const batch: InboundBatch = { messages: fresh.map(toInboundMessage) };
      const result = await this.ingest.ingest(channel, batch);
      ingested = result.ingested;
      try {
        await this.client.markRead(
          credentials,
          fresh.map((item) => item.fullname),
        );
      } catch (err) {
        lastError = `reddit_mark_read_failed: ${errorMessage(err)}`;
        this.logger.warn(`${lastError} channel=${channel.id}`);
      }
    }

    const cursor = advanceCursor(state.cursor, fresh);
    const engagementError = await this.maybeRefreshEngagement(channel, credentials, cursor).catch(
      (err: unknown) => `reddit_engagement_refresh_failed: ${errorMessage(err)}`,
    );
    if (engagementError && !lastError) lastError = engagementError;

    try {
      await this.writeCursor(channel.id, cursor);
    } catch (err) {
      this.logger.warn(`reddit cursor write failed channel=${channel.id}: ${errorMessage(err)}`);
      if (!lastError) lastError = `reddit_cursor_write_failed: ${errorMessage(err)}`;
    }
    return { messagesIngested: ingested, lastError };
  }

  private async maybeRefreshEngagement(
    channel: ChannelRow,
    credentials: RedditCredentials,
    cursor: RedditCursor,
  ): Promise<string | null> {
    const last = cursor.lastEngagementRefreshAt
      ? Date.parse(cursor.lastEngagementRefreshAt)
      : Number.NaN;
    if (Number.isFinite(last) && Date.now() - last < ENGAGEMENT_REFRESH_MS) return null;

    const posted = await this.loadPostedComments(channel.id);
    cursor.lastEngagementRefreshAt = new Date().toISOString();
    if (posted.size === 0) return null;

    const fullnames = [...posted.keys()];
    const scores = new Map<string, { score: number | null; removed: boolean }>();
    try {
      for (let i = 0; i < fullnames.length; i += INFO_BATCH_SIZE) {
        const chunk = fullnames.slice(i, i + INFO_BATCH_SIZE);
        const res = await this.client.listThingStats(credentials, chunk);
        for (const stat of res.data) {
          scores.set(stat.fullname, { score: stat.score, removed: stat.removed });
        }
      }
    } catch (err) {
      return `reddit_engagement_refresh_failed: ${errorMessage(err)}`;
    }

    const replyCounts = await this.countRepliesByParent([
      ...new Set([...posted.values()].map((v) => v.conversationId)),
    ]);
    const byConversation = new Map<
      string,
      Array<{ fullname: string; score: number | null; removed: boolean; replyCount: number }>
    >();
    for (const [fullname, { conversationId }] of posted) {
      const stat = scores.get(fullname);
      if (!stat) continue;
      const list = byConversation.get(conversationId) ?? [];
      list.push({
        fullname,
        score: stat.score,
        removed: stat.removed,
        replyCount: replyCounts.get(fullname) ?? 0,
      });
      byConversation.set(conversationId, list);
    }

    if (byConversation.size === 0) return null;
    const refreshedAt = new Date().toISOString();
    await this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.bypass_rls', 'on', true)`);
      for (const [conversationId, comments] of byConversation) {
        const patch = JSON.stringify({ redditEngagement: { refreshedAt, comments } });
        await tx
          .update(schema.convConversations)
          .set({
            metadata: sql`coalesce(${schema.convConversations.metadata}, '{}'::jsonb) || ${patch}::jsonb`,
            updatedAt: new Date(),
          })
          .where(eq(schema.convConversations.id, conversationId));
      }
    });
    return null;
  }

  private async loadPostedComments(
    channelId: string,
  ): Promise<Map<string, { conversationId: string }>> {
    const rows = await this.db
      .select({
        conversationId: schema.convConversations.id,
        fullname: schema.convMessageDeliveries.messageIdHeader,
      })
      .from(schema.convMessageDeliveries)
      .innerJoin(
        schema.convMessages,
        eq(schema.convMessages.id, schema.convMessageDeliveries.messageId),
      )
      .innerJoin(
        schema.convConversations,
        eq(schema.convConversations.id, schema.convMessages.conversationId),
      )
      .where(
        and(
          eq(schema.convConversations.channelId, channelId),
          eq(schema.convMessageDeliveries.status, 'sent'),
          isNotNull(schema.convMessageDeliveries.messageIdHeader),
          sql`${schema.convMessageDeliveries.messageIdHeader} LIKE 't1\\_%'`,
          sql`${schema.convConversations.metadata}->>'conversationKey' LIKE ${`${REDDIT_THREAD_KEY_PREFIX}%`}`,
          inArray(schema.convConversations.status, ['open', 'snoozed']),
        ),
      )
      .orderBy(desc(schema.convMessageDeliveries.sentAt))
      .limit(MAX_ENGAGEMENT_FULLNAMES);
    const out = new Map<string, { conversationId: string }>();
    for (const row of rows) {
      if (!row.fullname) continue;
      out.set(row.fullname, { conversationId: row.conversationId });
    }
    return out;
  }

  private async countRepliesByParent(conversationIds: string[]): Promise<Map<string, number>> {
    if (conversationIds.length === 0) return new Map();
    const parentExpr = sql<string | null>`${schema.convMessages.metadata}->'raw'->>'parentFullname'`;
    const rows = await this.db
      .select({ parent: parentExpr, total: sql<number>`count(*)::int` })
      .from(schema.convMessages)
      .where(
        and(
          inArray(schema.convMessages.conversationId, conversationIds),
          eq(schema.convMessages.authorType, 'end_user'),
        ),
      )
      .groupBy(parentExpr);
    const out = new Map<string, number>();
    for (const row of rows) {
      if (row.parent) out.set(row.parent, Number(row.total));
    }
    return out;
  }

  private async readState(
    channelId: string,
  ): Promise<{ cursor: RedditCursor; lastPolledAt: Date | null }> {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.bypass_rls', 'on', true)`);
      const rows = await tx
        .select({
          cursor: schema.convInboundState.cursor,
          lastPolledAt: schema.convInboundState.lastPolledAt,
        })
        .from(schema.convInboundState)
        .where(eq(schema.convInboundState.channelId, channelId))
        .limit(1);
      return {
        cursor: readCursor(rows[0]?.cursor),
        lastPolledAt: rows[0]?.lastPolledAt ?? null,
      };
    });
  }

  private async writeCursor(channelId: string, cursor: RedditCursor): Promise<void> {
    const value = JSON.parse(JSON.stringify(cursor)) as Record<string, unknown>;
    await this.db.transaction(async (tx: Tx) => {
      await tx.execute(sql`SELECT set_config('app.bypass_rls', 'on', true)`);
      await tx
        .insert(schema.convInboundState)
        .values({ channelId, cursor: value, lastPolledAt: new Date() })
        .onConflictDoUpdate({
          target: schema.convInboundState.channelId,
          set: { cursor: value, lastPolledAt: new Date(), updatedAt: new Date() },
        });
    });
  }
}

export function toInboundMessage(item: RedditInboxItem): InboundBatch['messages'][number] {
  const raw: Record<string, unknown> = {
    kind: item.kind,
    itemType: item.itemType,
    parentFullname: item.parentId,
    linkId: item.linkId,
    linkTitle: item.linkTitle,
    subreddit: item.subreddit,
  };
  if (item.subject) raw.subject = item.subject;
  const message: InboundBatch['messages'][number] = {
    fromIdentity:
      item.kind === 't4'
        ? { handle: item.author ?? undefined, name: item.author ?? undefined }
        : { handle: item.author ?? undefined },
    body: item.body || '(no body)',
    bodyHtml: item.bodyHtml,
    providerMessageId: item.fullname,
    receivedAt: item.createdUtc ? new Date(item.createdUtc * 1000) : new Date(),
    raw,
  };
  if (item.parentId) message.inReplyTo = item.parentId;
  if (item.kind === 't1' && item.linkId) {
    message.conversationKey = `${REDDIT_THREAD_KEY_PREFIX}${stripFullnamePrefix(item.linkId)}`;
  }
  return message;
}

export function translateSendError(err: unknown): unknown {
  if (err instanceof ChannelSendTerminalError || err instanceof ChannelSendDeferredError) return err;
  if (err instanceof RedditApiError) {
    if (err.kind === 'deferred') {
      const seconds = err.retryAfterSeconds ?? DEFAULT_DEFERRAL_SECONDS;
      return new ChannelSendDeferredError(err.message, new Date(Date.now() + seconds * 1000));
    }
    if (err.kind === 'terminal') return new ChannelSendTerminalError(err.message);
  }
  return err;
}

export function isAfterCursor(item: RedditInboxItem, cursor: RedditCursor): boolean {
  if (item.fullname === cursor.lastSeenFullname) return false;
  if (cursor.lastSeenCreatedUtc === undefined || item.createdUtc === null) return true;
  return item.createdUtc >= cursor.lastSeenCreatedUtc;
}

export function advanceCursor(cursor: RedditCursor, items: RedditInboxItem[]): RedditCursor {
  const next: RedditCursor = { ...cursor };
  for (const item of items) {
    if (item.createdUtc === null) continue;
    if (next.lastSeenCreatedUtc === undefined || item.createdUtc >= next.lastSeenCreatedUtc) {
      next.lastSeenCreatedUtc = item.createdUtc;
      next.lastSeenFullname = item.fullname;
    }
  }
  return next;
}

function readCursor(value: Record<string, unknown> | undefined): RedditCursor {
  const out: RedditCursor = {};
  if (!value) return out;
  if (typeof value.lastSeenFullname === 'string') out.lastSeenFullname = value.lastSeenFullname;
  if (typeof value.lastSeenCreatedUtc === 'number') {
    out.lastSeenCreatedUtc = value.lastSeenCreatedUtc;
  }
  if (typeof value.lastEngagementRefreshAt === 'string') {
    out.lastEngagementRefreshAt = value.lastEngagementRefreshAt;
  }
  return out;
}

export function isThreadConversation(metadata: Record<string, unknown>): boolean {
  if (metadata.redditTarget === 'comment') return true;
  const key = metadata[CONVERSATION_KEY_METADATA_FIELD];
  return typeof key === 'string' && key.startsWith(REDDIT_THREAD_KEY_PREFIX);
}

function readFullname(metadata: Record<string, unknown>, key: string): string | null {
  const value = metadata[key];
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return /^t\d_[A-Za-z0-9]+$/.test(trimmed) ? trimmed : null;
}

function resolveDmSubject(ctx: SendContext, username: string): string {
  const fromMessage = ctx.message.metadata.subject;
  const candidate =
    (typeof fromMessage === 'string' ? fromMessage.trim() : '') ||
    ctx.conversation.subject?.trim() ||
    `Message from /u/${username}`;
  return candidate.slice(0, MAX_DM_SUBJECT_LENGTH);
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
