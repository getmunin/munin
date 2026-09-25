import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { Db } from '@getmunin/db';
import {
  ActorIdentity,
  parseEnvDisableFlag,
  parseEnvInt,
  withContext,
  type RequestContext,
} from '@getmunin/core';
import { DB } from '../../common/db/db.module.ts';
import { withSchedulerLock } from '../../common/scheduler-lock/index.ts';
import { AlertsService } from '../system-alerts/system-alerts.service.ts';
import { isPiiNerEnabled } from './pii-config.ts';
import { resultRows } from './rows.ts';

export const PII_BACKLOG_ALERT_SUBJECT = 'pii:ner-backlog';

const DEFAULT_INTERVAL_MS = 3_600_000;
const DEFAULT_BACKLOG_HOURS = 24;

interface AlertOpener {
  openAlert: AlertsService['openAlert'];
  resolveAlert: AlertsService['resolveAlert'];
}

@Injectable()
export class PiiCoverageMonitor implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PiiCoverageMonitor.name);
  private timer: NodeJS.Timeout | null = null;
  private readonly disabled =
    parseEnvDisableFlag('MUNIN_PII_COVERAGE_MONITOR_DISABLED') || process.env.NODE_ENV === 'test';
  private readonly intervalMs = parseEnvInt({
    name: 'MUNIN_PII_COVERAGE_MONITOR_INTERVAL_MS',
    default: DEFAULT_INTERVAL_MS,
  });
  private readonly backlogHours = parseEnvInt({
    name: 'MUNIN_PII_BACKLOG_ALERT_HOURS',
    default: DEFAULT_BACKLOG_HOURS,
  });

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(AlertsService) private readonly alerts: AlertOpener,
  ) {}

  onModuleInit(): void {
    if (this.disabled) return;
    this.timer = setInterval(() => {
      void withSchedulerLock(this.db, 'pii-coverage-monitor', () => this.tick());
    }, this.intervalMs);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async tick(): Promise<{ alerted: number; resolved: number }> {
    if (!isPiiNerEnabled()) return { alerted: 0, resolved: 0 };
    const behind = await this.orgsBehind();
    const alerted = new Set(await this.orgsWithOpenAlert());
    let resolved = 0;
    for (const [orgId, count] of behind) {
      await this.inOrg(orgId, () =>
        this.alerts.openAlert({
          source: 'data_protection',
          subjectId: PII_BACKLOG_ALERT_SUBJECT,
          severity: 'warning',
          title: 'Name detection is falling behind',
          detail:
            `${count} message(s) older than ${this.backlogHours} hours have not been through name detection. ` +
            'MCP results that include them report coverage as pending, and third parties named in them are not masked. ' +
            'Check that the annotation worker is running and can reach the backend.',
          metadata: { unannotated: count, olderThanHours: this.backlogHours },
          ctaHref: '/dashboard/settings/privacy',
        }),
      );
    }
    for (const orgId of alerted) {
      if (behind.has(orgId)) continue;
      const result = await this.inOrg(orgId, () =>
        this.alerts.resolveAlert({ source: 'data_protection', subjectId: PII_BACKLOG_ALERT_SUBJECT }),
      );
      if (result.resolved) resolved += 1;
    }
    if (behind.size > 0) this.logger.warn(`name detection behind in ${behind.size} org(s)`);
    return { alerted: behind.size, resolved };
  }

  private async orgsBehind(): Promise<Map<string, number>> {
    const rows = await this.db.execute(sql`
      SELECT m.org_id, count(*)::int AS unannotated
      FROM conv_messages m
      LEFT JOIN pii_message_annotations a ON a.message_id = m.id AND a.ner_version IS NOT NULL
      WHERE a.message_id IS NULL
        AND m.created_at < now() - make_interval(hours => ${this.backlogHours})
      GROUP BY m.org_id
    `);
    return new Map(
      resultRows<{ org_id: string; unannotated: number }>(rows).map((r) => [r.org_id, r.unannotated]),
    );
  }

  private async orgsWithOpenAlert(): Promise<string[]> {
    const rows = await this.db.execute(sql`
      SELECT DISTINCT org_id FROM org_alerts
      WHERE source = 'data_protection' AND subject_id = ${PII_BACKLOG_ALERT_SUBJECT} AND resolved_at IS NULL
    `);
    return resultRows<{ org_id: string }>(rows).map((r) => r.org_id);
  }

  private async inOrg<T>(orgId: string, fn: () => Promise<T>): Promise<T> {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.bypass_rls', 'off', true)`);
      await tx.execute(sql`SELECT set_config('app.org_id', ${orgId}, true)`);
      await tx.execute(sql`SELECT set_config('app.end_user_id', '', true)`);
      const actor = new ActorIdentity('system', 'pii-coverage-monitor', orgId, ['*'], ['admin']);
      const ctx: RequestContext = { db: tx, actor, correlationId: randomUUID() };
      return withContext(ctx, fn);
    });
  }
}
