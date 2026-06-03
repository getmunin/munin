import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { CronExpression, SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { sql } from 'drizzle-orm';
import { type Db } from '@getmunin/db';
import { DB } from '../db/db.module.ts';
import { withSchedulerLock } from '../scheduler-lock/index.ts';

const DEFAULT_RETENTION_DAYS = 30;

@Injectable()
export class AuditRetentionService implements OnModuleInit {
  private readonly logger = new Logger(AuditRetentionService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly registry: SchedulerRegistry,
  ) {}

  onModuleInit(): void {
    if (process.env.NODE_ENV === 'test') return;
    const days = parseRetentionDays(process.env.MUNIN_AUDIT_RETENTION_DAYS);
    if (days === null) {
      this.logger.log('audit retention disabled');
      return;
    }
    const cron =
      process.env.MUNIN_AUDIT_RETENTION_CRON?.trim() ||
      CronExpression.EVERY_DAY_AT_3AM;
    const job = new CronJob(cron, () => {
      void withSchedulerLock(this.db, 'audit-retention', () =>
        this.prune(days),
      );
    });
    this.registry.addCronJob('audit-retention', job);
    job.start();
    this.logger.log(
      `audit retention scheduled with "${cron}" (${days} day window)`,
    );
  }

  private async prune(days: number): Promise<void> {
    try {
      await this.db.transaction(async (tx) => {
        await tx.execute(sql`SELECT set_config('app.bypass_rls', 'on', true)`);
        const result = await tx.execute(
          sql`DELETE FROM audit_log WHERE created_at < now() - make_interval(days => ${days})`,
        );
        const deleted =
          (result as { rowCount?: number | null }).rowCount ?? null;
        this.logger.log(
          deleted === null
            ? `audit retention pruned rows older than ${days} days`
            : `audit retention pruned ${deleted} rows older than ${days} days`,
        );
      });
    } catch (err) {
      this.logger.error(
        `audit retention failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}

function parseRetentionDays(raw: string | undefined): number | null {
  if (raw === undefined) return DEFAULT_RETENTION_DAYS;
  const trimmed = raw.trim().toLowerCase();
  if (trimmed === '') return DEFAULT_RETENTION_DAYS;
  if (trimmed === 'off' || trimmed === '0') return null;
  const n = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_RETENTION_DAYS;
  return n;
}
