import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { CronExpression, SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { schema, type Db } from '@getmunin/db';
import { sql } from 'drizzle-orm';
import {
  ActorIdentity,
  RequestContextStore,
  parseEnvCron,
  parseEnvDisableFlag,
  type RequestContext,
} from '@getmunin/core';
import { randomUUID } from 'node:crypto';
import { DB } from '../../common/db/db.module.ts';
import { withSchedulerLock } from '../../common/scheduler-lock/index.ts';
import { ConvService } from './conv.service.ts';

const DEFAULT_THRESHOLD_DAYS = 2;

@Injectable()
export class ConvSchedulerService implements OnModuleInit {
  private readonly logger = new Logger(ConvSchedulerService.name);
  private readonly disabled =
    parseEnvDisableFlag('MUNIN_CONV_AUTO_CLOSE_DISABLED') ||
    process.env.NODE_ENV === 'test';
  private readonly thresholdDays = parseThresholdDays();

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly conv: ConvService,
    private readonly registry: SchedulerRegistry,
  ) {}

  onModuleInit(): void {
    if (this.disabled) {
      this.logger.log('conv auto-close scheduler disabled');
      return;
    }

    const cron = parseEnvCron({
      name: 'MUNIN_CONV_AUTO_CLOSE_CRON',
      default: CronExpression.EVERY_HOUR,
    });
    if (cron === null) {
      this.logger.log('conv auto-close disabled by env');
      return;
    }

    const job = new CronJob(cron, () => {
      void withSchedulerLock(this.db, 'conv-scheduler:auto-close', () => this.runSweep());
    });
    this.registry.addCronJob('conv-auto-close', job);
    job.start();
    this.logger.log(
      `conv auto-close scheduled with "${cron}" (threshold ${this.thresholdDays}d)`,
    );
  }

  private async runSweep(): Promise<void> {
    const orgs = await this.db.select({ id: schema.orgs.id }).from(schema.orgs);
    if (orgs.length === 0) return;

    for (const org of orgs) {
      try {
        await this.closeForOrg(org.id);
      } catch (err) {
        this.logger.warn(`conv auto-close failed for org ${org.id}: ${describe(err)}`);
      }
    }
  }

  private async closeForOrg(orgId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.bypass_rls', 'off', true)`);
      await tx.execute(sql`SELECT set_config('app.org_id', ${orgId}, true)`);
      await tx.execute(sql`SELECT set_config('app.end_user_id', '', true)`);
      const actor = new ActorIdentity('admin_agent', 'conv-scheduler', orgId, ['*'], ['admin']);
      const ctx: RequestContext = { db: tx, actor, correlationId: randomUUID() };
      await RequestContextStore.run(ctx, async () => {
        const closed = await this.conv.autoCloseInactive({ thresholdDays: this.thresholdDays });
        if (closed > 0) {
          this.logger.log(`conv auto-close closed ${closed} conversation(s) for org ${orgId}`);
        }
      });
    });
  }
}

function parseThresholdDays(): number {
  const raw = process.env.MUNIN_CONV_AUTO_CLOSE_DAYS;
  if (!raw) return DEFAULT_THRESHOLD_DAYS;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_THRESHOLD_DAYS;
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
