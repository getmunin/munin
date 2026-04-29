import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { schema, type Db } from '@getmunin/db';
import { and, eq, isNotNull, lt, lte, sql } from 'drizzle-orm';
import {
  ActorIdentity,
  WebhookDispatcher,
  withContext,
  type RequestContext,
} from '@getmunin/core';
import { randomUUID } from 'node:crypto';
import { DB } from '../../../common/db/db.module.js';
import {
  CHANNEL_ADAPTERS,
  ChannelAdapterRegistry,
  type ChannelAdapter,
  type SendContext,
} from './adapter.js';

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
@Injectable()
export class OutboundDeliveryWorker implements OnModuleInit, OnModuleDestroy {
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
      void this.tick();
    }, POLL_INTERVAL_MS);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async tick(): Promise<{ attempted: number; sent: number; failed: number }> {
    if (this.running) return { attempted: 0, sent: 0, failed: 0 };
    this.running = true;
    try {
      return await this.drain();
    } finally {
      this.running = false;
    }
  }

  private async drain(): Promise<{ attempted: number; sent: number; failed: number }> {
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
    let failed = 0;
    for (const row of rows) {
      const ok = await this.attemptOne(row.id);
      if (ok) sent += 1;
      else failed += 1;
    }
    return { attempted: rows.length, sent, failed };
  }

  private async attemptOne(deliveryId: string): Promise<boolean> {
    const ctx = await this.loadContext(deliveryId);
    if (!ctx) return false;

    const adapter = this.registry.get(ctx.channel.type);
    if (!adapter) {
      await this.recordFailure(deliveryId, ctx.attempt, `no adapter registered for channel type '${ctx.channel.type}'`);
      return false;
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
      return false;
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
    return true;
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
