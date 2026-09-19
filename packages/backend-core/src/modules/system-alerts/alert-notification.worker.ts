import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { schema, type Db } from '@getmunin/db';
import { and, asc, eq, isNull, lt, lte } from 'drizzle-orm';
import { parseEnvDisableFlag, parseEnvInt, type Mailer } from '@getmunin/core';
import { renderSystemAlertEmail } from '@getmunin/emails';
import { DB } from '../../common/db/db.module.ts';
import { MAILER } from '../../common/mail/mail.module.ts';
import { withSchedulerLock } from '../../common/scheduler-lock/index.ts';
import { absoluteWebUrl } from '../../common/web-url.ts';
import { alertEmailsDisabled } from './alert-notification.sink.ts';
import type { AlertSeverity } from './system-alerts.service.ts';

const DEFAULT_INTERVAL_MS = 30_000;
const BATCH_SIZE = 25;
export const MAX_NOTIFY_ATTEMPTS = 5;
const BACKOFF_BASE_MS = 30_000;

export interface AlertNotificationTickResult {
  sent: number;
  failed: number;
}

interface DueNotification {
  id: string;
  orgId: string;
  alertId: string;
  recipientUserId: string;
  email: string;
  attempt: number;
}

@Injectable()
export class AlertNotificationWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AlertNotificationWorker.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private readonly disabled =
    parseEnvDisableFlag('MUNIN_ALERT_NOTIFY_WORKER_DISABLED') || process.env.NODE_ENV === 'test';
  private readonly intervalMs = parseEnvInt({
    name: 'MUNIN_ALERT_NOTIFY_POLL_MS',
    default: DEFAULT_INTERVAL_MS,
  });

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(MAILER) private readonly mailer: Mailer,
  ) {}

  onModuleInit(): void {
    if (this.disabled) return;
    this.logger.log(`alert notification worker starting (every ${this.intervalMs}ms)`);
    this.timer = setInterval(() => {
      void withSchedulerLock(this.db, 'alert-notification-worker', () => this.tick());
    }, this.intervalMs);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async tick(): Promise<AlertNotificationTickResult> {
    if (this.running) return { sent: 0, failed: 0 };
    this.running = true;
    try {
      return await this.drain();
    } finally {
      this.running = false;
    }
  }

  private async drain(): Promise<AlertNotificationTickResult> {
    if (alertEmailsDisabled()) return { sent: 0, failed: 0 };
    const due = await this.dueNotifications();
    let sent = 0;
    let failed = 0;
    for (const row of due) {
      const ok = await this.attemptOne(row);
      if (ok) sent += 1;
      else failed += 1;
    }
    return { sent, failed };
  }

  private async dueNotifications(): Promise<DueNotification[]> {
    return await this.db
      .select({
        id: schema.alertNotifications.id,
        orgId: schema.alertNotifications.orgId,
        alertId: schema.alertNotifications.alertId,
        recipientUserId: schema.alertNotifications.recipientUserId,
        email: schema.alertNotifications.email,
        attempt: schema.alertNotifications.attempt,
      })
      .from(schema.alertNotifications)
      .where(
        and(
          isNull(schema.alertNotifications.deliveredAt),
          lt(schema.alertNotifications.attempt, MAX_NOTIFY_ATTEMPTS),
          lte(schema.alertNotifications.nextAttemptAt, new Date()),
        ),
      )
      .orderBy(asc(schema.alertNotifications.nextAttemptAt))
      .limit(BATCH_SIZE);
  }

  private async attemptOne(row: DueNotification): Promise<boolean> {
    try {
      const rendered = await this.render(row);
      if (!rendered) {
        await this.finish(row, null);
        return true;
      }
      await this.mailer.send({
        to: row.email,
        subject: rendered.subject,
        text: rendered.text,
        html: rendered.html,
      });
      await this.finish(row, null);
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`alert notification ${row.id} failed: ${message}`);
      await this.finish(row, message);
      return false;
    }
  }

  private async render(
    row: DueNotification,
  ): Promise<{ subject: string; text: string; html: string } | null> {
    const alerts = await this.db
      .select({
        source: schema.orgAlerts.source,
        severity: schema.orgAlerts.severity,
        title: schema.orgAlerts.title,
        detail: schema.orgAlerts.detail,
        ctaHref: schema.orgAlerts.ctaHref,
        userId: schema.orgAlerts.userId,
        resolvedAt: schema.orgAlerts.resolvedAt,
      })
      .from(schema.orgAlerts)
      .where(eq(schema.orgAlerts.id, row.alertId))
      .limit(1);
    const alert = alerts[0];
    if (!alert || alert.resolvedAt !== null) return null;

    const orgs = await this.db
      .select({ name: schema.orgs.name })
      .from(schema.orgs)
      .where(eq(schema.orgs.id, row.orgId))
      .limit(1);

    return await renderSystemAlertEmail({
      alertTitle: alert.title,
      alertDetail: alert.detail,
      severity: alert.severity as AlertSeverity,
      source: alert.source,
      orgName: orgs[0]?.name ?? 'your organisation',
      personal: alert.userId !== null,
      ctaHref: alert.ctaHref ? absoluteWebUrl(alert.ctaHref, row.orgId) : null,
    });
  }

  private async finish(row: DueNotification, error: string | null): Promise<void> {
    const nextAttempt = row.attempt + 1;
    const final = error === null || nextAttempt >= MAX_NOTIFY_ATTEMPTS;
    const backoff = BACKOFF_BASE_MS * 2 ** row.attempt;
    const jitter = Math.floor(backoff * 0.1 * Math.random());
    await this.db
      .update(schema.alertNotifications)
      .set({
        attempt: nextAttempt,
        error,
        deliveredAt: final ? new Date() : null,
        nextAttemptAt: final ? new Date() : new Date(Date.now() + backoff + jitter),
      })
      .where(eq(schema.alertNotifications.id, row.id));
  }
}
