import { Injectable, NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import { McpTool } from '@getmunin/mcp-toolkit';
import { schema } from '@getmunin/db';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { buildApiKey, getCurrentContext, hashSecret, keyPrefix } from '@getmunin/core';

const CreateTrackerInput = z.object({
  name: z.string().min(1).max(120),
  allowedOrigins: z.array(z.string().url()).optional(),
});

const UpdateTrackerInput = z.object({
  trackerId: z.string(),
  name: z.string().min(1).max(120).optional(),
  allowedOrigins: z.array(z.string().url()).optional(),
});

const RevokeTrackerInput = z.object({
  trackerId: z.string(),
});

interface TrackerSummary {
  id: string;
  name: string;
  allowedOrigins: string[];
  keyPrefix: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

interface CreateTrackerResult extends TrackerSummary {
  trackerKey: string;
}

@Injectable()
export class AnalyticsAdminTools {
  @McpTool({
    name: 'analytics_create_tracker',
    title: 'Analytics: Create tracker key',
    description:
      'Create a tracker and mint a public `mn_track_*` API key bound to it. The key is safe to embed in `<script>` tags or mobile clients — it can only write page-view events scoped to your org, never read them. `allowedOrigins` is an optional list of full origins (`https://example.com`) the tracker will accept; when empty, any origin is accepted (set `MUNIN_TRACKER_REQUIRE_ALLOWLIST=1` to fail-closed instead). Returns the plaintext key once; store it where it needs to be embedded.',
    audiences: ['admin'],
    scopes: ['analytics:write'],
    input: CreateTrackerInput,
    readOnlyHint: false,
    destructiveHint: false,
  })
  async createTracker(args: z.infer<typeof CreateTrackerInput>): Promise<CreateTrackerResult> {
    const ctx = getCurrentContext();
    const actor = ctx.actor!;
    const [tracker] = await ctx.db
      .insert(schema.analyticsTrackers)
      .values({
        orgId: actor.orgId,
        name: args.name,
        allowedOrigins: args.allowedOrigins ?? [],
      })
      .returning();
    const rawKey = buildApiKey('track');
    const [key] = await ctx.db
      .insert(schema.apiKeys)
      .values({
        orgId: actor.orgId,
        type: 'track',
        name: args.name,
        keyHash: hashSecret(rawKey),
        keyPrefix: keyPrefix(rawKey),
        scopes: ['analytics:track:write'],
        audiences: ['public'],
        trackerId: tracker!.id,
        createdByUserId: actor.userId ?? null,
      })
      .returning();
    return {
      id: tracker!.id,
      name: tracker!.name,
      allowedOrigins: tracker!.allowedOrigins,
      keyPrefix: key!.keyPrefix,
      createdAt: tracker!.createdAt.toISOString(),
      lastUsedAt: null,
      revokedAt: null,
      trackerKey: rawKey,
    };
  }

  @McpTool({
    name: 'analytics_list_trackers',
    title: 'Analytics: List tracker keys',
    description:
      'List analytics trackers for the current org with their key prefix, allowed origins, and revocation state. Plaintext keys are never returned; rotate via `analytics_revoke_tracker` + `analytics_create_tracker`.',
    audiences: ['admin'],
    scopes: ['analytics:read'],
    input: z.object({ includeRevoked: z.boolean().optional() }),
    readOnlyHint: true,
    destructiveHint: false,
  })
  async listTrackers(args: { includeRevoked?: boolean }): Promise<TrackerSummary[]> {
    const ctx = getCurrentContext();
    const actor = ctx.actor!;
    const rows = await ctx.db
      .select({
        id: schema.analyticsTrackers.id,
        name: schema.analyticsTrackers.name,
        allowedOrigins: schema.analyticsTrackers.allowedOrigins,
        createdAt: schema.analyticsTrackers.createdAt,
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
      }));
  }

  @McpTool({
    name: 'analytics_update_tracker',
    title: 'Analytics: Update tracker config',
    description:
      'Update a tracker\'s display name and/or `allowedOrigins`. The bound API key is unchanged — rotate via `analytics_revoke_tracker` + `analytics_create_tracker`.',
    audiences: ['admin'],
    scopes: ['analytics:write'],
    input: UpdateTrackerInput,
    readOnlyHint: false,
    destructiveHint: false,
  })
  async updateTracker(args: z.infer<typeof UpdateTrackerInput>): Promise<TrackerSummary> {
    const ctx = getCurrentContext();
    const actor = ctx.actor!;
    const patch: { name?: string; allowedOrigins?: string[]; updatedAt: Date } = {
      updatedAt: new Date(),
    };
    if (args.name !== undefined) patch.name = args.name;
    if (args.allowedOrigins !== undefined) patch.allowedOrigins = args.allowedOrigins;
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
    };
  }

  @McpTool({
    name: 'analytics_top_subjects',
    title: 'Analytics: Top subjects by view count',
    description:
      'List the most-viewed subjects (CMS entries, landing pages, etc.) over a recent window. Use this to see what content is actually getting traffic. Filter by `subjectType` to scope to one surface (e.g. `cms_entry`).',
    audiences: ['admin'],
    scopes: ['analytics:read'],
    input: z.object({
      subjectType: z.string().max(32).optional(),
      sinceDays: z.number().int().min(1).max(365).default(30),
      limit: z.number().int().min(1).max(200).default(20),
      source: z.enum(['pixel', 'beacon', 'tracker']).optional(),
    }),
    readOnlyHint: true,
    destructiveHint: false,
  })
  async topSubjects(args: {
    subjectType?: string;
    sinceDays: number;
    limit: number;
    source?: 'pixel' | 'beacon' | 'tracker';
  }): Promise<
    Array<{ subjectType: string; subjectId: string; views: number; visitors: number }>
  > {
    const ctx = getCurrentContext();
    const actor = ctx.actor!;
    const conditions = [
      sql`org_id = ${actor.orgId}`,
      sql`created_at > NOW() - (${args.sinceDays} || ' days')::interval`,
    ];
    if (args.subjectType) conditions.push(sql`subject_type = ${args.subjectType}`);
    if (args.source) conditions.push(sql`source = ${args.source}`);
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

  @McpTool({
    name: 'analytics_top_countries',
    title: 'Analytics: Visitors by country',
    description:
      'Visitor and view counts grouped by ISO 3166-1 alpha-2 country code over a recent window. Requires the backend to have `MUNIN_GEOIP_DB_PATH` configured; rows recorded without a GeoIP DB carry `country = NULL` and roll up into an "unknown" bucket. Filter by `subjectType` (e.g. `page`, `cms_entry`) or `source` to scope.',
    audiences: ['admin'],
    scopes: ['analytics:read'],
    input: z.object({
      subjectType: z.string().max(32).optional(),
      sinceDays: z.number().int().min(1).max(365).default(30),
      limit: z.number().int().min(1).max(200).default(50),
      source: z.enum(['pixel', 'beacon', 'tracker']).optional(),
    }),
    readOnlyHint: true,
    destructiveHint: false,
  })
  async topCountries(args: {
    subjectType?: string;
    sinceDays: number;
    limit: number;
    source?: 'pixel' | 'beacon' | 'tracker';
  }): Promise<Array<{ country: string | null; views: number; visitors: number }>> {
    const ctx = getCurrentContext();
    const actor = ctx.actor!;
    const conditions = [
      sql`org_id = ${actor.orgId}`,
      sql`created_at > NOW() - (${args.sinceDays} || ' days')::interval`,
    ];
    if (args.subjectType) conditions.push(sql`subject_type = ${args.subjectType}`);
    if (args.source) conditions.push(sql`source = ${args.source}`);
    const where = sql.join(conditions, sql` AND `);
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

  @McpTool({
    name: 'analytics_traffic_by_source',
    title: 'Analytics: Traffic by UTM source',
    description:
      'Views and unique visitors grouped by `utm_source` (with `utm_medium` / `utm_campaign` breakdown). Use this to compare campaign attribution: which channels actually drive engaged traffic vs. just clicks. Rows where `utm_source` is NULL (no campaign params on the URL) roll into a single "direct/organic" bucket.',
    audiences: ['admin'],
    scopes: ['analytics:read'],
    input: z.object({
      subjectType: z.string().max(32).optional(),
      sinceDays: z.number().int().min(1).max(365).default(30),
      limit: z.number().int().min(1).max(200).default(50),
      source: z.enum(['pixel', 'beacon', 'tracker']).optional(),
    }),
    readOnlyHint: true,
    destructiveHint: false,
  })
  async trafficBySource(args: {
    subjectType?: string;
    sinceDays: number;
    limit: number;
    source?: 'pixel' | 'beacon' | 'tracker';
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
    const conditions = [
      sql`org_id = ${actor.orgId}`,
      sql`created_at > NOW() - (${args.sinceDays} || ' days')::interval`,
    ];
    if (args.subjectType) conditions.push(sql`subject_type = ${args.subjectType}`);
    if (args.source) conditions.push(sql`source = ${args.source}`);
    const where = sql.join(conditions, sql` AND `);
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

  @McpTool({
    name: 'analytics_referrer_hosts',
    title: 'Analytics: Top referrer hosts',
    description:
      'External traffic sources grouped by the host portion of `referrer`. Use this to see which sites are linking to you (HN, Reddit, partner blogs). Same-origin referrers are excluded server-side via the `excludeHost` argument (typically your own production host); pass it to keep internal navigations from drowning out external referrals. Rows with NULL referrer (direct navigation, bookmarks, link-with-`rel=noreferrer`) roll into a single "direct" bucket.',
    audiences: ['admin'],
    scopes: ['analytics:read'],
    input: z.object({
      subjectType: z.string().max(32).optional(),
      excludeHost: z.string().max(255).optional(),
      sinceDays: z.number().int().min(1).max(365).default(30),
      limit: z.number().int().min(1).max(200).default(50),
      source: z.enum(['pixel', 'beacon', 'tracker']).optional(),
    }),
    readOnlyHint: true,
    destructiveHint: false,
  })
  async referrerHosts(args: {
    subjectType?: string;
    excludeHost?: string;
    sinceDays: number;
    limit: number;
    source?: 'pixel' | 'beacon' | 'tracker';
  }): Promise<Array<{ host: string | null; views: number; visitors: number }>> {
    const ctx = getCurrentContext();
    const actor = ctx.actor!;
    const conditions = [
      sql`org_id = ${actor.orgId}`,
      sql`created_at > NOW() - (${args.sinceDays} || ' days')::interval`,
    ];
    if (args.subjectType) conditions.push(sql`subject_type = ${args.subjectType}`);
    if (args.source) conditions.push(sql`source = ${args.source}`);
    const where = sql.join(conditions, sql` AND `);
    // Extract host from `scheme://host[:port]/...`. Captures everything
    // between `://` and the next `/`, `?`, `#`, or end-of-string. NULL
    // referrers (direct navigation) stay NULL and form the "direct" bucket.
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

  @McpTool({
    name: 'analytics_views_over_time',
    title: 'Analytics: Daily view time-series',
    description:
      'Daily view + unique-visitor counts over a recent window. Returns one row per UTC day, ordered oldest → newest, with zero-filled gaps so days with no traffic appear as `views: 0`. Use this to spot trends, weekly patterns, and the impact of campaigns or content launches.',
    audiences: ['admin'],
    scopes: ['analytics:read'],
    input: z.object({
      subjectType: z.string().max(32).optional(),
      subjectId: z.string().optional(),
      sinceDays: z.number().int().min(1).max(365).default(30),
      source: z.enum(['pixel', 'beacon', 'tracker']).optional(),
    }),
    readOnlyHint: true,
    destructiveHint: false,
  })
  async viewsOverTime(args: {
    subjectType?: string;
    subjectId?: string;
    sinceDays: number;
    source?: 'pixel' | 'beacon' | 'tracker';
  }): Promise<Array<{ day: string; views: number; visitors: number }>> {
    const ctx = getCurrentContext();
    const actor = ctx.actor!;
    const eventConditions = [
      sql`org_id = ${actor.orgId}`,
      sql`created_at > NOW() - (${args.sinceDays} || ' days')::interval`,
    ];
    if (args.subjectType) eventConditions.push(sql`subject_type = ${args.subjectType}`);
    if (args.subjectId) eventConditions.push(sql`subject_id = ${args.subjectId}`);
    if (args.source) eventConditions.push(sql`source = ${args.source}`);
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

  @McpTool({
    name: 'analytics_subject_engagement',
    title: 'Analytics: Engagement for one subject',
    description:
      'View counts, unique visitors, and average dwell/read-depth for one subject (e.g. one CMS entry) over a recent window. Use this when judging whether a stale entry should be refreshed or archived.',
    audiences: ['admin'],
    scopes: ['analytics:read'],
    input: z.object({
      subjectType: z.string().max(32),
      subjectId: z.string(),
      sinceDays: z.number().int().min(1).max(365).default(90),
    }),
    readOnlyHint: true,
    destructiveHint: false,
  })
  async subjectEngagement(args: {
    subjectType: string;
    subjectId: string;
    sinceDays: number;
  }): Promise<{
    views: number;
    visitors: number;
    avgDwellMs: number | null;
    avgReadDepth: number | null;
    lastViewAt: string | null;
  }> {
    const ctx = getCurrentContext();
    const actor = ctx.actor!;
    const rows = await ctx.db.execute<{
      views: number;
      visitors: number;
      avg_dwell_ms: number | null;
      avg_read_depth: number | null;
      // postgres-js returns aggregate timestamp columns as ISO strings when
      // reached via raw `db.execute(sql\`…\`)`. Coerce via `new Date(...)`
      // below — it accepts both strings and Date objects.
      last_view_at: Date | string | null;
    }>(sql`
      SELECT COUNT(*)::int AS views,
             COUNT(DISTINCT visitor_id)::int AS visitors,
             AVG(dwell_ms) FILTER (WHERE dwell_ms IS NOT NULL) AS avg_dwell_ms,
             AVG(read_depth) FILTER (WHERE read_depth IS NOT NULL) AS avg_read_depth,
             MAX(created_at) AS last_view_at
      FROM analytics_view_events
      WHERE org_id = ${actor.orgId}
        AND subject_type = ${args.subjectType}
        AND subject_id = ${args.subjectId}
        AND created_at > NOW() - (${args.sinceDays} || ' days')::interval
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

  @McpTool({
    name: 'analytics_zero_result_searches',
    title: 'Analytics: Zero-result search queries',
    description:
      'List recent public search queries that returned zero results. The single best input for "what should we write about next" — readers are asking but Munin has no answer.',
    audiences: ['admin'],
    scopes: ['analytics:read'],
    input: z.object({
      subjectType: z.string().max(32).optional(),
      sinceDays: z.number().int().min(1).max(365).default(30),
      limit: z.number().int().min(1).max(200).default(50),
    }),
    readOnlyHint: true,
    destructiveHint: false,
  })
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
      // See `analytics_subject_engagement` — raw `db.execute` returns
      // aggregate timestamp columns as ISO strings; coerce below.
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

  @McpTool({
    name: 'analytics_revoke_tracker',
    title: 'Analytics: Revoke tracker key',
    description:
      'Revoke the API key bound to a tracker. After this, the key is rejected by the ingest endpoints — any pages still embedding it will silently fail to record views. The tracker row stays for audit.',
    audiences: ['admin'],
    scopes: ['analytics:write'],
    input: RevokeTrackerInput,
    readOnlyHint: false,
    destructiveHint: true,
  })
  async revokeTracker(args: z.infer<typeof RevokeTrackerInput>): Promise<{ revoked: boolean }> {
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
}
