import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { parseEnvInt } from '@getmunin/core';

/**
 * Per-IP rate limiting for anonymous public endpoints (CMS delivery,
 * public skills, public suggestions).
 *
 * Authenticated MCP traffic goes through `RateLimitService` instead —
 * that uses `orgs.rateLimitCounters` and respects per-org caps from
 * `orgs.settings.rateLimits`. To avoid double-counting we don't register
 * `ThrottlerGuard` globally; instead each public controller applies it
 * via `@UseGuards(ThrottlerGuard)` explicitly.
 *
 * Defaults: 60 req/min, 1000 req/hr per IP. Tunable via env:
 *   MUNIN_PUBLIC_THROTTLE_MIN  default 60
 *   MUNIN_PUBLIC_THROTTLE_HOUR default 1000
 *
 * In-memory store. Multi-replica deployments enforce per-replica (each
 * container counts independently). For v1 launch this is good enough;
 * upgrade to a Redis store if abuse patterns emerge.
 */
@Module({
  imports: [
    ThrottlerModule.forRoot([
      {
        name: 'public-minute',
        ttl: 60_000,
        limit: parseEnvInt({ name: 'MUNIN_PUBLIC_THROTTLE_MIN', default: 60 }),
      },
      {
        name: 'public-hour',
        ttl: 60 * 60_000,
        limit: parseEnvInt({ name: 'MUNIN_PUBLIC_THROTTLE_HOUR', default: 1_000 }),
      },
    ]),
  ],
  exports: [ThrottlerModule],
})
export class PublicThrottleModule {}
