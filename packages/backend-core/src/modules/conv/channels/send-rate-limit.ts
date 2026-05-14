import type { SendLimits } from '@getmunin/types';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const REOPEN_BUFFER_MS = 1_000;

export interface SendCounts {
  lastHourSentCount: number;
  oldestSentAtInLastHour: Date | null;
  lastDaySentCount: number;
  oldestSentAtInLastDay: Date | null;
}

export type RateLimitDecision =
  | { kind: 'allowed' }
  | { kind: 'deferred'; nextAttemptAt: Date; reason: 'per_hour' | 'per_day' };

export function decideRateLimit(
  limits: SendLimits | undefined,
  counts: SendCounts,
  now: Date,
): RateLimitDecision {
  if (!limits) return { kind: 'allowed' };
  const perHour = limits.perHourMax;
  const perDay = limits.perDayMax;
  if (!perHour && !perDay) return { kind: 'allowed' };

  const hourBlocked =
    perHour !== undefined && counts.lastHourSentCount >= perHour && counts.oldestSentAtInLastHour;
  const dayBlocked =
    perDay !== undefined && counts.lastDaySentCount >= perDay && counts.oldestSentAtInLastDay;

  if (!hourBlocked && !dayBlocked) return { kind: 'allowed' };

  const hourUnblockAt = hourBlocked
    ? new Date(counts.oldestSentAtInLastHour!.getTime() + HOUR_MS + REOPEN_BUFFER_MS)
    : null;
  const dayUnblockAt = dayBlocked
    ? new Date(counts.oldestSentAtInLastDay!.getTime() + DAY_MS + REOPEN_BUFFER_MS)
    : null;

  let nextMs = Number.NEGATIVE_INFINITY;
  let reason: 'per_hour' | 'per_day' = 'per_day';
  if (hourUnblockAt) {
    nextMs = hourUnblockAt.getTime();
    reason = 'per_hour';
  }
  if (dayUnblockAt && dayUnblockAt.getTime() >= nextMs) {
    nextMs = dayUnblockAt.getTime();
    reason = 'per_day';
  }

  const floored = nextMs < now.getTime() ? now.getTime() + REOPEN_BUFFER_MS : nextMs;
  return { kind: 'deferred', nextAttemptAt: new Date(floored), reason };
}

export function rateLimitDeferralError(decision: Extract<RateLimitDecision, { kind: 'deferred' }>): string {
  return `rate_limited:${decision.reason}:until=${decision.nextAttemptAt.toISOString()}`;
}

export function parseRateLimitDeferral(
  error: string | null,
): { reason: 'per_hour' | 'per_day'; until: Date } | null {
  if (!error) return null;
  const m = /^rate_limited:(per_hour|per_day):until=(.+)$/.exec(error);
  if (!m) return null;
  const date = new Date(m[2]!);
  if (Number.isNaN(date.getTime())) return null;
  return { reason: m[1] as 'per_hour' | 'per_day', until: date };
}
