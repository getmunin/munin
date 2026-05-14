import { describe, it, expect } from 'vitest';
import {
  decideRateLimit,
  parseRateLimitDeferral,
  rateLimitDeferralError,
  type SendCounts,
} from './send-rate-limit.js';

const NOW = new Date('2026-05-14T12:00:00.000Z');

function counts(partial: Partial<SendCounts> = {}): SendCounts {
  return {
    lastHourSentCount: 0,
    oldestSentAtInLastHour: null,
    lastDaySentCount: 0,
    oldestSentAtInLastDay: null,
    ...partial,
  };
}

describe('decideRateLimit', () => {
  it('allows when limits are undefined', () => {
    expect(decideRateLimit(undefined, counts(), NOW)).toEqual({ kind: 'allowed' });
  });

  it('allows when limits exist but are all unset', () => {
    expect(decideRateLimit({}, counts({ lastDaySentCount: 99 }), NOW)).toEqual({ kind: 'allowed' });
  });

  it('allows when under both limits', () => {
    expect(
      decideRateLimit(
        { perHourMax: 10, perDayMax: 100 },
        counts({ lastHourSentCount: 5, lastDaySentCount: 50 }),
        NOW,
      ),
    ).toEqual({ kind: 'allowed' });
  });

  it('defers when at per-hour limit and emits per_hour reason', () => {
    const oldest = new Date(NOW.getTime() - 30 * 60 * 1000);
    const decision = decideRateLimit(
      { perHourMax: 5 },
      counts({ lastHourSentCount: 5, oldestSentAtInLastHour: oldest }),
      NOW,
    );
    expect(decision.kind).toBe('deferred');
    if (decision.kind === 'deferred') {
      expect(decision.reason).toBe('per_hour');
      expect(decision.nextAttemptAt.getTime()).toBe(
        oldest.getTime() + 60 * 60 * 1000 + 1_000,
      );
    }
  });

  it('defers when at per-day limit and emits per_day reason', () => {
    const oldest = new Date(NOW.getTime() - 6 * 60 * 60 * 1000);
    const decision = decideRateLimit(
      { perDayMax: 100 },
      counts({ lastDaySentCount: 100, oldestSentAtInLastDay: oldest }),
      NOW,
    );
    expect(decision.kind).toBe('deferred');
    if (decision.kind === 'deferred') {
      expect(decision.reason).toBe('per_day');
      expect(decision.nextAttemptAt.getTime()).toBe(
        oldest.getTime() + 24 * 60 * 60 * 1000 + 1_000,
      );
    }
  });

  it('picks the later unblock time when both limits exceeded', () => {
    const oldestHour = new Date(NOW.getTime() - 30 * 60 * 1000);
    const oldestDay = new Date(NOW.getTime() - 2 * 60 * 60 * 1000);
    const decision = decideRateLimit(
      { perHourMax: 5, perDayMax: 50 },
      counts({
        lastHourSentCount: 5,
        oldestSentAtInLastHour: oldestHour,
        lastDaySentCount: 50,
        oldestSentAtInLastDay: oldestDay,
      }),
      NOW,
    );
    expect(decision.kind).toBe('deferred');
    if (decision.kind === 'deferred') {
      const dayUnblock = oldestDay.getTime() + 24 * 60 * 60 * 1000 + 1_000;
      expect(decision.nextAttemptAt.getTime()).toBe(dayUnblock);
      expect(decision.reason).toBe('per_day');
    }
  });

  it('floors unblock time to now if computed value is in the past', () => {
    const oldest = new Date(NOW.getTime() - 2 * 60 * 60 * 1000);
    const decision = decideRateLimit(
      { perHourMax: 1 },
      counts({ lastHourSentCount: 1, oldestSentAtInLastHour: oldest }),
      NOW,
    );
    expect(decision.kind).toBe('deferred');
    if (decision.kind === 'deferred') {
      expect(decision.nextAttemptAt.getTime()).toBe(NOW.getTime() + 1_000);
    }
  });
});

describe('rateLimitDeferralError / parseRateLimitDeferral', () => {
  it('round-trips', () => {
    const until = new Date('2026-05-15T08:00:00.000Z');
    const encoded = rateLimitDeferralError({
      kind: 'deferred',
      nextAttemptAt: until,
      reason: 'per_day',
    });
    expect(encoded).toBe('rate_limited:per_day:until=2026-05-15T08:00:00.000Z');
    expect(parseRateLimitDeferral(encoded)).toEqual({ reason: 'per_day', until });
  });

  it('returns null for unrelated errors', () => {
    expect(parseRateLimitDeferral(null)).toBeNull();
    expect(parseRateLimitDeferral('SMTP refused')).toBeNull();
    expect(parseRateLimitDeferral('rate_limited:bad')).toBeNull();
  });
});
