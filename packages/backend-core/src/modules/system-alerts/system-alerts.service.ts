import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, desc, eq, gt, isNull, or, sql } from 'drizzle-orm';
import { schema, makeId } from '@getmunin/db';
import { getCurrentContext, parseEnvInt, WebhookDispatcher } from '@getmunin/core';

export const ALERT_SOURCES = [
  'llm_provider',
  'channel_inbound',
  'channel_outbound',
  'curator',
  'delivery',
  'quota',
  'social',
  'data_protection',
] as const;
export type AlertSource = (typeof ALERT_SOURCES)[number];

export const ALERT_SEVERITIES = ['warning', 'error'] as const;
export type AlertSeverity = (typeof ALERT_SEVERITIES)[number];

export interface AlertDto {
  id: string;
  source: AlertSource;
  subjectId: string | null;
  userId: string | null;
  severity: AlertSeverity;
  title: string;
  detail: string | null;
  metadata: Record<string, unknown>;
  ctaHref: string | null;
  ctaLabelKey: string | null;
  openedAt: string;
  lastSeenAt: string;
  occurrenceCount: number;
  acknowledgedAt: string | null;
  acknowledgedBy: string | null;
  resolvedAt: string | null;
}

export interface OpenAlertInput {
  source: AlertSource;
  subjectId?: string | null;
  userId?: string | null;
  severity: AlertSeverity;
  title: string;
  detail?: string | null;
  metadata?: Record<string, unknown>;
  ctaHref?: string | null;
  ctaLabelKey?: string | null;
}

export interface OpenAlertResult {
  alertId: string;
  opened: boolean;
  reopened: boolean;
  occurrenceCount: number;
}

export interface ResolveAlertInput {
  source: AlertSource;
  subjectId?: string | null;
  userId?: string | null;
}

export interface ResolveAlertResult {
  alertId: string | null;
  resolved: boolean;
}

export class AlertNotFoundError extends Error {
  readonly code = 'alert_not_found';
  constructor(id: string) {
    super(`alert_not_found: no alert with id ${id}`);
  }
}

const MAX_DETAIL_CHARS = 1000;
const DEFAULT_REOPEN_WINDOW_MS = 6 * 60 * 60_000;

export function alertReopenWindowMs(): number {
  return parseEnvInt({
    name: 'MUNIN_ALERT_REOPEN_WINDOW_MS',
    default: DEFAULT_REOPEN_WINDOW_MS,
    min: 0,
  });
}

@Injectable()
export class AlertsService {
  private readonly log = new Logger(AlertsService.name);

  constructor(
    @Inject(WebhookDispatcher) private readonly webhooks: WebhookDispatcher,
  ) {}

  async openAlert(input: OpenAlertInput): Promise<OpenAlertResult> {
    const ctx = getCurrentContext();
    const orgId = ctx.actor!.orgId;
    const subjectId = input.subjectId ?? null;
    const userId = input.userId ?? null;
    const detail = truncate(input.detail);
    const metadata = input.metadata ?? {};

    const existing = await ctx.db
      .select({ id: schema.orgAlerts.id, occurrenceCount: schema.orgAlerts.occurrenceCount })
      .from(schema.orgAlerts)
      .where(
        and(
          eq(schema.orgAlerts.orgId, orgId),
          eq(schema.orgAlerts.source, input.source),
          isNull(schema.orgAlerts.resolvedAt),
          subjectId === null
            ? isNull(schema.orgAlerts.subjectId)
            : eq(schema.orgAlerts.subjectId, subjectId),
          sameUser(userId),
        ),
      )
      .limit(1);

    const open = existing[0];
    const target = open ?? (await this.recentlyResolved(orgId, input.source, subjectId, userId));
    if (target) {
      const reopened = !open;
      const nextCount = target.occurrenceCount + 1;
      await ctx.db
        .update(schema.orgAlerts)
        .set({
          severity: input.severity,
          title: input.title,
          detail,
          metadata,
          ctaHref: input.ctaHref ?? null,
          ctaLabelKey: input.ctaLabelKey ?? null,
          lastSeenAt: new Date(),
          occurrenceCount: nextCount,
          ...(reopened ? { resolvedAt: null, acknowledgedAt: null, acknowledgedBy: null } : {}),
          updatedAt: new Date(),
        })
        .where(eq(schema.orgAlerts.id, target.id));
      if (!reopened) {
        this.log.debug(
          `alert bumped id=${target.id} source=${input.source} subject=${subjectId ?? 'none'} count=${nextCount}`,
        );
        return { alertId: target.id, opened: false, reopened, occurrenceCount: nextCount };
      }
      this.log.warn(
        `alert reopened id=${target.id} source=${input.source} subject=${subjectId ?? 'none'} count=${nextCount}`,
      );
      await this.webhooks.emit({
        type: 'org_alert.opened',
        payload: {
          alertId: target.id,
          source: input.source,
          subjectId,
          userId,
          severity: input.severity,
          reopened,
        },
      });
      return { alertId: target.id, opened: false, reopened, occurrenceCount: nextCount };
    }

    const id = makeId('alr');
    await ctx.db.insert(schema.orgAlerts).values({
      id,
      orgId,
      source: input.source,
      subjectId,
      userId,
      severity: input.severity,
      title: input.title,
      detail,
      metadata,
      ctaHref: input.ctaHref ?? null,
      ctaLabelKey: input.ctaLabelKey ?? null,
    });
    this.log.warn(
      `alert opened id=${id} source=${input.source} subject=${subjectId ?? 'none'} severity=${input.severity}`,
    );
    await this.webhooks.emit({
      type: 'org_alert.opened',
      payload: {
        alertId: id,
        source: input.source,
        subjectId,
        userId,
        severity: input.severity,
        reopened: false,
      },
    });
    return { alertId: id, opened: true, reopened: false, occurrenceCount: 1 };
  }

  private async recentlyResolved(
    orgId: string,
    source: AlertSource,
    subjectId: string | null,
    userId: string | null,
  ): Promise<{ id: string; occurrenceCount: number } | null> {
    const windowMs = alertReopenWindowMs();
    if (windowMs === 0) return null;
    const ctx = getCurrentContext();
    const rows = await ctx.db
      .select({ id: schema.orgAlerts.id, occurrenceCount: schema.orgAlerts.occurrenceCount })
      .from(schema.orgAlerts)
      .where(
        and(
          eq(schema.orgAlerts.orgId, orgId),
          eq(schema.orgAlerts.source, source),
          gt(schema.orgAlerts.resolvedAt, sql`now() - ${windowMs} * interval '1 millisecond'`),
          subjectId === null
            ? isNull(schema.orgAlerts.subjectId)
            : eq(schema.orgAlerts.subjectId, subjectId),
          sameUser(userId),
        ),
      )
      .orderBy(desc(schema.orgAlerts.resolvedAt))
      .limit(1);
    return rows[0] ?? null;
  }

  async updateMetadata(alertId: string, patch: Record<string, unknown>): Promise<void> {
    const ctx = getCurrentContext();
    const orgId = ctx.actor!.orgId;
    const rows = await ctx.db
      .select({ metadata: schema.orgAlerts.metadata })
      .from(schema.orgAlerts)
      .where(and(eq(schema.orgAlerts.id, alertId), eq(schema.orgAlerts.orgId, orgId)))
      .limit(1);
    const prior = rows[0];
    if (!prior) return;
    await ctx.db
      .update(schema.orgAlerts)
      .set({ metadata: { ...prior.metadata, ...patch }, updatedAt: new Date() })
      .where(eq(schema.orgAlerts.id, alertId));
  }

  async setTitle(alertId: string, title: string): Promise<void> {
    const ctx = getCurrentContext();
    const orgId = ctx.actor!.orgId;
    await ctx.db
      .update(schema.orgAlerts)
      .set({ title, updatedAt: new Date() })
      .where(and(eq(schema.orgAlerts.id, alertId), eq(schema.orgAlerts.orgId, orgId)));
  }

  async resolveAlert(input: ResolveAlertInput): Promise<ResolveAlertResult> {
    const ctx = getCurrentContext();
    const orgId = ctx.actor!.orgId;
    const subjectId = input.subjectId ?? null;
    const userId = input.userId ?? null;

    const updated = await ctx.db
      .update(schema.orgAlerts)
      .set({ resolvedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(schema.orgAlerts.orgId, orgId),
          eq(schema.orgAlerts.source, input.source),
          isNull(schema.orgAlerts.resolvedAt),
          subjectId === null
            ? isNull(schema.orgAlerts.subjectId)
            : eq(schema.orgAlerts.subjectId, subjectId),
          sameUser(userId),
        ),
      )
      .returning({ id: schema.orgAlerts.id });

    const row = updated[0];
    if (!row) return { alertId: null, resolved: false };

    this.log.log(`alert resolved id=${row.id} source=${input.source} subject=${subjectId ?? 'none'}`);
    await this.webhooks.emit({
      type: 'org_alert.resolved',
      payload: {
        alertId: row.id,
        source: input.source,
        subjectId,
        userId,
      },
    });
    return { alertId: row.id, resolved: true };
  }

  async acknowledgeAlert(alertId: string): Promise<AlertDto> {
    const ctx = getCurrentContext();
    const actorId = ctx.actor!.id;
    const orgId = ctx.actor!.orgId;

    const updated = await ctx.db
      .update(schema.orgAlerts)
      .set({ acknowledgedAt: new Date(), acknowledgedBy: actorId, updatedAt: new Date() })
      .where(
        and(
          eq(schema.orgAlerts.id, alertId),
          eq(schema.orgAlerts.orgId, orgId),
          visibleTo(ctx.actor!.userId),
        ),
      )
      .returning();

    const row = updated[0];
    if (!row) throw new AlertNotFoundError(alertId);

    await this.webhooks.emit({
      type: 'org_alert.acknowledged',
      payload: {
        alertId: row.id,
        source: row.source,
        subjectId: row.subjectId,
      },
    });
    return toDto(row);
  }

  async get(alertId: string): Promise<AlertDto> {
    const ctx = getCurrentContext();
    const rows = await ctx.db
      .select()
      .from(schema.orgAlerts)
      .where(
        and(
          eq(schema.orgAlerts.id, alertId),
          eq(schema.orgAlerts.orgId, ctx.actor!.orgId),
          visibleTo(ctx.actor!.userId),
        ),
      )
      .limit(1);
    const row = rows[0];
    if (!row) throw new AlertNotFoundError(alertId);
    return toDto(row);
  }

  async listOpen(): Promise<AlertDto[]> {
    const ctx = getCurrentContext();
    const rows = await ctx.db
      .select()
      .from(schema.orgAlerts)
      .where(and(isNull(schema.orgAlerts.resolvedAt), visibleTo(ctx.actor!.userId)))
      .orderBy(desc(schema.orgAlerts.severity), desc(schema.orgAlerts.openedAt));
    return rows.map(toDto);
  }

  async list(opts?: {
    includeResolved?: boolean;
    limit?: number;
    source?: AlertSource;
  }): Promise<AlertDto[]> {
    const ctx = getCurrentContext();
    const limit = Math.min(opts?.limit ?? 50, 200);
    const includeResolved = opts?.includeResolved ?? false;
    const conditions = [visibleTo(ctx.actor!.userId)];
    if (!includeResolved) conditions.push(isNull(schema.orgAlerts.resolvedAt));
    if (opts?.source) conditions.push(eq(schema.orgAlerts.source, opts.source));
    const where = conditions.length === 1 ? conditions[0] : and(...conditions);
    const rows = await ctx.db
      .select()
      .from(schema.orgAlerts)
      .where(where)
      .orderBy(desc(schema.orgAlerts.openedAt))
      .limit(limit);
    return rows.map(toDto);
  }
}

function sameUser(userId: string | null) {
  return sql`${schema.orgAlerts.userId} IS NOT DISTINCT FROM ${userId}`;
}

function visibleTo(viewerUserId: string | undefined) {
  if (!viewerUserId) return isNull(schema.orgAlerts.userId);
  return or(isNull(schema.orgAlerts.userId), eq(schema.orgAlerts.userId, viewerUserId))!;
}

function truncate(message: string | null | undefined): string | null {
  if (!message) return null;
  return message.length > MAX_DETAIL_CHARS ? `${message.slice(0, MAX_DETAIL_CHARS)}…` : message;
}

function toDto(row: typeof schema.orgAlerts.$inferSelect): AlertDto {
  return {
    id: row.id,
    source: row.source as AlertSource,
    subjectId: row.subjectId,
    userId: row.userId,
    severity: row.severity as AlertSeverity,
    title: row.title,
    detail: row.detail,
    metadata: row.metadata,
    ctaHref: row.ctaHref,
    ctaLabelKey: row.ctaLabelKey,
    openedAt: row.openedAt.toISOString(),
    lastSeenAt: row.lastSeenAt.toISOString(),
    occurrenceCount: row.occurrenceCount,
    acknowledgedAt: row.acknowledgedAt ? row.acknowledgedAt.toISOString() : null,
    acknowledgedBy: row.acknowledgedBy,
    resolvedAt: row.resolvedAt ? row.resolvedAt.toISOString() : null,
  };
}
