import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { McpTool } from '@getmunin/mcp-toolkit';
import { schema } from '@getmunin/db';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { buildApiKey, getCurrentContext, hashSecret, keyPrefix } from '@getmunin/core';

const CreateTrackerInput = z.object({
  name: z.string().min(1).max(120),
});

const RevokeTrackerInput = z.object({
  trackerId: z.string(),
});

interface TrackerSummary {
  id: string;
  name: string;
  keyPrefix: string;
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
      'Mint a public `mn_track_*` API key for a website / app surface. The key is safe to embed in `<script>` tags or mobile clients — it can only write page-view events scoped to your org, never read them. Returns the plaintext key once; store it where it needs to be embedded.',
    audiences: ['admin'],
    scopes: ['analytics:write'],
    input: CreateTrackerInput,
    readOnlyHint: false,
    destructiveHint: false,
  })
  async createTracker(args: z.infer<typeof CreateTrackerInput>): Promise<CreateTrackerResult> {
    const ctx = getCurrentContext();
    const actor = ctx.actor!;
    const rawKey = buildApiKey('track');
    const [row] = await ctx.db
      .insert(schema.apiKeys)
      .values({
        orgId: actor.orgId,
        type: 'track',
        name: args.name,
        keyHash: hashSecret(rawKey),
        keyPrefix: keyPrefix(rawKey),
        scopes: ['analytics:track:write'],
        audiences: ['public'],
        createdByUserId: actor.userId ?? null,
      })
      .returning();
    return {
      id: row!.id,
      name: row!.name,
      keyPrefix: row!.keyPrefix,
      createdAt: row!.createdAt.toISOString(),
      lastUsedAt: null,
      revokedAt: null,
      trackerKey: rawKey,
    };
  }

  @McpTool({
    name: 'analytics_list_trackers',
    title: 'Analytics: List tracker keys',
    description:
      'List all `mn_track_*` API keys for the current org. Plaintext keys are never returned; rotate via `analytics_revoke_tracker` + `analytics_create_tracker`.',
    audiences: ['admin'],
    scopes: ['analytics:read'],
    input: z.object({ includeRevoked: z.boolean().optional() }),
    readOnlyHint: true,
    destructiveHint: false,
  })
  async listTrackers(args: { includeRevoked?: boolean }): Promise<TrackerSummary[]> {
    const ctx = getCurrentContext();
    const actor = ctx.actor!;
    const where = args.includeRevoked
      ? and(eq(schema.apiKeys.orgId, actor.orgId), eq(schema.apiKeys.type, 'track'))
      : and(
          eq(schema.apiKeys.orgId, actor.orgId),
          eq(schema.apiKeys.type, 'track'),
          isNull(schema.apiKeys.revokedAt),
        );
    const rows = await ctx.db.select().from(schema.apiKeys).where(where);
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      keyPrefix: r.keyPrefix,
      createdAt: r.createdAt.toISOString(),
      lastUsedAt: r.lastUsedAt?.toISOString() ?? null,
      revokedAt: r.revokedAt?.toISOString() ?? null,
    }));
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
      last_view_at: Date | null;
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
      lastViewAt: r.last_view_at ? r.last_view_at.toISOString() : null,
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
      last_seen_at: Date;
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
      lastSeenAt: r.last_seen_at.toISOString(),
    }));
  }

  @McpTool({
    name: 'analytics_revoke_tracker',
    title: 'Analytics: Revoke tracker key',
    description:
      'Revoke a tracker key by id. After this, the key is rejected by the ingest endpoints — any pages still embedding it will silently fail to record views.',
    audiences: ['admin'],
    scopes: ['analytics:write'],
    input: RevokeTrackerInput,
    readOnlyHint: false,
    destructiveHint: true,
  })
  async revokeTracker(args: z.infer<typeof RevokeTrackerInput>): Promise<{ revoked: boolean }> {
    const ctx = getCurrentContext();
    const actor = ctx.actor!;
    const result = await ctx.db
      .update(schema.apiKeys)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(schema.apiKeys.id, args.trackerId),
          eq(schema.apiKeys.orgId, actor.orgId),
          eq(schema.apiKeys.type, 'track'),
        ),
      )
      .returning({ id: schema.apiKeys.id });
    return { revoked: result.length > 0 };
  }
}
