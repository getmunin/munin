import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { type Db } from '@getmunin/db';
import { sql } from 'drizzle-orm';
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
import { ConvService } from './conv.service.ts';

const DEFAULT_INTERVAL_MS = 60_000;

@Injectable()
export class SnoozeWakeWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SnoozeWakeWorker.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private readonly disabled =
    parseEnvDisableFlag('MUNIN_SNOOZE_WAKE_WORKER_DISABLED') ||
    process.env.NODE_ENV === 'test';
  private readonly intervalMs = parseEnvInt({
    name: 'MUNIN_SNOOZE_WAKE_WORKER_INTERVAL_MS',
    default: DEFAULT_INTERVAL_MS,
  });

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly conv: ConvService,
  ) {}

  onModuleInit(): void {
    if (this.disabled) return;
    this.logger.log(`snooze wake worker starting (every ${this.intervalMs}ms)`);
    this.timer = setInterval(() => {
      void withSchedulerLock(this.db, 'snooze-wake-worker', () => this.tick());
    }, this.intervalMs);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Public so tests can drive a single tick directly. */
  async tick(): Promise<{ woken: number }> {
    if (this.running) return { woken: 0 };
    this.running = true;
    try {
      let woken = 0;
      for (const orgId of await this.dueOrgIds()) {
        try {
          woken += await this.wakeForOrg(orgId);
        } catch (err) {
          this.logger.warn(`wake failed for org ${orgId}: ${describe(err)}`);
        }
      }
      return { woken };
    } finally {
      this.running = false;
    }
  }

  private async dueOrgIds(): Promise<string[]> {
    const rows = await this.db.execute<{ org_id: string }>(sql`
      SELECT DISTINCT org_id FROM conv_conversations
      WHERE status = 'snoozed'
        AND snooze_until IS NOT NULL
        AND snooze_until <= now()
    `);
    return toArray<{ org_id: string }>(rows).map((r) => r.org_id);
  }

  private async wakeForOrg(orgId: string): Promise<number> {
    return await this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.bypass_rls', 'off', true)`);
      await tx.execute(sql`SELECT set_config('app.org_id', ${orgId}, true)`);
      await tx.execute(sql`SELECT set_config('app.end_user_id', '', true)`);
      const actor = new ActorIdentity('system', 'snooze-wake-worker', orgId, ['*'], ['admin']);
      const ctx: RequestContext = { db: tx, actor, correlationId: randomUUID() };
      const woken = await withContext(ctx, () => this.conv.wakeDueSnoozedConversations());
      if (woken > 0) this.logger.log(`woke ${woken} snoozed conversation(s) for org ${orgId}`);
      return woken;
    });
  }
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function toArray<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  const rows = (result as { rows?: unknown[] }).rows;
  return Array.isArray(rows) ? (rows as T[]) : [];
}
