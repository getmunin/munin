import { Injectable } from '@nestjs/common';
import { schema } from '@getmunin/db';
import { sql } from 'drizzle-orm';
import { getCurrentContext } from '@getmunin/core';

export class RateLimitExceededError extends Error {
  readonly code = 'rate_limited';
  constructor(
    public readonly bucket: 'day',
    public readonly limit: number,
    public readonly retryAfterSeconds: number,
  ) {
    super(
      `rate_limited: exceeded ${limit} MCP calls per ${bucket} for this org. Retry in ${retryAfterSeconds}s.`,
    );
  }
}

interface OrgLimits {
  perDay: number;
}

const FREE_TIER_LIMITS: OrgLimits = {
  perDay: 1_000,
};

type Granularity = 'day' | 'month';

const BUCKETS = {
  mcp_calls_day: 'day',
  api_calls_day: 'day',
  mcp_calls_month: 'month',
  api_calls_month: 'month',
} as const satisfies Record<string, Granularity>;

export type Bucket = keyof typeof BUCKETS;

interface OrgSettings {
  rateLimits?: Partial<OrgLimits>;
}

type BucketCountRow = {
  bucket: string;
  count: number;
} & Record<string, unknown>;

/**
 * Postgres-backed sliding-window counters keyed by `(org, bucket, window_start)`.
 * Each `record(bucket)` upserts the current window and returns the post-bump
 * count. Limit enforcement is the caller's responsibility — `consume()` packages
 * the MCP-tool-call recipe (record + check day). Per-minute burst protection
 * lives in `McpBurstGuard` (in-memory, per replica).
 */
@Injectable()
export class RateLimitService {
  async record(bucket: Bucket): Promise<number> {
    const ctx = getCurrentContext();
    const orgId = ctx.actor?.orgId;
    if (!orgId) return 0;
    const windowStart = windowStartFor(BUCKETS[bucket], new Date());
    return this.bumpAndCount(orgId, bucket, windowStart);
  }

  async consume(): Promise<void> {
    const ctx = getCurrentContext();
    const orgId = ctx.actor!.orgId;
    if (!orgId) return;

    const limits = await this.loadLimits(orgId);
    const dayCount = await this.record('mcp_calls_day');
    if (dayCount > limits.perDay) {
      const now = new Date();
      const dayWindow = windowStartFor('day', now);
      throw new RateLimitExceededError(
        'day',
        limits.perDay,
        Math.ceil((dayWindow.getTime() + 86_400_000 - now.getTime()) / 1000),
      );
    }
  }

  private async bumpAndCount(orgId: string, bucket: Bucket, windowStart: Date): Promise<number> {
    const ctx = getCurrentContext();
    const rows = await ctx.db
      .insert(schema.rateLimitCounters)
      .values({ orgId, bucket, windowStart, count: 1 })
      .onConflictDoUpdate({
        target: [
          schema.rateLimitCounters.orgId,
          schema.rateLimitCounters.bucket,
          schema.rateLimitCounters.windowStart,
        ],
        set: {
          count: sql`${schema.rateLimitCounters.count} + 1`,
        },
      })
      .returning({ count: schema.rateLimitCounters.count });
    return rows[0]?.count ?? 0;
  }

  private async loadLimits(orgId: string): Promise<OrgLimits> {
    const ctx = getCurrentContext();
    const rows = await ctx.db
      .select({ settings: schema.orgs.settings })
      .from(schema.orgs)
      .where(sql`${schema.orgs.id} = ${orgId}`)
      .limit(1);
    const settings = (rows[0]?.settings ?? {}) as OrgSettings;
    return {
      perDay: settings.rateLimits?.perDay ?? FREE_TIER_LIMITS.perDay,
    };
  }

  async usage(): Promise<{
    day: { used: number; limit: number; resetAt: string };
  }> {
    const ctx = getCurrentContext();
    const orgId = ctx.actor!.orgId;
    const limits = await this.loadLimits(orgId);
    const now = new Date();
    const dayWindow = windowStartFor('day', now);

    const rows = await ctx.db.execute<BucketCountRow>(sql`
      SELECT bucket, count::int AS count
      FROM rate_limit_counters
      WHERE org_id = ${orgId}
        AND bucket = 'mcp_calls_day'
        AND window_start = ${dayWindow.toISOString()}::timestamptz
    `);
    const used = rows[0]?.count ?? 0;
    return {
      day: {
        used,
        limit: limits.perDay,
        resetAt: new Date(dayWindow.getTime() + 86_400_000).toISOString(),
      },
    };
  }
}

function windowStartFor(granularity: Granularity, now: Date): Date {
  switch (granularity) {
    case 'day':
      return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    case 'month':
      return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  }
}
