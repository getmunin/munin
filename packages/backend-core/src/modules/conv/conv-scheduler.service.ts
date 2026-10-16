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
import { CONV_SCHEDULER_ACTOR } from '@getmunin/types';
import { randomUUID } from 'node:crypto';
import { DB } from '../../common/db/db.module.ts';
import { withSchedulerLock } from '../../common/scheduler-lock/index.ts';
import { ConvService } from './conv.service.ts';

const DEFAULT_THRESHOLD_DAYS = 2;
const DEFAULT_UNENGAGED_IDLE_HOURS = 24;

@Injectable()
export class ConvSchedulerService implements OnModuleInit {
  private readonly logger = new Logger(ConvSchedulerService.name);
  private readonly disabled =
    parseEnvDisableFlag('MUNIN_CONV_AUTO_CLOSE_DISABLED') ||
    process.env.NODE_ENV === 'test';
  private readonly thresholdDays = parsePositive(
    'MUNIN_CONV_AUTO_CLOSE_DAYS',
    DEFAULT_THRESHOLD_DAYS,
  );
  private readonly unengagedIdleHours = parsePositive(
    'MUNIN_CONV_UNENGAGED_IDLE_HOURS',
    DEFAULT_UNENGAGED_IDLE_HOURS,
  );

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
    this.scheduleAutoClose();
    this.scheduleUnengagedCleanup();
  }

  private scheduleAutoClose(): void {
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

  private scheduleUnengagedCleanup(): void {
    const cron = parseEnvCron({
      name: 'MUNIN_CONV_UNENGAGED_CLEANUP_CRON',
      default: CronExpression.EVERY_HOUR,
    });
    if (cron === null) {
      this.logger.log('conv unengaged cleanup disabled by env');
      return;
    }

    const job = new CronJob(cron, () => {
      void withSchedulerLock(this.db, 'conv-scheduler:unengaged-cleanup', () =>
        this.runUnengagedCleanup(),
      );
    });
    this.registry.addCronJob('conv-unengaged-cleanup', job);
    job.start();
    this.logger.log(
      `conv unengaged cleanup scheduled with "${cron}" (idle ${this.unengagedIdleHours}h)`,
    );
  }

  private async runSweep(): Promise<void> {
    await this.forEachOrg('auto-close', async (orgId) => {
      const closed = await this.conv.autoCloseInactive({ thresholdDays: this.thresholdDays });
      if (closed > 0) {
        this.logger.log(`conv auto-close closed ${closed} conversation(s) for org ${orgId}`);
      }
    });
  }

  private async runUnengagedCleanup(): Promise<void> {
    await this.forEachOrg('unengaged cleanup', async (orgId) => {
      const deleted = await this.conv.deleteUnengagedConversations({
        idleHours: this.unengagedIdleHours,
      });
      if (deleted > 0) {
        this.logger.log(
          `conv unengaged cleanup deleted ${deleted} conversation(s) for org ${orgId}`,
        );
      }
    });
  }

  private async forEachOrg(label: string, run: (orgId: string) => Promise<void>): Promise<void> {
    const orgs = await this.db.select({ id: schema.orgs.id }).from(schema.orgs);
    for (const org of orgs) {
      try {
        await this.runForOrg(org.id, () => run(org.id));
      } catch (err) {
        this.logger.warn(`conv ${label} failed for org ${org.id}: ${describe(err)}`);
      }
    }
  }

  private async runForOrg(orgId: string, run: () => Promise<void>): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.bypass_rls', 'off', true)`);
      await tx.execute(sql`SELECT set_config('app.org_id', ${orgId}, true)`);
      await tx.execute(sql`SELECT set_config('app.end_user_id', '', true)`);
      const actor = new ActorIdentity(
        'admin_agent',
        CONV_SCHEDULER_ACTOR,
        orgId,
        ['*'],
        ['admin'],
      );
      const ctx: RequestContext = { db: tx, actor, correlationId: randomUUID() };
      await RequestContextStore.run(ctx, run);
    });
  }
}

function parsePositive(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
