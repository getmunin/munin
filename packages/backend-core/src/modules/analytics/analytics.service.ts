import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { schema, type Db } from '@getmunin/db';
import { and, asc, eq, isNull, sql, type SQL } from 'drizzle-orm';
import { getCurrentContext, randomToken } from '@getmunin/core';
import { DB } from '../../common/db/db.module.ts';
import { mintApiKey } from '../../common/api-keys/api-key.helpers.ts';
import { assertOriginAllowlistPopulated } from '../../common/allowlist.ts';
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

export interface TrackerSummary {
  id: string;
  name: string;
  allowedOrigins: string[];
  keyPrefix: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  requireVerifiedIdentity: boolean;
  hasIdentityVerificationSecret: boolean;
}

export interface CreateTrackerResult extends TrackerSummary {
  trackerKey: string;
  identityVerificationSecret: string;
}

export interface RotateIdentitySecretResult {
  trackerId: string;
  identityVerificationSecret: string;
}

export interface RotateTrackerKeyResult {
  trackerId: string;
  trackerKey: string;
  keyPrefix: string;
}

export interface FunnelStepArg {
  label?: string;
  subjectType?: string;
  subjectId?: string;
  pathLike?: string;
}

type ViewSource = 'pixel' | 'beacon' | 'tracker';

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

  async createTracker(args: {
    name: string;
    allowedOrigins?: string[];
    requireVerifiedIdentity?: boolean;
  }): Promise<CreateTrackerResult> {
    const ctx = getCurrentContext();
    const actor = ctx.actor!;
    assertOriginAllowlistPopulated({
      origins: args.allowedOrigins ?? [],
      envVar: 'MUNIN_TRACKER_REQUIRE_ALLOWLIST',
      errorCode: 'allowed_origins_required',
      field: 'allowedOrigins',
    });
    const identityVerificationSecret = randomToken(32);
    const [tracker] = await ctx.db
      .insert(schema.analyticsTrackers)
      .values({
        orgId: actor.orgId,
        name: args.name,
        allowedOrigins: args.allowedOrigins ?? [],
        identityVerificationSecret,
        requireVerifiedIdentity: args.requireVerifiedIdentity ?? false,
      })
      .returning();
    const key = await mintApiKey(ctx.db, {
      orgId: actor.orgId,
      type: 'track',
      name: args.name,
      scopes: ['analytics:track:write'],
      audiences: ['public'],
      trackerId: tracker!.id,
      createdByUserId: actor.userId ?? null,
    });
    return {
      id: tracker!.id,
      name: tracker!.name,
      allowedOrigins: tracker!.allowedOrigins,
      keyPrefix: key.keyPrefix,
      createdAt: tracker!.createdAt.toISOString(),
      lastUsedAt: null,
      revokedAt: null,
      requireVerifiedIdentity: tracker!.requireVerifiedIdentity,
      hasIdentityVerificationSecret: true,
      trackerKey: key.rawKey,
      identityVerificationSecret,
    };
  }

  async listTrackers(args: { includeRevoked?: boolean }): Promise<TrackerSummary[]> {
    const ctx = getCurrentContext();
    const actor = ctx.actor!;
    const rows = await ctx.db
      .select({
        id: schema.analyticsTrackers.id,
        name: schema.analyticsTrackers.name,
        allowedOrigins: schema.analyticsTrackers.allowedOrigins,
        createdAt: schema.analyticsTrackers.createdAt,
        requireVerifiedIdentity: schema.analyticsTrackers.requireVerifiedIdentity,
        identityVerificationSecret: schema.analyticsTrackers.identityVerificationSecret,
        keyPrefix: schema.apiKeys.keyPrefix,
        lastUsedAt: schema.apiKeys.lastUsedAt,
        revokedAt: schema.apiKeys.revokedAt,
      })
      .from(schema.analyticsTrackers)
      .leftJoin(
        schema.apiKeys,
        and(
          eq(schema.apiKeys.trackerId, schema.analyticsTrackers.id),
          eq(schema.apiKeys.type, 'track'),
        ),
      )
      .where(eq(schema.analyticsTrackers.orgId, actor.orgId));
    return rows
      .filter((r) => args.includeRevoked || r.revokedAt === null)
      .map((r) => ({
        id: r.id,
        name: r.name,
        allowedOrigins: r.allowedOrigins,
        keyPrefix: r.keyPrefix,
        createdAt: r.createdAt.toISOString(),
        lastUsedAt: r.lastUsedAt?.toISOString() ?? null,
        revokedAt: r.revokedAt?.toISOString() ?? null,
        requireVerifiedIdentity: r.requireVerifiedIdentity,
        hasIdentityVerificationSecret: r.identityVerificationSecret !== null,
      }));
  }

  async updateTracker(args: {
    trackerId: string;
    name?: string;
    allowedOrigins?: string[];
    requireVerifiedIdentity?: boolean;
  }): Promise<TrackerSummary> {
    const ctx = getCurrentContext();
    const actor = ctx.actor!;
    const patch: {
      name?: string;
      allowedOrigins?: string[];
      requireVerifiedIdentity?: boolean;
      updatedAt: Date;
    } = {
      updatedAt: new Date(),
    };
    if (args.name !== undefined) patch.name = args.name;
    if (args.allowedOrigins !== undefined) {
      assertOriginAllowlistPopulated({
        origins: args.allowedOrigins,
        envVar: 'MUNIN_TRACKER_REQUIRE_ALLOWLIST',
        errorCode: 'allowed_origins_required',
        field: 'allowedOrigins',
      });
      patch.allowedOrigins = args.allowedOrigins;
    }
    if (args.requireVerifiedIdentity !== undefined)
      patch.requireVerifiedIdentity = args.requireVerifiedIdentity;
    const [updated] = await ctx.db
      .update(schema.analyticsTrackers)
      .set(patch)
      .where(
        and(
          eq(schema.analyticsTrackers.id, args.trackerId),
          eq(schema.analyticsTrackers.orgId, actor.orgId),
        ),
      )
      .returning();
    if (!updated) throw new NotFoundException(`tracker ${args.trackerId} not found`);
    const [key] = await ctx.db
      .select({
        keyPrefix: schema.apiKeys.keyPrefix,
        lastUsedAt: schema.apiKeys.lastUsedAt,
        revokedAt: schema.apiKeys.revokedAt,
      })
      .from(schema.apiKeys)
      .where(
        and(eq(schema.apiKeys.trackerId, args.trackerId), eq(schema.apiKeys.type, 'track')),
      )
      .limit(1);
    return {
      id: updated.id,
      name: updated.name,
      allowedOrigins: updated.allowedOrigins,
      keyPrefix: key?.keyPrefix ?? null,
      createdAt: updated.createdAt.toISOString(),
      lastUsedAt: key?.lastUsedAt?.toISOString() ?? null,
      revokedAt: key?.revokedAt?.toISOString() ?? null,
      requireVerifiedIdentity: updated.requireVerifiedIdentity,
      hasIdentityVerificationSecret: updated.identityVerificationSecret !== null,
    };
  }

  async rotateIdentitySecret(args: {
    trackerId: string;
  }): Promise<RotateIdentitySecretResult> {
    const ctx = getCurrentContext();
    const actor = ctx.actor!;
    const identityVerificationSecret = randomToken(32);
    const [updated] = await ctx.db
      .update(schema.analyticsTrackers)
      .set({ identityVerificationSecret, updatedAt: new Date() })
      .where(
        and(
          eq(schema.analyticsTrackers.id, args.trackerId),
          eq(schema.analyticsTrackers.orgId, actor.orgId),
        ),
      )
      .returning({ id: schema.analyticsTrackers.id });
    if (!updated) throw new NotFoundException(`tracker ${args.trackerId} not found`);
    return { trackerId: updated.id, identityVerificationSecret };
  }

  async rotateTrackerKey(args: { trackerId: string }): Promise<RotateTrackerKeyResult> {
    const ctx = getCurrentContext();
    const actor = ctx.actor!;
    const tracker = await ctx.db
      .select({ id: schema.analyticsTrackers.id, name: schema.analyticsTrackers.name })
      .from(schema.analyticsTrackers)
      .where(
        and(
          eq(schema.analyticsTrackers.id, args.trackerId),
          eq(schema.analyticsTrackers.orgId, actor.orgId),
        ),
      )
      .limit(1);
    if (!tracker[0]) throw new NotFoundException(`tracker ${args.trackerId} not found`);

    await ctx.db
      .update(schema.apiKeys)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(schema.apiKeys.trackerId, args.trackerId),
          eq(schema.apiKeys.orgId, actor.orgId),
          eq(schema.apiKeys.type, 'track'),
          isNull(schema.apiKeys.revokedAt),
        ),
      );

    const key = await mintApiKey(ctx.db, {
      orgId: actor.orgId,
      type: 'track',
      name: tracker[0].name,
      scopes: ['analytics:track:write'],
      audiences: ['public'],
      trackerId: args.trackerId,
      createdByUserId: actor.userId ?? null,
    });
    return { trackerId: args.trackerId, trackerKey: key.rawKey, keyPrefix: key.keyPrefix };
  }

  async revokeTracker(args: { trackerId: string }): Promise<{ revoked: boolean }> {
    const ctx = getCurrentContext();
    const actor = ctx.actor!;
    const tracker = await ctx.db
      .select({ id: schema.analyticsTrackers.id })
      .from(schema.analyticsTrackers)
      .where(
        and(
          eq(schema.analyticsTrackers.id, args.trackerId),
          eq(schema.analyticsTrackers.orgId, actor.orgId),
        ),
      )
      .limit(1);
    if (!tracker[0]) return { revoked: false };
    const result = await ctx.db
      .update(schema.apiKeys)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(schema.apiKeys.trackerId, args.trackerId),
          eq(schema.apiKeys.orgId, actor.orgId),
          eq(schema.apiKeys.type, 'track'),
          isNull(schema.apiKeys.revokedAt),
        ),
      )
      .returning({ id: schema.apiKeys.id });
    return { revoked: result.length > 0 };
  }

  async topSubjects(args: {
    subjectType?: string;
    sinceDays: number;
    limit: number;
    source?: ViewSource;
    endUserId?: string;
    contactId?: string;
  }): Promise<Array<{ subjectType: string; subjectId: string; views: number; visitors: number }>> {
    const ctx = getCurrentContext();
    const actor = ctx.actor!;
    const conditions = this.viewWindowConditions(actor.orgId, args);
    const endUserId = await this.resolveQueryEndUserId(args);
    if (args.endUserId || args.contactId) {
      if (!endUserId) return [];
      conditions.push(sql`end_user_id = ${endUserId}`);
    }
    const where = sql.join(conditions, sql` AND `);
    const rows = await ctx.db.execute<{
      subject_type: string;
      subject_id: string;
      views: number;
      visitors: number;
    }>(sql`
      SELECT subject_type, subject_id,
             COUNT(*)::int AS views,
             COUNT(DISTINCT visitor_id)::int AS visitors
      FROM analytics_view_events
      WHERE ${where}
      GROUP BY subject_type, subject_id
      ORDER BY views DESC
      LIMIT ${args.limit}
    `);
    return rows.map((r) => ({
      subjectType: r.subject_type,
      subjectId: r.subject_id,
      views: r.views,
      visitors: r.visitors,
    }));
  }

  async topCountries(args: {
    subjectType?: string;
    sinceDays: number;
    limit: number;
    source?: ViewSource;
  }): Promise<Array<{ country: string | null; views: number; visitors: number }>> {
    const ctx = getCurrentContext();
    const actor = ctx.actor!;
    const where = sql.join(this.viewWindowConditions(actor.orgId, args), sql` AND `);
    const rows = await ctx.db.execute<{
      country: string | null;
      views: number;
      visitors: number;
    }>(sql`
      SELECT country,
             COUNT(*)::int AS views,
             COUNT(DISTINCT visitor_id)::int AS visitors
      FROM analytics_view_events
      WHERE ${where}
      GROUP BY country
      ORDER BY views DESC
      LIMIT ${args.limit}
    `);
    return rows.map((r) => ({
      country: r.country,
      views: r.views,
      visitors: r.visitors,
    }));
  }

  async trafficBySource(args: {
    subjectType?: string;
    sinceDays: number;
    limit: number;
    source?: ViewSource;
  }): Promise<
    Array<{
      utmSource: string | null;
      utmMedium: string | null;
      utmCampaign: string | null;
      views: number;
      visitors: number;
    }>
  > {
    const ctx = getCurrentContext();
    const actor = ctx.actor!;
    const where = sql.join(this.viewWindowConditions(actor.orgId, args), sql` AND `);
    const rows = await ctx.db.execute<{
      utm_source: string | null;
      utm_medium: string | null;
      utm_campaign: string | null;
      views: number;
      visitors: number;
    }>(sql`
      SELECT utm_source, utm_medium, utm_campaign,
             COUNT(*)::int AS views,
             COUNT(DISTINCT visitor_id)::int AS visitors
      FROM analytics_view_events
      WHERE ${where}
      GROUP BY utm_source, utm_medium, utm_campaign
      ORDER BY views DESC
      LIMIT ${args.limit}
    `);
    return rows.map((r) => ({
      utmSource: r.utm_source,
      utmMedium: r.utm_medium,
      utmCampaign: r.utm_campaign,
      views: r.views,
      visitors: r.visitors,
    }));
  }

  async referrerHosts(args: {
    subjectType?: string;
    excludeHost?: string;
    sinceDays: number;
    limit: number;
    source?: ViewSource;
  }): Promise<Array<{ host: string | null; views: number; visitors: number }>> {
    const ctx = getCurrentContext();
    const actor = ctx.actor!;
    const where = sql.join(this.viewWindowConditions(actor.orgId, args), sql` AND `);
    const hostExpr = sql`NULLIF(substring(referrer FROM '^[a-zA-Z]+://([^/?#]+)'), '')`;
    const exclude = args.excludeHost
      ? sql`AND (${hostExpr} IS NULL OR ${hostExpr} <> ${args.excludeHost})`
      : sql``;
    const rows = await ctx.db.execute<{
      host: string | null;
      views: number;
      visitors: number;
    }>(sql`
      SELECT ${hostExpr} AS host,
             COUNT(*)::int AS views,
             COUNT(DISTINCT visitor_id)::int AS visitors
      FROM analytics_view_events
      WHERE ${where} ${exclude}
      GROUP BY host
      ORDER BY views DESC
      LIMIT ${args.limit}
    `);
    return rows.map((r) => ({
      host: r.host,
      views: r.views,
      visitors: r.visitors,
    }));
  }

  async viewsOverTime(args: {
    subjectType?: string;
    subjectId?: string;
    sinceDays: number;
    source?: ViewSource;
    endUserId?: string;
    contactId?: string;
  }): Promise<Array<{ day: string; views: number; visitors: number }>> {
    const ctx = getCurrentContext();
    const actor = ctx.actor!;
    const eventConditions = this.viewWindowConditions(actor.orgId, args);
    const endUserId = await this.resolveQueryEndUserId(args);
    if (args.endUserId || args.contactId) {
      if (!endUserId) {
        return Array.from({ length: args.sinceDays }, (_, i) => {
          const d = new Date(Date.now() - (args.sinceDays - 1 - i) * 86400000);
          return { day: d.toISOString().slice(0, 10), views: 0, visitors: 0 };
        });
      }
      eventConditions.push(sql`end_user_id = ${endUserId}`);
    }
    const eventWhere = sql.join(eventConditions, sql` AND `);
    const rows = await ctx.db.execute<{
      day: Date | string;
      views: number;
      visitors: number;
    }>(sql`
      WITH days AS (
        SELECT generate_series(
          date_trunc('day', NOW()) - ((${args.sinceDays} - 1) || ' days')::interval,
          date_trunc('day', NOW()),
          '1 day'::interval
        )::date AS day
      ),
      counts AS (
        SELECT date_trunc('day', created_at)::date AS day,
               COUNT(*)::int AS views,
               COUNT(DISTINCT visitor_id)::int AS visitors
        FROM analytics_view_events
        WHERE ${eventWhere}
        GROUP BY 1
      )
      SELECT d.day, COALESCE(c.views, 0)::int AS views, COALESCE(c.visitors, 0)::int AS visitors
      FROM days d
      LEFT JOIN counts c ON c.day = d.day
      ORDER BY d.day ASC
    `);
    return rows.map((r) => ({
      day: typeof r.day === 'string' ? r.day : r.day.toISOString().slice(0, 10),
      views: r.views,
      visitors: r.visitors,
    }));
  }

  async subjectEngagement(args: {
    subjectType: string;
    subjectId: string;
    sinceDays: number;
    endUserId?: string;
    contactId?: string;
  }): Promise<{
    views: number;
    visitors: number;
    avgDwellMs: number | null;
    avgReadDepth: number | null;
    lastViewAt: string | null;
  }> {
    const ctx = getCurrentContext();
    const actor = ctx.actor!;
    const conditions = [
      sql`org_id = ${actor.orgId}`,
      sql`subject_type = ${args.subjectType}`,
      sql`subject_id = ${args.subjectId}`,
      sql`created_at > NOW() - (${args.sinceDays} || ' days')::interval`,
    ];
    const endUserId = await this.resolveQueryEndUserId(args);
    if (args.endUserId || args.contactId) {
      if (!endUserId) {
        return {
          views: 0,
          visitors: 0,
          avgDwellMs: null,
          avgReadDepth: null,
          lastViewAt: null,
        };
      }
      conditions.push(sql`end_user_id = ${endUserId}`);
    }
    const where = sql.join(conditions, sql` AND `);
    const rows = await ctx.db.execute<{
      views: number;
      visitors: number;
      avg_dwell_ms: number | null;
      avg_read_depth: number | null;
      last_view_at: Date | string | null;
    }>(sql`
      SELECT COUNT(*)::int AS views,
             COUNT(DISTINCT visitor_id)::int AS visitors,
             AVG(dwell_ms) FILTER (WHERE dwell_ms IS NOT NULL) AS avg_dwell_ms,
             AVG(read_depth) FILTER (WHERE read_depth IS NOT NULL) AS avg_read_depth,
             MAX(created_at) AS last_view_at
      FROM analytics_view_events
      WHERE ${where}
    `);
    const r = rows[0]!;
    return {
      views: r.views,
      visitors: r.visitors,
      avgDwellMs: r.avg_dwell_ms !== null ? Math.round(Number(r.avg_dwell_ms)) : null,
      avgReadDepth: r.avg_read_depth !== null ? Math.round(Number(r.avg_read_depth)) : null,
      lastViewAt: r.last_view_at ? new Date(r.last_view_at).toISOString() : null,
    };
  }

  async funnel(args: {
    steps: FunnelStepArg[];
    sinceDays: number;
    stepWindowHours?: number;
    source?: ViewSource;
  }): Promise<{
    sinceDays: number;
    steps: Array<{
      index: number;
      label: string;
      actors: number;
      conversionFromPrev: number | null;
      dropFromPrev: number | null;
      conversionFromStart: number;
    }>;
    overallConversion: number;
  }> {
    const ctx = getCurrentContext();
    const actor = ctx.actor!;
    const steps = args.steps;

    const prefilter = sql.join(
      steps.map((s) => sql`(${funnelStepPredicate(s, sql.raw('ev'))})`),
      sql` OR `,
    );
    const sourceCond = args.source ? sql` AND ev.source = ${args.source}` : sql``;

    const ctes: SQL[] = [
      sql`base AS (
        SELECT COALESCE(vi.end_user_id, ev.visitor_id) AS actor,
               ev.created_at AS created_at,
               ev.subject_type AS subject_type,
               ev.subject_id AS subject_id,
               ev.path AS path
        FROM analytics_view_events ev
        LEFT JOIN analytics_visitor_identities vi
          ON vi.org_id = ev.org_id AND vi.visitor_id = ev.visitor_id
        WHERE ev.org_id = ${actor.orgId}
          AND ev.created_at > NOW() - (${args.sinceDays} || ' days')::interval${sourceCond}
          AND COALESCE(vi.end_user_id, ev.visitor_id) IS NOT NULL
          AND (${prefilter})
      )`,
    ];

    steps.forEach((step, i) => {
      const name = sql.raw(`s${i}`);
      const pred = funnelStepPredicate(step, sql.raw('b'));
      if (i === 0) {
        ctes.push(sql`${name} AS (
          SELECT b.actor AS actor, MIN(b.created_at) AS t
          FROM base b
          WHERE ${pred}
          GROUP BY b.actor
        )`);
      } else {
        const prev = sql.raw(`s${i - 1}`);
        const windowCond = args.stepWindowHours
          ? sql` AND b.created_at <= ${prev}.t + (${args.stepWindowHours} || ' hours')::interval`
          : sql``;
        ctes.push(sql`${name} AS (
          SELECT b.actor AS actor, MIN(b.created_at) AS t
          FROM base b
          JOIN ${prev} ON ${prev}.actor = b.actor
          WHERE (${pred}) AND b.created_at > ${prev}.t${windowCond}
          GROUP BY b.actor
        )`);
      }
    });

    const selectCols = steps.map(
      (_, i) => sql`(SELECT COUNT(*)::int FROM ${sql.raw(`s${i}`)}) AS ${sql.raw(`step_${i}`)}`,
    );
    const rows = await ctx.db.execute<Record<string, number>>(
      sql`WITH ${sql.join(ctes, sql`, `)} SELECT ${sql.join(selectCols, sql`, `)}`,
    );
    const counts = steps.map((_, i) => Number(rows[0]?.[`step_${i}`] ?? 0));
    const first = counts[0] ?? 0;

    return {
      sinceDays: args.sinceDays,
      steps: steps.map((step, i) => {
        const actors = counts[i] ?? 0;
        const prevCount = i > 0 ? counts[i - 1] ?? 0 : null;
        return {
          index: i + 1,
          label: funnelStepLabel(step, i),
          actors,
          conversionFromPrev:
            prevCount === null ? null : prevCount > 0 ? roundRate(actors / prevCount) : 0,
          dropFromPrev:
            prevCount === null ? null : prevCount > 0 ? roundRate(1 - actors / prevCount) : 0,
          conversionFromStart: first > 0 ? roundRate(actors / first) : 0,
        };
      }),
      overallConversion: first > 0 ? roundRate((counts[counts.length - 1] ?? 0) / first) : 0,
    };
  }

  async contactJourney(args: {
    endUserId?: string;
    contactId?: string;
    sinceDays: number;
    limit: number;
  }): Promise<
    Array<{
      kind: 'view' | 'search';
      at: string;
      subjectType: string | null;
      subjectId: string | null;
      path: string | null;
      query: string | null;
      resultCount: number | null;
    }>
  > {
    const ctx = getCurrentContext();
    const actor = ctx.actor!;
    const endUserId = await this.resolveQueryEndUserId(args);
    if (!endUserId) return [];
    const matchActor = sql`(end_user_id = ${endUserId} OR visitor_id IN (
      SELECT visitor_id FROM analytics_visitor_identities
      WHERE org_id = ${actor.orgId} AND end_user_id = ${endUserId}
    ))`;
    const rows = await ctx.db.execute<{
      kind: 'view' | 'search';
      at: Date | string;
      subject_type: string | null;
      subject_id: string | null;
      path: string | null;
      query: string | null;
      result_count: number | null;
    }>(sql`
      SELECT 'view'::text AS kind,
             created_at AS at,
             subject_type,
             subject_id,
             path,
             NULL::text AS query,
             NULL::int AS result_count
      FROM analytics_view_events
      WHERE org_id = ${actor.orgId}
        AND ${matchActor}
        AND created_at > NOW() - (${args.sinceDays} || ' days')::interval
      UNION ALL
      SELECT 'search'::text AS kind,
             created_at AS at,
             subject_type,
             NULL::text AS subject_id,
             NULL::text AS path,
             query,
             result_count
      FROM analytics_search_events
      WHERE org_id = ${actor.orgId}
        AND ${matchActor}
        AND created_at > NOW() - (${args.sinceDays} || ' days')::interval
      ORDER BY at ASC
      LIMIT ${args.limit}
    `);
    return rows.map((r) => ({
      kind: r.kind,
      at: new Date(r.at).toISOString(),
      subjectType: r.subject_type,
      subjectId: r.subject_id,
      path: r.path,
      query: r.query,
      resultCount: r.result_count,
    }));
  }

  async zeroResultSearches(args: {
    subjectType?: string;
    sinceDays: number;
    limit: number;
  }): Promise<Array<{ query: string; occurrences: number; lastSeenAt: string }>> {
    const ctx = getCurrentContext();
    const actor = ctx.actor!;
    const conditions = [
      sql`org_id = ${actor.orgId}`,
      sql`result_count = 0`,
      sql`created_at > NOW() - (${args.sinceDays} || ' days')::interval`,
    ];
    if (args.subjectType) conditions.push(sql`subject_type = ${args.subjectType}`);
    const where = sql.join(conditions, sql` AND `);
    const rows = await ctx.db.execute<{
      query: string;
      occurrences: number;
      last_seen_at: Date | string;
    }>(sql`
      SELECT query,
             COUNT(*)::int AS occurrences,
             MAX(created_at) AS last_seen_at
      FROM analytics_search_events
      WHERE ${where}
      GROUP BY query
      ORDER BY occurrences DESC, last_seen_at DESC
      LIMIT ${args.limit}
    `);
    return rows.map((r) => ({
      query: r.query,
      occurrences: r.occurrences,
      lastSeenAt: new Date(r.last_seen_at).toISOString(),
    }));
  }

  private viewWindowConditions(
    orgId: string,
    args: { sinceDays: number; subjectType?: string; subjectId?: string; source?: ViewSource },
  ): SQL[] {
    const conditions: SQL[] = [
      sql`org_id = ${orgId}`,
      sql`created_at > NOW() - (${args.sinceDays} || ' days')::interval`,
    ];
    if (args.subjectType) conditions.push(sql`subject_type = ${args.subjectType}`);
    if (args.subjectId) conditions.push(sql`subject_id = ${args.subjectId}`);
    if (args.source) conditions.push(sql`source = ${args.source}`);
    return conditions;
  }

  private async resolveQueryEndUserId(args: {
    endUserId?: string;
    contactId?: string;
  }): Promise<string | null> {
    if (args.endUserId) return args.endUserId;
    if (!args.contactId) return null;
    const ctx = getCurrentContext();
    const actor = ctx.actor!;
    const rows = await ctx.db
      .select({ endUserId: schema.crmContacts.endUserId })
      .from(schema.crmContacts)
      .where(
        and(
          eq(schema.crmContacts.id, args.contactId),
          eq(schema.crmContacts.orgId, actor.orgId),
        ),
      )
      .limit(1);
    return rows[0]?.endUserId ?? null;
  }
}

function funnelStepPredicate(step: FunnelStepArg, alias: SQL): SQL {
  const conds: SQL[] = [];
  if (step.subjectType) conds.push(sql`${alias}.subject_type = ${step.subjectType}`);
  if (step.subjectId) conds.push(sql`${alias}.subject_id = ${step.subjectId}`);
  if (step.pathLike) conds.push(sql`${alias}.path LIKE ${step.pathLike}`);
  return sql.join(conds, sql` AND `);
}

function funnelStepLabel(step: FunnelStepArg, index: number): string {
  if (step.label) return step.label;
  const parts: string[] = [];
  if (step.subjectType) parts.push(step.subjectType);
  if (step.subjectId) parts.push(step.subjectId);
  if (step.pathLike) parts.push(`path~${step.pathLike}`);
  return parts.join(':') || `step ${index + 1}`;
}

function roundRate(n: number): number {
  return Number(n.toFixed(4));
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
