import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { schema, type Db } from '@getmunin/db';
import { and, asc, inArray, lte, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import {
  ActorIdentity,
  parseEnvDisableFlag,
  parseEnvInt,
  withContext,
  type RequestContext,
} from '@getmunin/core';
import { DB } from '../../common/db/db.module.ts';
import { withSchedulerLock } from '../../common/scheduler-lock/index.ts';
import { EmailAdapter, type BulkEmailResult } from '../conv/email/email-adapter.ts';
import {
  BROADCAST_WORKER_ACTOR_ID,
  OutreachBroadcastsService,
  recoverStaleSends,
  type BulkEmailSender,
} from './outreach-broadcasts.service.ts';

const DEFAULT_INTERVAL_MS = 60_000;
const DEFAULT_MAX_PER_MINUTE = 60;
const DUE_BATCH = 20;

interface DueBroadcast {
  id: string;
  orgId: string;
  channelId: string;
}

export interface BroadcastTickResult {
  sent: number;
  failed: number;
  skipped: number;
  completed: number;
  recovered: number;
}

@Injectable()
export class OutreachBroadcastWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OutreachBroadcastWorker.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private readonly disabled =
    parseEnvDisableFlag('MUNIN_OUTREACH_BROADCAST_WORKER_DISABLED') ||
    process.env.NODE_ENV === 'test';
  private readonly intervalMs = parseEnvInt({
    name: 'MUNIN_OUTREACH_BROADCAST_POLL_MS',
    default: DEFAULT_INTERVAL_MS,
  });
  private readonly maxPerMinute = parseEnvInt({
    name: 'MUNIN_OUTREACH_BROADCAST_MAX_PER_MINUTE',
    default: DEFAULT_MAX_PER_MINUTE,
  });

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(OutreachBroadcastsService) private readonly broadcasts: OutreachBroadcastsService,
    @Inject(EmailAdapter) private readonly mail: BulkEmailSender,
  ) {}

  onModuleInit(): void {
    if (this.disabled) return;
    this.logger.log(
      `outreach broadcast worker starting (every ${this.intervalMs}ms, ${this.maxPerMinute}/min per channel)`,
    );
    this.timer = setInterval(() => {
      void withSchedulerLock(this.db, 'outreach-broadcast-worker', () => this.tick());
    }, this.intervalMs);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async tick(): Promise<BroadcastTickResult> {
    const empty: BroadcastTickResult = { sent: 0, failed: 0, skipped: 0, completed: 0, recovered: 0 };
    if (this.running) return empty;
    this.running = true;
    try {
      return await this.drain();
    } finally {
      this.running = false;
    }
  }

  private async drain(): Promise<BroadcastTickResult> {
    const result: BroadcastTickResult = { sent: 0, failed: 0, skipped: 0, completed: 0, recovered: 0 };
    result.recovered = await this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.bypass_rls', 'on', true)`);
      return recoverStaleSends(tx);
    });
    if (result.recovered > 0) {
      this.logger.warn(`marked ${result.recovered} interrupted broadcast sends as failed`);
    }

    const perTick = Math.max(1, Math.floor((this.maxPerMinute * this.intervalMs) / 60_000));
    const budgets = new Map<string, number>();
    for (const broadcast of await this.dueBroadcasts()) {
      const budget = budgets.get(broadcast.channelId) ?? perTick;
      try {
        const used = await this.sendNext(broadcast, budget, result);
        budgets.set(broadcast.channelId, budget - used);
      } catch (err) {
        this.logger.error(`broadcast ${broadcast.id} tick failed: ${describe(err)}`);
      }
    }
    return result;
  }

  private async sendNext(
    broadcast: DueBroadcast,
    budget: number,
    result: BroadcastTickResult,
  ): Promise<number> {
    await this.inOrgContext(broadcast.orgId, () => this.broadcasts.startDueBroadcast(broadcast.id));
    const batch = await this.inOrgContext(broadcast.orgId, () =>
      this.broadcasts.claimBatch(broadcast.id, budget),
    );
    result.skipped += batch.skipped;
    if (batch.pausedReason) this.logger.warn(`broadcast ${broadcast.id} paused: ${batch.pausedReason}`);

    if (batch.channel && batch.messages.length > 0) {
      let sends: BulkEmailResult[];
      try {
        sends = await this.mail.sendBulk(batch.channel, batch.messages);
      } catch (err) {
        const error = describe(err);
        sends = batch.messages.map((m) => ({ key: m.key, messageId: null, error }));
      }
      result.sent += sends.filter((s) => s.messageId).length;
      result.failed += sends.filter((s) => !s.messageId).length;
      await this.inOrgContext(broadcast.orgId, () =>
        this.broadcasts.recordBatch(broadcast.id, sends),
      );
    }

    const finished = await this.inOrgContext(broadcast.orgId, () =>
      this.broadcasts.finishIfDone(broadcast.id),
    );
    if (finished) result.completed += 1;
    return batch.messages.length;
  }

  private async dueBroadcasts(): Promise<DueBroadcast[]> {
    return await this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.bypass_rls', 'on', true)`);
      const b = schema.outreachBroadcasts;
      return await tx
        .select({ id: b.id, orgId: b.orgId, channelId: b.channelId })
        .from(b)
        .where(and(inArray(b.status, ['approved', 'sending']), lte(b.scheduledSendAt, new Date())))
        .orderBy(asc(b.scheduledSendAt))
        .limit(DUE_BATCH);
    });
  }

  private inOrgContext<T>(orgId: string, fn: () => Promise<T>): Promise<T> {
    const actor = new ActorIdentity('system', BROADCAST_WORKER_ACTOR_ID, orgId, ['*'], ['admin']);
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.bypass_rls', 'on', true)`);
      const ctx: RequestContext = { db: tx, actor, correlationId: randomUUID() };
      return await withContext(ctx, fn);
    });
  }
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
