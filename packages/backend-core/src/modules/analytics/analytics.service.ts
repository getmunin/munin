import { Inject, Injectable, Logger } from '@nestjs/common';
import { schema, type Db } from '@getmunin/db';
import { and, asc, eq, sql } from 'drizzle-orm';
import { getCurrentContext } from '@getmunin/core';
import { DB } from '../../common/db/db.module.ts';
import {
  decodeCursor,
  encodeCursor,
  newImportResult,
  redactSecrets,
  resolveId,
} from '../../common/transfer/transfer.helpers.ts';
import {
  type CursorInput,
  type ExportPage,
  type IdMap,
  type ImportResult,
  REDACTED,
} from '../../common/transfer/transfer.types.ts';

const ANALYTICS_MODULE = 'analytics';
const DEFAULT_EVENT_PAGE_SIZE = 200;

export interface AnalyticsTrackerExport {
  id: string;
  name: string;
  allowedOrigins: string[];
  requireVerifiedIdentity: boolean;
  identityVerificationSecret: string | null;
}

export interface AnalyticsVisitorIdentityExport {
  id: string;
  visitorId: string;
  endUserId: string;
}

export interface AnalyticsConfigExport {
  trackers: AnalyticsTrackerExport[];
  visitorIdentities: AnalyticsVisitorIdentityExport[];
}

export interface AnalyticsViewEventExport {
  id: string;
  subjectType: string;
  subjectId: string;
  source: string;
  path: string | null;
  locale: string | null;
  referrer: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  visitorId: string | null;
  endUserId: string | null;
  userAgentClass: string | null;
  dwellMs: number | null;
  readDepth: number | null;
  country: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export interface AnalyticsSearchEventExport {
  id: string;
  subjectType: string;
  query: string;
  locale: string | null;
  resultCount: number;
  visitorId: string | null;
  endUserId: string | null;
  createdAt: string;
}

export interface AnalyticsEventsExport {
  viewEvents: AnalyticsViewEventExport[];
  searchEvents: AnalyticsSearchEventExport[];
}

export interface AnalyticsImportData {
  config?: {
    trackers: Array<{
      id: string;
      name: string;
      allowedOrigins: string[];
      requireVerifiedIdentity: boolean;
      identityVerificationSecret?: string | null;
    }>;
    visitorIdentities: AnalyticsVisitorIdentityExport[];
  };
  events?: {
    viewEvents: Array<
      Omit<AnalyticsViewEventExport, 'path' | 'locale' | 'referrer' | 'utmSource' | 'utmMedium' | 'utmCampaign' | 'visitorId' | 'endUserId' | 'userAgentClass' | 'dwellMs' | 'readDepth' | 'country' | 'metadata'> & {
        path?: string | null;
        locale?: string | null;
        referrer?: string | null;
        utmSource?: string | null;
        utmMedium?: string | null;
        utmCampaign?: string | null;
        visitorId?: string | null;
        endUserId?: string | null;
        userAgentClass?: string | null;
        dwellMs?: number | null;
        readDepth?: number | null;
        country?: string | null;
        metadata?: Record<string, unknown> | null;
      }
    >;
    searchEvents: Array<
      Omit<AnalyticsSearchEventExport, 'locale' | 'visitorId' | 'endUserId'> & {
        locale?: string | null;
        visitorId?: string | null;
        endUserId?: string | null;
      }
    >;
  };
}

export interface RecordViewInput {
  orgId: string;
  subjectType: string;
  subjectId: string;
  source: 'pixel' | 'beacon' | 'tracker';
  path?: string | null;
  locale?: string | null;
  referrer?: string | null;
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  visitorId?: string | null;
  userAgentClass?: string | null;
  dwellMs?: number | null;
  readDepth?: number | null;
  country?: string | null;
  metadata?: Record<string, unknown> | null;
  requireVerifiedIdentity?: boolean;
}

export interface RecordSearchInput {
  orgId: string;
  subjectType: string;
  query: string;
  resultCount: number;
  locale?: string | null;
  visitorId?: string | null;
  requireVerifiedIdentity?: boolean;
}

@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);

  constructor(@Inject(DB) private readonly db: Db) {}

  async recordView(input: RecordViewInput): Promise<void> {
    try {
      const visitorId = truncate(input.visitorId, 64);
      const endUserId = await this.resolveEndUserId(input.orgId, visitorId);
      if (input.requireVerifiedIdentity && !endUserId) return;
      await this.db.insert(schema.analyticsViewEvents).values({
        orgId: input.orgId,
        subjectType: input.subjectType.slice(0, 32),
        subjectId: input.subjectId,
        source: input.source,
        path: truncate(input.path, 512),
        locale: truncate(input.locale, 16),
        referrer: truncate(input.referrer, 512),
        utmSource: truncate(input.utmSource, 128),
        utmMedium: truncate(input.utmMedium, 128),
        utmCampaign: truncate(input.utmCampaign, 128),
        visitorId,
        endUserId,
        userAgentClass: truncate(input.userAgentClass, 16),
        dwellMs: clampInt(input.dwellMs, 0, 24 * 60 * 60 * 1000),
        readDepth: clampInt(input.readDepth, 0, 100),
        country: normalizeCountry(input.country),
        metadata: input.metadata ?? null,
      });
    } catch (err) {
      this.logger.warn(`analytics.view.record_failed: ${(err as Error).message}`);
    }
  }

  async recordSearch(input: RecordSearchInput): Promise<void> {
    try {
      const q = input.query.trim();
      if (!q) return;
      const visitorId = truncate(input.visitorId, 64);
      const endUserId = await this.resolveEndUserId(input.orgId, visitorId);
      if (input.requireVerifiedIdentity && !endUserId) return;
      await this.db.insert(schema.analyticsSearchEvents).values({
        orgId: input.orgId,
        subjectType: input.subjectType.slice(0, 32),
        query: q.slice(0, 256),
        locale: truncate(input.locale, 16),
        resultCount: Math.max(0, Math.floor(input.resultCount)),
        visitorId,
        endUserId,
      });
    } catch (err) {
      this.logger.warn(`analytics.search.record_failed: ${(err as Error).message}`);
    }
  }

  private async resolveEndUserId(
    orgId: string,
    visitorId: string | null,
  ): Promise<string | null> {
    if (!visitorId) return null;
    try {
      const rows = await this.db
        .select({ endUserId: schema.analyticsVisitorIdentities.endUserId })
        .from(schema.analyticsVisitorIdentities)
        .where(
          and(
            eq(schema.analyticsVisitorIdentities.orgId, orgId),
            eq(schema.analyticsVisitorIdentities.visitorId, visitorId),
          ),
        )
        .limit(1);
      return rows[0]?.endUserId ?? null;
    } catch {
      return null;
    }
  }

  // ─── Transfer (import / export) ──────────────────────────────────────────

  async exportAnalyticsConfig(): Promise<AnalyticsConfigExport> {
    const ctx = getCurrentContext();
    const [trackers, identities] = await Promise.all([
      ctx.db
        .select()
        .from(schema.analyticsTrackers)
        .orderBy(asc(schema.analyticsTrackers.createdAt)),
      ctx.db
        .select()
        .from(schema.analyticsVisitorIdentities)
        .orderBy(asc(schema.analyticsVisitorIdentities.createdAt)),
    ]);
    return {
      trackers: trackers.map((t) =>
        redactSecrets(
          {
            id: t.id,
            name: t.name,
            allowedOrigins: t.allowedOrigins,
            requireVerifiedIdentity: t.requireVerifiedIdentity,
            identityVerificationSecret: t.identityVerificationSecret,
          },
          ['identityVerificationSecret'],
        ),
      ),
      visitorIdentities: identities.map((i) => ({
        id: i.id,
        visitorId: i.visitorId,
        endUserId: i.endUserId,
      })),
    };
  }

  async exportAnalyticsEvents(
    input: CursorInput = {},
  ): Promise<ExportPage<AnalyticsEventsExport>> {
    const ctx = getCurrentContext();
    const actor = ctx.actor!;
    const limit = input.limit ?? DEFAULT_EVENT_PAGE_SIZE;
    const decoded = decodeCursor(input.cursor);
    const after = decoded
      ? sql`AND (created_at, id) > (${decoded.createdAt}::timestamptz, ${decoded.id})`
      : sql``;
    const rows = await ctx.db.execute<{
      kind: 'view' | 'search';
      id: string;
      created_at: Date | string;
      subject_type: string;
      subject_id: string | null;
      source: string | null;
      path: string | null;
      locale: string | null;
      referrer: string | null;
      utm_source: string | null;
      utm_medium: string | null;
      utm_campaign: string | null;
      visitor_id: string | null;
      end_user_id: string | null;
      user_agent_class: string | null;
      dwell_ms: number | null;
      read_depth: number | null;
      country: string | null;
      metadata: Record<string, unknown> | null;
      query: string | null;
      result_count: number | null;
    }>(sql`
      SELECT * FROM (
        SELECT 'view'::text AS kind, id, created_at, subject_type, subject_id,
               source, path, locale, referrer, utm_source, utm_medium, utm_campaign,
               visitor_id, end_user_id, user_agent_class, dwell_ms, read_depth,
               country, metadata, NULL::text AS query, NULL::int AS result_count
        FROM analytics_view_events
        WHERE org_id = ${actor.orgId} ${after}
        UNION ALL
        SELECT 'search'::text AS kind, id, created_at, subject_type, NULL::text AS subject_id,
               NULL::text AS source, NULL::text AS path, locale, NULL::text AS referrer,
               NULL::text AS utm_source, NULL::text AS utm_medium, NULL::text AS utm_campaign,
               visitor_id, end_user_id, NULL::text AS user_agent_class, NULL::int AS dwell_ms,
               NULL::int AS read_depth, NULL::text AS country, NULL::jsonb AS metadata,
               query, result_count
        FROM analytics_search_events
        WHERE org_id = ${actor.orgId} ${after}
      ) merged
      ORDER BY created_at ASC, id ASC
      LIMIT ${limit + 1}
    `);

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const viewEvents: AnalyticsViewEventExport[] = [];
    const searchEvents: AnalyticsSearchEventExport[] = [];
    for (const r of page) {
      const createdAt = new Date(r.created_at).toISOString();
      if (r.kind === 'view') {
        viewEvents.push({
          id: r.id,
          subjectType: r.subject_type,
          subjectId: r.subject_id ?? '',
          source: r.source ?? 'tracker',
          path: r.path,
          locale: r.locale,
          referrer: r.referrer,
          utmSource: r.utm_source,
          utmMedium: r.utm_medium,
          utmCampaign: r.utm_campaign,
          visitorId: r.visitor_id,
          endUserId: r.end_user_id,
          userAgentClass: r.user_agent_class,
          dwellMs: r.dwell_ms,
          readDepth: r.read_depth,
          country: r.country,
          metadata: r.metadata,
          createdAt,
        });
      } else {
        searchEvents.push({
          id: r.id,
          subjectType: r.subject_type,
          query: r.query ?? '',
          locale: r.locale,
          resultCount: r.result_count ?? 0,
          visitorId: r.visitor_id,
          endUserId: r.end_user_id,
          createdAt,
        });
      }
    }

    const last = page[page.length - 1];
    const nextCursor = hasMore && last ? encodeCursor(last.created_at, last.id) : null;
    return {
      module: ANALYTICS_MODULE,
      muninTransferVersion: 1,
      records: { viewEvents, searchEvents },
      nextCursor,
    };
  }

  async importAnalytics(
    data: AnalyticsImportData,
    priorIdMap: IdMap = {},
  ): Promise<ImportResult> {
    const ctx = getCurrentContext();
    const actor = ctx.actor!;
    const result = newImportResult();
    result.idMap = { ...priorIdMap };

    const config = data.config ?? { trackers: [], visitorIdentities: [] };
    for (const tracker of config.trackers) {
      const existing = await ctx.db
        .select({ id: schema.analyticsTrackers.id })
        .from(schema.analyticsTrackers)
        .where(
          and(
            eq(schema.analyticsTrackers.orgId, actor.orgId),
            eq(schema.analyticsTrackers.name, tracker.name),
          ),
        )
        .limit(1);
      if (existing[0]) {
        result.idMap[tracker.id] = existing[0].id;
        result.skipped++;
        continue;
      }
      const [created] = await ctx.db
        .insert(schema.analyticsTrackers)
        .values({
          orgId: actor.orgId,
          name: tracker.name,
          allowedOrigins: tracker.allowedOrigins,
          requireVerifiedIdentity: tracker.requireVerifiedIdentity,
          identityVerificationSecret: null,
        })
        .returning({ id: schema.analyticsTrackers.id });
      result.idMap[tracker.id] = created!.id;
      result.created++;
      if (tracker.identityVerificationSecret === REDACTED) {
        result.warnings.push(
          `tracker "${tracker.name}" imported without its identity-verification secret — rotate it with analytics_rotate_tracker_identity_secret before using /v1/a/identify, and mint a fresh tracker key with analytics_create_tracker`,
        );
      }
    }

    for (const identity of config.visitorIdentities) {
      const targetEndUserId = resolveId(result.idMap, identity.endUserId);
      if (!targetEndUserId) {
        result.warnings.push(
          `visitor identity ${identity.visitorId} skipped: end-user ${identity.endUserId} was not part of this import (import end-users first and pass their idMap)`,
        );
        result.skipped++;
        continue;
      }
      const existing = await ctx.db
        .select({ id: schema.analyticsVisitorIdentities.id })
        .from(schema.analyticsVisitorIdentities)
        .where(
          and(
            eq(schema.analyticsVisitorIdentities.orgId, actor.orgId),
            eq(schema.analyticsVisitorIdentities.visitorId, identity.visitorId),
          ),
        )
        .limit(1);
      if (existing[0]) {
        result.idMap[identity.id] = existing[0].id;
        result.skipped++;
        continue;
      }
      const [created] = await ctx.db
        .insert(schema.analyticsVisitorIdentities)
        .values({
          orgId: actor.orgId,
          visitorId: identity.visitorId,
          endUserId: targetEndUserId,
        })
        .returning({ id: schema.analyticsVisitorIdentities.id });
      result.idMap[identity.id] = created!.id;
      result.created++;
    }

    const events = data.events ?? { viewEvents: [], searchEvents: [] };
    let warnedDedup = false;
    for (const event of events.viewEvents) {
      if (result.idMap[event.id]) {
        result.skipped++;
        continue;
      }
      if (!warnedDedup) {
        result.warnings.push(
          'analytics events have no natural key — they are de-duplicated only within a single import run via idMap; re-running an import with the same payload but without the prior idMap will insert duplicate event rows',
        );
        warnedDedup = true;
      }
      const [created] = await ctx.db
        .insert(schema.analyticsViewEvents)
        .values({
          orgId: actor.orgId,
          subjectType: event.subjectType,
          subjectId: event.subjectId,
          source: event.source,
          path: event.path,
          locale: event.locale,
          referrer: event.referrer,
          utmSource: event.utmSource,
          utmMedium: event.utmMedium,
          utmCampaign: event.utmCampaign,
          visitorId: event.visitorId,
          endUserId: resolveId(result.idMap, event.endUserId) ?? null,
          userAgentClass: event.userAgentClass,
          dwellMs: event.dwellMs,
          readDepth: event.readDepth,
          country: event.country,
          metadata: event.metadata,
          createdAt: new Date(event.createdAt),
        })
        .returning({ id: schema.analyticsViewEvents.id });
      result.idMap[event.id] = created!.id;
      result.created++;
    }

    for (const event of events.searchEvents) {
      if (result.idMap[event.id]) {
        result.skipped++;
        continue;
      }
      if (!warnedDedup) {
        result.warnings.push(
          'analytics events have no natural key — they are de-duplicated only within a single import run via idMap; re-running an import with the same payload but without the prior idMap will insert duplicate event rows',
        );
        warnedDedup = true;
      }
      const [created] = await ctx.db
        .insert(schema.analyticsSearchEvents)
        .values({
          orgId: actor.orgId,
          subjectType: event.subjectType,
          query: event.query,
          locale: event.locale,
          resultCount: event.resultCount,
          visitorId: event.visitorId,
          endUserId: resolveId(result.idMap, event.endUserId) ?? null,
          createdAt: new Date(event.createdAt),
        })
        .returning({ id: schema.analyticsSearchEvents.id });
      result.idMap[event.id] = created!.id;
      result.created++;
    }

    return result;
  }
}

function truncate(value: string | null | undefined, max: number): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, max);
}

function clampInt(
  value: number | null | undefined,
  min: number,
  max: number,
): number | null {
  if (value === null || value === undefined) return null;
  if (!Number.isFinite(value)) return null;
  return Math.min(max, Math.max(min, Math.floor(value)));
}

function normalizeCountry(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(trimmed) ? trimmed : null;
}
