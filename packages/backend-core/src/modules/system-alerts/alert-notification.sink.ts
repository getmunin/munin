import { Injectable, Logger } from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';
import { makeId, schema } from '@getmunin/db';
import { getCurrentContext, type EmittedEvent, type EventSink } from '@getmunin/core';
import type { AlertSeverity, AlertSource } from './system-alerts.service.ts';

export interface NotifyRule {
  minSeverity: AlertSeverity;
}

export const NOTIFY_POLICY: Record<AlertSource, NotifyRule | null> = {
  llm_provider: { minSeverity: 'error' },
  channel_inbound: { minSeverity: 'error' },
  channel_outbound: { minSeverity: 'error' },
  curator: null,
  delivery: { minSeverity: 'error' },
  quota: { minSeverity: 'warning' },
  social: { minSeverity: 'warning' },
};

const SEVERITY_RANK: Record<AlertSeverity, number> = { warning: 1, error: 2 };

export function shouldNotify(source: string, severity: string): boolean {
  const rule = NOTIFY_POLICY[source as AlertSource];
  if (!rule) return false;
  const actual = SEVERITY_RANK[severity as AlertSeverity];
  const required = SEVERITY_RANK[rule.minSeverity];
  if (!actual || !required) return false;
  return actual >= required;
}

export function alertEmailsDisabled(): boolean {
  const raw = (process.env.MUNIN_ALERT_EMAILS_DISABLED ?? '').trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes';
}

@Injectable()
export class AlertNotificationSink implements EventSink {
  private readonly log = new Logger(AlertNotificationSink.name);

  async onEvent(event: EmittedEvent): Promise<void> {
    if (event.type !== 'org_alert.opened') return;
    if (alertEmailsDisabled()) return;

    const source = typeof event.payload.source === 'string' ? event.payload.source : '';
    const severity = typeof event.payload.severity === 'string' ? event.payload.severity : '';
    if (!shouldNotify(source, severity)) return;

    const alertId = typeof event.payload.alertId === 'string' ? event.payload.alertId : null;
    if (!alertId) return;
    const userId = typeof event.payload.userId === 'string' ? event.payload.userId : null;

    const ctx = getCurrentContext();
    const recipients = userId
      ? await this.affectedMember(userId)
      : await this.owners(event.orgId);
    if (recipients.length === 0) {
      this.log.warn(`alert ${alertId} has no notifiable recipient (org=${event.orgId})`);
      return;
    }

    await ctx.db
      .insert(schema.alertNotifications)
      .values(
        recipients.map((recipient) => ({
          id: makeId('alnf'),
          orgId: event.orgId,
          alertId,
          recipientUserId: recipient.id,
          email: recipient.email,
        })),
      )
      .onConflictDoNothing();
  }

  private async affectedMember(userId: string): Promise<{ id: string; email: string }[]> {
    const ctx = getCurrentContext();
    const rows = await ctx.db
      .select({ id: schema.users.id, email: schema.users.email })
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .limit(1);
    return rows.filter((row) => !!row.email);
  }

  private async owners(orgId: string): Promise<{ id: string; email: string }[]> {
    const ctx = getCurrentContext();
    const members = await ctx.db
      .select({ userId: schema.orgMembers.userId })
      .from(schema.orgMembers)
      .where(and(eq(schema.orgMembers.orgId, orgId), eq(schema.orgMembers.role, 'owner')));
    if (members.length === 0) return [];
    const rows = await ctx.db
      .select({ id: schema.users.id, email: schema.users.email })
      .from(schema.users)
      .where(
        inArray(
          schema.users.id,
          members.map((member) => member.userId),
        ),
      );
    return rows.filter((row) => !!row.email);
  }
}
