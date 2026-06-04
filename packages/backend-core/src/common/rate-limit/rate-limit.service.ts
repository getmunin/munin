import { Injectable } from '@nestjs/common';
import { schema } from '@getmunin/db';
import { sql } from 'drizzle-orm';
import { getCurrentContext } from '@getmunin/core';

export class RateLimitExceededError extends Error {
  readonly code = 'rate_limited';
  constructor(
    public readonly bucket: 'minute' | 'day',
    public readonly limit: number,
    public readonly retryAfterSeconds: number,
  ) {
    super(
      `rate_limited: exceeded ${limit} MCP calls per ${bucket} for this org. Retry in ${retryAfterSeconds}s.`,
    );
  }
}

interface OrgLimits {
  perMinute: number;
  perDay: number;
}

const FREE_TIER_LIMITS: OrgLimits = {
  perMinute: 60,
  perDay: 1_000,
};

type Granularity = 'minute' | 'day' | 'month';

const BUCKETS = {
  mcp_calls_minute: 'minute',
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
 * the MCP-tool-call recipe (record + check minute, record + check day).
 */
@Injectable()
export class RateLimitService {
  /**
   * Increment the bucket's counter for the current window and return the
   * post-bump value. Pure record — never throws on limit; only DB errors.
   *
   * Must be called inside the request transaction; uses `getCurrentContext()`
   * for both the org id and the db handle.
   */
  async record(bucket: Bucket): Promise<number> {
    const ctx = getCurrentContext();
    const orgId = ctx.actor?.orgId;
    if (!orgId) return 0;
    const windowStart = windowStartFor(BUCKETS[bucket], new Date());
    return this.bumpAndCount(orgId, bucket, windowStart);
  }

  /**
   * MCP tool-call gate: bump per-minute and per-day counters and throw
   * `RateLimitExceededError` if either exceeds the org's tier limits.
   */
  async consume(): Promise<void> {
    const ctx = getCurrentContext();
    const orgId = ctx.actor!.orgId;
    if (!orgId) return;

    const limits = await this.loadLimits(orgId);
    const now = new Date();

    const minuteCount = await this.record('mcp_calls_minute');
    if (minuteCount > limits.perMinute) {
      const minuteWindow = windowStartFor('minute', now);
      throw new RateLimitExceededError(
        'minute',
        limits.perMinute,
        Math.ceil((minuteWindow.getTime() + 60_000 - now.getTime()) / 1000),
      );
    }

    const dayCount = await this.record('mcp_calls_day');
    if (dayCount > limits.perDay) {
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
      perMinute: settings.rateLimits?.perMinute ?? FREE_TIER_LIMITS.perMinute,
      perDay: settings.rateLimits?.perDay ?? FREE_TIER_LIMITS.perDay,
    };
  }

  /**
   * Read MCP usage for both windows without consuming. Used by the dashboard
   * usage page.
   */
  async usage(): Promise<{
    minute: { used: number; limit: number; resetAt: string };
    day: { used: number; limit: number; resetAt: string };
  }> {
    const ctx = getCurrentContext();
    const orgId = ctx.actor!.orgId;
    const limits = await this.loadLimits(orgId);
    const now = new Date();
    const minuteWindow = windowStartFor('minute', now);
    const dayWindow = windowStartFor('day', now);

    const rows = await ctx.db.execute<BucketCountRow>(sql`
      SELECT bucket, count::int AS count
      FROM rate_limit_counters
      WHERE org_id = ${orgId}
        AND ((bucket = 'mcp_calls_minute' AND window_start = ${minuteWindow.toISOString()}::timestamptz)
          OR (bucket = 'mcp_calls_day' AND window_start = ${dayWindow.toISOString()}::timestamptz))
    `);
    const byBucket = new Map(rows.map((r) => [r.bucket, r.count]));
    return {
      minute: {
        used: byBucket.get('mcp_calls_minute') ?? 0,
        limit: limits.perMinute,
        resetAt: new Date(minuteWindow.getTime() + 60_000).toISOString(),
      },
      day: {
        used: byBucket.get('mcp_calls_day') ?? 0,
        limit: limits.perDay,
        resetAt: new Date(dayWindow.getTime() + 86_400_000).toISOString(),
      },
    };
  }
}

function windowStartFor(granularity: Granularity, now: Date): Date {
  switch (granularity) {
    case 'minute':
      return new Date(Math.floor(now.getTime() / 60_000) * 60_000);
    case 'day':
      return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    case 'month':
      return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  }
}
