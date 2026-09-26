import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { schema, type Db } from '@getmunin/db';
import { and, eq, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import {
  ActorIdentity,
  getCurrentContext,
  parseEnvDisableFlag,
  parseEnvInt,
  withContext,
  type RequestContext,
} from '@getmunin/core';
import { DB } from '../../../common/db/db.module.ts';
import { withSchedulerLock } from '../../../common/scheduler-lock/index.ts';
import { AlertsService } from '../../system-alerts/system-alerts.service.ts';
import {
  CHANNEL_ADAPTERS,
  ChannelAdapterRegistry,
  type ChannelAdapter,
  type PollFailureKind,
  type PollTickResult,
} from './adapter.ts';

const POLL_INTERVAL_MS = parseEnvInt({
  name: 'MUNIN_INBOUND_POLL_WORKER_INTERVAL_MS',
  default: parseEnvInt({ name: 'MUNIN_EMAIL_INBOUND_POLL_MS', default: 60_000 }),
});

const AUTO_DEACTIVATE_THRESHOLD = 5;
const MAX_BACKOFF_MS = 15 * 60_000;
const TRANSIENT_ALERT_AFTER_MS = 5 * 60_000;

export function pollBackoffMs(consecutiveFailures: number, intervalMs: number): number {
  if (consecutiveFailures <= 1) return 0;
  return Math.min(intervalMs * 2 ** (consecutiveFailures - 1), MAX_BACKOFF_MS);
}

type PollChannel = typeof schema.convChannels.$inferSelect;

interface PollCandidate {
  channel: PollChannel;
  storedFailures: number;
  priorFailures: number;
  failingForMs: number;
}

@Injectable()
export class InboundPollWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(InboundPollWorker.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private disabled =
    parseEnvDisableFlag('MUNIN_INBOUND_POLL_WORKER_DISABLED') ||
    parseEnvDisableFlag('MUNIN_EMAIL_INBOUND_WORKER_DISABLED') ||
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

    const state = schema.convInboundState;
    const rows = await this.db
      .select({
        channel: schema.convChannels,
        storedFailures: sql<number>`coalesce(${state.consecutiveFailures}, 0)`.mapWith(Number),
        edited: sql<boolean>`coalesce(${schema.convChannels.updatedAt} > ${state.lastFailureAt}, false)`,
        deferred: sql<boolean>`coalesce(${state.nextPollAt} > now(), false)`,
        failingForMs: sql<number>`coalesce(extract(epoch from now() - ${state.failingSince}) * 1000, 0)::float8`.mapWith(
          Number,
        ),
      })
      .from(schema.convChannels)
      .leftJoin(state, eq(state.channelId, schema.convChannels.id))
      .where(and(eq(schema.convChannels.active, true)));

    let polled = 0;
    let ingested = 0;
    for (const row of rows) {
      const { channel } = row;
      const adapter = this.registry.get(channel.type, channel.vendor);
      if (!adapter || adapter.inbound?.mode !== 'poll') continue;
      if (row.deferred && !row.edited) continue;
      const candidate: PollCandidate = {
        channel,
        storedFailures: row.storedFailures,
        priorFailures: row.edited ? 0 : row.storedFailures,
        failingForMs: row.edited ? 0 : row.failingForMs,
      };
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
        await this.recordSuccess(candidate, result);
      } catch (err) {
        const kind = adapter.inbound.classifyError?.(err) ?? 'transient';
        await this.recordFailure(candidate, kind, err);
      }
    }
    return { channelsPolled: polled, messagesIngested: ingested };
  }

  private async recordSuccess(candidate: PollCandidate, result: PollTickResult): Promise<void> {
    const { channel } = candidate;
    await this.withChannelContext(channel.orgId, async () => {
      const ctx = getCurrentContext();
      if (candidate.storedFailures > 0) {
        await ctx.db
          .update(schema.convInboundState)
          .set({ consecutiveFailures: 0, failingSince: null, nextPollAt: null, updatedAt: new Date() })
          .where(eq(schema.convInboundState.channelId, channel.id));
      }
      if (result.stalled) {
        await this.openIngestStallAlert(channel, result.lastError ?? 'ingest failed');
      } else {
        await this.alerts.resolveAlert({
          source: 'channel_inbound',
          subjectId: ingestStallSubjectId(channel.id),
        });
      }
      await this.alerts.resolveAlert({ source: 'channel_inbound', subjectId: channel.id });
    });
  }

  private async recordFailure(
    candidate: PollCandidate,
    kind: PollFailureKind,
    err: unknown,
  ): Promise<void> {
    const { channel } = candidate;
    const message = err instanceof Error ? err.message : String(err);
    const failures = candidate.priorFailures + 1;
    const fresh = candidate.priorFailures === 0;
    const backoffMs = pollBackoffMs(failures, POLL_INTERVAL_MS);
    const nextPollAt =
      backoffMs > 0
        ? sql`now() + ${backoffMs - POLL_INTERVAL_MS / 2} * interval '1 millisecond'`
        : null;
    const logLine = `poll ${channel.type} channel=${channel.id} failed (${kind}, ${failures} in a row): ${message}`;
    if (kind === 'permanent') this.logger.error(logLine);
    else this.logger.warn(logLine);

    await this.withChannelContext(channel.orgId, async () => {
      const ctx = getCurrentContext();
      await ctx.db
        .insert(schema.convInboundState)
        .values({
          channelId: channel.id,
          consecutiveFailures: failures,
          failingSince: sql`now()`,
          lastFailureAt: sql`now()`,
          nextPollAt,
        })
        .onConflictDoUpdate({
          target: schema.convInboundState.channelId,
          set: {
            consecutiveFailures: failures,
            ...(fresh ? { failingSince: sql`now()` } : {}),
            lastFailureAt: sql`now()`,
            nextPollAt,
            updatedAt: new Date(),
          },
        });

      if (kind === 'transient' && candidate.failingForMs < TRANSIENT_ALERT_AFTER_MS) return;

      const result = await this.alerts.openAlert({
        source: 'channel_inbound',
        subjectId: channel.id,
        severity: 'error',
        title: 'Inbound polling failing',
        detail: message,
        metadata: {
          channelType: channel.type,
          channelId: channel.id,
          channelName: channel.name ?? channel.type,
          failureKind: kind,
          attemptCount: failures,
          ...(kind === 'permanent' ? { threshold: AUTO_DEACTIVATE_THRESHOLD } : {}),
        },
      });
      if (kind === 'permanent' && failures >= AUTO_DEACTIVATE_THRESHOLD) {
        await this.autoDeactivate(channel, result.alertId, failures);
      }
    });
  }

  private async openIngestStallAlert(channel: PollChannel, detail: string): Promise<void> {
    const result = await this.alerts.openAlert({
      source: 'channel_inbound',
      subjectId: ingestStallSubjectId(channel.id),
      severity: 'error',
      title: 'Inbound message could not be stored',
      detail,
      metadata: {
        channelType: channel.type,
        channelId: channel.id,
        channelName: channel.name ?? channel.type,
      },
    });
    await this.alerts.updateMetadata(result.alertId, {
      attemptCount: result.occurrenceCount,
    });
  }

  private async autoDeactivate(
    channel: PollChannel,
    alertId: string,
    consecutiveFailures: number,
  ): Promise<void> {
    const ctx = getCurrentContext();
    await ctx.db
      .update(schema.convChannels)
      .set({ active: false, updatedAt: new Date() })
      .where(eq(schema.convChannels.id, channel.id));
    await this.alerts.setTitle(alertId, 'Auto-deactivated after repeated polling failures');
    await this.alerts.updateMetadata(alertId, {
      deactivatedAt: new Date().toISOString(),
      attemptCount: consecutiveFailures,
      threshold: AUTO_DEACTIVATE_THRESHOLD,
    });
    this.logger.error(
      `auto-deactivated channel=${channel.id} after ${consecutiveFailures} failed polls`,
    );
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

function ingestStallSubjectId(channelId: string): string {
  return `${channelId}:ingest`;
}
