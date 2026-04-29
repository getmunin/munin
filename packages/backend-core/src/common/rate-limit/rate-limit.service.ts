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

const BUCKETS = {
  minute: 'mcp_calls_minute',
  day: 'mcp_calls_day',
} as const;

interface OrgSettings {
  rateLimits?: Partial<OrgLimits>;
}

type BucketCountRow = {
  bucket: string;
  count: number;
} & Record<string, unknown>;

/**
 * Postgres-backed sliding-window-ish counter for MCP calls.
 *
 * One row per (org, bucket, window_start). Each call atomically inserts or
 * increments the current window's counter, then checks both windows against
 * the org's tier limits. Limits per org live in `orgs.settings.rateLimits`
 * (free-tier defaults if absent). Postgres is fine for this scale; Redis
 * comes later if hot paths demand it.
 */
@Injectable()
export class RateLimitService {
  /**
   * Increment the per-minute and per-day counters for the calling org and
   * throw `RateLimitExceededError` if either cap is now exceeded.
   *
   * Must be called inside a tenant-scoped transaction (TenancyInterceptor).
   * The increment + read happens in that same transaction, so each request
   * is monotonic against itself.
   */
  async consume(): Promise<void> {
    const ctx = getCurrentContext();
    const orgId = ctx.actor!.orgId;
    if (!orgId) return;

    const limits = await this.loadLimits(orgId);
    const now = new Date();
    const minuteWindow = floorTo(now, 60_000);
    const dayWindow = floorToDay(now);

    const minuteCount = await this.bumpAndCount(orgId, BUCKETS.minute, minuteWindow);
    if (minuteCount > limits.perMinute) {
      throw new RateLimitExceededError(
        'minute',
        limits.perMinute,
        Math.ceil((minuteWindow.getTime() + 60_000 - now.getTime()) / 1000),
      );
    }

    const dayCount = await this.bumpAndCount(orgId, BUCKETS.day, dayWindow);
    if (dayCount > limits.perDay) {
      throw new RateLimitExceededError(
        'day',
        limits.perDay,
        Math.ceil((dayWindow.getTime() + 86_400_000 - now.getTime()) / 1000),
      );
    }
  }

  private async bumpAndCount(orgId: string, bucket: string, windowStart: Date): Promise<number> {
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
   * Read current usage for both windows without consuming. Used by the
   * dashboard usage page.
   */
  async usage(): Promise<{
    minute: { used: number; limit: number; resetAt: string };
    day: { used: number; limit: number; resetAt: string };
  }> {
    const ctx = getCurrentContext();
    const orgId = ctx.actor!.orgId;
    const limits = await this.loadLimits(orgId);
    const now = new Date();
    const minuteWindow = floorTo(now, 60_000);
    const dayWindow = floorToDay(now);

    const rows = await ctx.db.execute<BucketCountRow>(sql`
      SELECT bucket, count::int AS count
      FROM rate_limit_counters
      WHERE org_id = ${orgId}
        AND ((bucket = ${BUCKETS.minute} AND window_start = ${minuteWindow.toISOString()}::timestamptz)
          OR (bucket = ${BUCKETS.day} AND window_start = ${dayWindow.toISOString()}::timestamptz))
    `);
    const byBucket = new Map(rows.map((r) => [r.bucket, r.count]));
    return {
      minute: {
        used: byBucket.get(BUCKETS.minute) ?? 0,
        limit: limits.perMinute,
        resetAt: new Date(minuteWindow.getTime() + 60_000).toISOString(),
      },
      day: {
        used: byBucket.get(BUCKETS.day) ?? 0,
        limit: limits.perDay,
        resetAt: new Date(dayWindow.getTime() + 86_400_000).toISOString(),
      },
    };
  }
}

function floorTo(date: Date, ms: number): Date {
  return new Date(Math.floor(date.getTime() / ms) * ms);
}

function floorToDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}
