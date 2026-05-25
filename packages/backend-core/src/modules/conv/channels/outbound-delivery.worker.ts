import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { schema, type Db } from '@getmunin/db';
import { and, eq, isNotNull, lt, lte, sql } from 'drizzle-orm';
import {
  ActorIdentity,
  WebhookDispatcher,
  withContext,
  type RequestContext,
} from '@getmunin/core';
import type { SendLimits } from '@getmunin/types';
import { randomUUID } from 'node:crypto';
import { DB } from '../../../common/db/db.module.js';
import { withSchedulerLock } from '../../../common/scheduler-lock/index.js';
import {
  CHANNEL_ADAPTERS,
  ChannelAdapterRegistry,
  type ChannelAdapter,
  type SendContext,
} from './adapter.js';
import {
  decideRateLimit,
  rateLimitDeferralError,
  type SendCounts,
} from './send-rate-limit.js';

const POLL_INTERVAL_MS = Number(
  process.env.MUNIN_OUTBOUND_DELIVERY_WORKER_INTERVAL_MS ??
    process.env.MUNIN_EMAIL_OUTBOUND_POLL_MS ??
    10_000,
);
const MAX_ATTEMPTS = 5;
const BATCH_SIZE = 25;
const BACKOFF_BASE_MS = 30_000;

/**
 * Drains `conv_message_deliveries` (status='queued' or 'failed' due) and
 * dispatches each row to the adapter that matches the channel's `type`.
 * Handles attempt counting, exponential backoff, terminal 'dead' state, and
 * webhook emission. Adapter only implements `send()`.
 *
 * Disabled in tests via `MUNIN_OUTBOUND_DELIVERY_WORKER_DISABLED=1` (or
 * legacy `MUNIN_EMAIL_OUTBOUND_WORKER_DISABLED=1`) or `NODE_ENV=test`.
 */
type AttemptOutcome = 'sent' | 'deferred' | 'failed';

@Injectable()
export class OutboundDeliveryWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OutboundDeliveryWorker.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private disabled =
    process.env.MUNIN_OUTBOUND_DELIVERY_WORKER_DISABLED === '1' ||
    process.env.MUNIN_EMAIL_OUTBOUND_WORKER_DISABLED === '1' ||
    process.env.NODE_ENV === 'test';

  private readonly registry: ChannelAdapterRegistry;

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(WebhookDispatcher) private readonly webhooks: WebhookDispatcher,
    @Inject(CHANNEL_ADAPTERS) adapters: ChannelAdapter[],
  ) {
    this.registry = new ChannelAdapterRegistry(adapters);
  }

  onModuleInit(): void {
    if (this.disabled) return;
    this.timer = setInterval(() => {
      void withSchedulerLock(this.db, 'outbound-delivery-worker', () => this.tick());
    }, POLL_INTERVAL_MS);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async tick(): Promise<{ attempted: number; sent: number; deferred: number; failed: number }> {
    if (this.running) return { attempted: 0, sent: 0, deferred: 0, failed: 0 };
    this.running = true;
    try {
      return await this.drain();
    } finally {
      this.running = false;
    }
  }

  private async drain(): Promise<{ attempted: number; sent: number; deferred: number; failed: number }> {
    const now = new Date();
    const rows = await this.db
      .select({ id: schema.convMessageDeliveries.id })
      .from(schema.convMessageDeliveries)
      .where(
        and(
          sql`${schema.convMessageDeliveries.status} IN ('queued','failed')`,
          lt(schema.convMessageDeliveries.attempt, MAX_ATTEMPTS),
          isNotNull(schema.convMessageDeliveries.nextAttemptAt),
          lte(schema.convMessageDeliveries.nextAttemptAt, now),
        ),
      )
      .limit(BATCH_SIZE);

    let sent = 0;
    let deferred = 0;
    let failed = 0;
    for (const row of rows) {
      const outcome = await this.attemptOne(row.id);
      if (outcome === 'sent') sent += 1;
      else if (outcome === 'deferred') deferred += 1;
      else failed += 1;
    }
    return { attempted: rows.length, sent, deferred, failed };
  }

  private async attemptOne(deliveryId: string): Promise<AttemptOutcome> {
    const ctx = await this.loadContext(deliveryId);
    if (!ctx) return 'failed';

    const adapter = this.registry.get(ctx.channel.type, ctx.channel.vendor);
    if (!adapter) {
      await this.recordFailure(
        deliveryId,
        ctx.attempt,
        `no adapter registered for channel '${ctx.channel.type}:${ctx.channel.vendor}'`,
      );
      return 'failed';
    }

    const limits = extractSendLimits(ctx.channel.config);
    if (limits) {
      const counts = await this.countRecentSends(ctx.channel.id);
      const decision = decideRateLimit(limits, counts, new Date());
      if (decision.kind === 'deferred') {
        await this.recordDeferral(deliveryId, decision.nextAttemptAt, rateLimitDeferralError(decision));
        this.logger.log(
          `delivery ${deliveryId} on channel ${ctx.channel.id} deferred (${decision.reason}) until ${decision.nextAttemptAt.toISOString()}`,
        );
        return 'deferred';
      }
    }

    let result;
    try {
      const sendCtx: SendContext = {
        delivery: ctx.delivery,
        message: ctx.message,
        conversation: ctx.conversation,
        channel: ctx.channel,
        contact: ctx.contact,
        attempt: ctx.attempt,
      };
      result = await adapter.send(sendCtx);
    } catch (err) {
      await this.recordFailure(deliveryId, ctx.attempt, errorMessage(err));
      return 'failed';
    }

    await this.db
      .update(schema.convMessageDeliveries)
      .set({
        status: 'sent',
        attempt: ctx.attempt + 1,
        sentAt: new Date(),
        messageIdHeader: result.providerMessageId,
        error: null,
        nextAttemptAt: null,
        updatedAt: new Date(),
      })
      .where(eq(schema.convMessageDeliveries.id, deliveryId));

    await this.fireWebhook('conversation.message.delivered', {
      orgId: ctx.message.orgId,
      conversationId: ctx.conversation.id,
      messageId: ctx.message.id,
      channelId: ctx.channel.id,
    });
    return 'sent';
  }

  private async recordDeferral(
    deliveryId: string,
    nextAttemptAt: Date,
    encodedReason: string,
  ): Promise<void> {
    await this.db
      .update(schema.convMessageDeliveries)
      .set({
        status: 'queued',
        nextAttemptAt,
        error: encodedReason,
        updatedAt: new Date(),
      })
      .where(eq(schema.convMessageDeliveries.id, deliveryId));
  }

  private async countRecentSends(channelId: string): Promise<SendCounts> {
    const now = new Date();
    const hourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const rows = await this.db.execute<{
      hour_count: string | number;
      hour_oldest: Date | string | null;
      day_count: string | number;
      day_oldest: Date | string | null;
    }>(sql`
      SELECT
        COUNT(*) FILTER (WHERE sent_at >= ${hourAgo.toISOString()}::timestamptz) AS hour_count,
        MIN(sent_at) FILTER (WHERE sent_at >= ${hourAgo.toISOString()}::timestamptz) AS hour_oldest,
        COUNT(*) AS day_count,
        MIN(sent_at) AS day_oldest
      FROM conv_message_deliveries
      WHERE channel_id = ${channelId}
        AND status = 'sent'
        AND sent_at IS NOT NULL
        AND sent_at >= ${dayAgo.toISOString()}::timestamptz
    `);
    const row = Array.isArray(rows)
      ? rows[0]
      : ((rows as { rows?: unknown[] }).rows?.[0] as
          | { hour_count: string | number; hour_oldest: Date | string | null; day_count: string | number; day_oldest: Date | string | null }
          | undefined);
    if (!row) {
      return {
        lastHourSentCount: 0,
        oldestSentAtInLastHour: null,
        lastDaySentCount: 0,
        oldestSentAtInLastDay: null,
      };
    }
    return {
      lastHourSentCount: Number(row.hour_count),
      oldestSentAtInLastHour: toDate(row.hour_oldest),
      lastDaySentCount: Number(row.day_count),
      oldestSentAtInLastDay: toDate(row.day_oldest),
    };
  }

  private async recordFailure(deliveryId: string, priorAttempts: number, error: string): Promise<void> {
    const next = priorAttempts + 1;
    const final = next >= MAX_ATTEMPTS;
    const backoff = BACKOFF_BASE_MS * 2 ** priorAttempts;
    const jitter = Math.floor(backoff * 0.1 * Math.random());
    await this.db
      .update(schema.convMessageDeliveries)
      .set({
        status: final ? 'dead' : 'failed',
        attempt: next,
        error,
        nextAttemptAt: final ? null : new Date(Date.now() + backoff + jitter),
        updatedAt: new Date(),
      })
      .where(eq(schema.convMessageDeliveries.id, deliveryId));

    if (final) {
      const row = await this.db
        .select()
        .from(schema.convMessageDeliveries)
        .where(eq(schema.convMessageDeliveries.id, deliveryId))
        .limit(1);
      const d = row[0];
      if (d) {
        const msg = await this.db
          .select({ conversationId: schema.convMessages.conversationId })
          .from(schema.convMessages)
          .where(eq(schema.convMessages.id, d.messageId))
          .limit(1);
        await this.fireWebhook('conversation.message.delivery_failed', {
          orgId: d.orgId,
          conversationId: msg[0]?.conversationId ?? '',
          messageId: d.messageId,
          channelId: d.channelId,
          error,
          attempts: next,
        });
      }
    }
  }

  private async fireWebhook(type: string, payload: Record<string, unknown>): Promise<void> {
    const orgId = payload.orgId as string;
    if (!orgId) return;
    const actor = new ActorIdentity('system', 'outbound-delivery-worker', orgId, ['*'], ['admin']);
    await this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.bypass_rls', 'on', true)`);
      const ctx: RequestContext = { db: tx, actor, correlationId: randomUUID() };
      await withContext(ctx, async () => {
        await this.webhooks.emit({ type, payload });
      });
    });
  }

  private async loadContext(deliveryId: string): Promise<{
    delivery: typeof schema.convMessageDeliveries.$inferSelect;
    message: typeof schema.convMessages.$inferSelect;
    conversation: typeof schema.convConversations.$inferSelect;
    channel: typeof schema.convChannels.$inferSelect;
    contact: typeof schema.convContacts.$inferSelect | null;
    attempt: number;
  } | null> {
    const rows = await this.db
      .select({
        delivery: schema.convMessageDeliveries,
        message: schema.convMessages,
        conversation: schema.convConversations,
        channel: schema.convChannels,
        contact: schema.convContacts,
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
      .innerJoin(
        schema.convChannels,
        eq(schema.convChannels.id, schema.convMessageDeliveries.channelId),
      )
      .leftJoin(
        schema.convContacts,
        eq(schema.convContacts.id, schema.convConversations.contactId),
      )
      .where(eq(schema.convMessageDeliveries.id, deliveryId))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return {
      delivery: row.delivery,
      message: row.message,
      conversation: row.conversation,
      channel: row.channel,
      contact: row.contact ?? null,
      attempt: row.delivery.attempt,
    };
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function extractSendLimits(config: unknown): SendLimits | null {
  if (!config || typeof config !== 'object') return null;
  const limits = (config as { sendLimits?: unknown }).sendLimits;
  if (!limits || typeof limits !== 'object') return null;
  const out: SendLimits = {};
  const candidate = limits as { perHourMax?: unknown; perDayMax?: unknown };
  if (typeof candidate.perHourMax === 'number' && candidate.perHourMax > 0) {
    out.perHourMax = candidate.perHourMax;
  }
  if (typeof candidate.perDayMax === 'number' && candidate.perDayMax > 0) {
    out.perDayMax = candidate.perDayMax;
  }
  return out.perHourMax === undefined && out.perDayMax === undefined ? null : out;
}

function toDate(value: Date | string | null): Date | null {
  if (value === null) return null;
  if (value instanceof Date) return value;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
