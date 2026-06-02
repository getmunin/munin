import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { schema, type Db } from '@getmunin/db';
import { and, eq, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { ActorIdentity, getCurrentContext, withContext, type RequestContext } from '@getmunin/core';
import { DB } from '../../../common/db/db.module.ts';
import { withSchedulerLock } from '../../../common/scheduler-lock/index.ts';
import { AlertsService } from '../../system-alerts/system-alerts.service.ts';
import { CHANNEL_ADAPTERS, ChannelAdapterRegistry, type ChannelAdapter } from './adapter.ts';

const POLL_INTERVAL_MS = Number(
  process.env.MUNIN_INBOUND_POLL_WORKER_INTERVAL_MS ??
    process.env.MUNIN_EMAIL_INBOUND_POLL_MS ??
    60_000,
);

const AUTO_DEACTIVATE_THRESHOLD = 5;

/**
 * Generic poll-mode inbound worker. Iterates active channels whose adapter
 * is poll-mode and dispatches `adapter.inbound.tick(channel)`. Per-tick
 * cursor / error bookkeeping lives in `conv_inbound_state`, which adapters
 * read/write themselves (the worker is purely a scheduler).
 *
 * Disabled in tests via `MUNIN_INBOUND_POLL_WORKER_DISABLED=1` (or legacy
 * `MUNIN_EMAIL_INBOUND_WORKER_DISABLED=1`) or `NODE_ENV=test`. Tests call
 * `tick()` directly.
 */
@Injectable()
export class InboundPollWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(InboundPollWorker.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private disabled =
    process.env.MUNIN_INBOUND_POLL_WORKER_DISABLED === '1' ||
    process.env.MUNIN_EMAIL_INBOUND_WORKER_DISABLED === '1' ||
    process.env.NODE_ENV === 'test';

  private readonly registry: ChannelAdapterRegistry;

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CHANNEL_ADAPTERS) adapters: ChannelAdapter[],
    @Inject(AlertsService) private readonly alerts: AlertsService,
  ) {
    this.registry = new ChannelAdapterRegistry(adapters);
  }

  onModuleInit(): void {
    if (this.disabled) return;
    this.logger.log(`inbound poll worker starting (every ${POLL_INTERVAL_MS}ms)`);
    this.timer = setInterval(() => {
      void withSchedulerLock(this.db, 'inbound-poll-worker', () => this.tick());
    }, POLL_INTERVAL_MS);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Public so tests can drive a single tick directly. */
  async tick(): Promise<{ channelsPolled: number; messagesIngested: number }> {
    if (this.running) return { channelsPolled: 0, messagesIngested: 0 };
    this.running = true;
    try {
      return await this.runOnce();
    } finally {
      this.running = false;
    }
  }

  private async runOnce(): Promise<{ channelsPolled: number; messagesIngested: number }> {
    const pollAdapters = this.registry.pollAdapters();
    if (pollAdapters.length === 0) return { channelsPolled: 0, messagesIngested: 0 };

    const channels = await this.db
      .select()
      .from(schema.convChannels)
      .where(and(eq(schema.convChannels.active, true)));

    let polled = 0;
    let ingested = 0;
    for (const channel of channels) {
      const adapter = this.registry.get(channel.type, channel.vendor);
      if (!adapter || adapter.inbound?.mode !== 'poll') continue;
      try {
        const result = await adapter.inbound.tick(channel);
        ingested += result.messagesIngested;
        polled += 1;
        if (result.messagesIngested > 0 || result.lastError) {
          this.logger.log(
            `poll ${channel.type} channel=${channel.id} ingested=${result.messagesIngested}` +
              (result.lastError ? ` lastError=${result.lastError}` : ''),
          );
        } else {
          this.logger.debug(`poll ${channel.type} channel=${channel.id} (no new messages)`);
        }
        await this.resolveAlertFor(channel);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.error(`poll ${channel.type} channel=${channel.id} threw: ${message}`);
        await this.openAlertFor(channel, message);
      }
    }
    return { channelsPolled: polled, messagesIngested: ingested };
  }

  private async openAlertFor(
    channel: { id: string; orgId: string; type: string; name: string | null },
    detail: string,
  ): Promise<void> {
    await this.withChannelContext(channel.orgId, async () => {
      const result = await this.alerts.openAlert({
        source: 'channel_inbound',
        subjectId: channel.id,
        severity: 'error',
        title: 'Inbound polling failing',
        detail,
        metadata: {
          channelType: channel.type,
          channelId: channel.id,
          channelName: channel.name ?? channel.type,
          threshold: AUTO_DEACTIVATE_THRESHOLD,
        },
      });
      if (result.occurrenceCount >= AUTO_DEACTIVATE_THRESHOLD) {
        await this.autoDeactivate(channel, result.alertId, result.occurrenceCount);
      } else {
        await this.alerts.updateMetadata(result.alertId, {
          attemptCount: result.occurrenceCount,
        });
      }
    });
  }

  private async autoDeactivate(
    channel: { id: string; orgId: string; type: string; name: string | null },
    alertId: string,
    occurrenceCount: number,
  ): Promise<void> {
    const ctx = getCurrentContext();
    await ctx.db
      .update(schema.convChannels)
      .set({ active: false, updatedAt: new Date() })
      .where(eq(schema.convChannels.id, channel.id));
    await this.alerts.setTitle(alertId, 'Auto-deactivated after repeated polling failures');
    await this.alerts.updateMetadata(alertId, {
      deactivatedAt: new Date().toISOString(),
      attemptCount: occurrenceCount,
      threshold: AUTO_DEACTIVATE_THRESHOLD,
    });
    this.logger.error(
      `auto-deactivated channel=${channel.id} after ${occurrenceCount} failed polls`,
    );
  }

  private async resolveAlertFor(channel: { id: string; orgId: string }): Promise<void> {
    await this.withChannelContext(channel.orgId, async () => {
      await this.alerts.resolveAlert({ source: 'channel_inbound', subjectId: channel.id });
    });
  }

  private async withChannelContext(orgId: string, fn: () => Promise<void>): Promise<void> {
    const actor = new ActorIdentity('system', 'inbound-poll-worker', orgId, ['*'], ['admin']);
    await this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.bypass_rls', 'on', true)`);
      const ctx: RequestContext = { db: tx, actor, correlationId: randomUUID() };
      await withContext(ctx, fn);
    });
  }
}
