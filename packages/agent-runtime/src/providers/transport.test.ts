import { describe, it, expect } from 'vitest';
import { parseRetryAfterMs, rateLimitRetryDelayMs } from './transport.ts';

describe('rateLimitRetryDelayMs', () => {
  it('grows exponentially across attempts', () => {
    const half = (): number => 0;
    expect(rateLimitRetryDelayMs(null, 0, half)).toBe(500);
    expect(rateLimitRetryDelayMs(null, 1, half)).toBe(1_000);
    expect(rateLimitRetryDelayMs(null, 2, half)).toBe(2_000);
  });

  it('jitters so that concurrent callers do not retry in lockstep', () => {
    expect(rateLimitRetryDelayMs(null, 0, () => 0)).toBe(500);
    expect(rateLimitRetryDelayMs(null, 0, () => 1)).toBe(1_000);
  });

  it('never waits less than the provider asked for', () => {
    expect(rateLimitRetryDelayMs('3', 0, () => 0)).toBe(3_000);
  });

  it('caps the wait', () => {
    expect(rateLimitRetryDelayMs('600', 4, () => 1)).toBe(15_000);
  });
});

describe('parseRetryAfterMs', () => {
  it('reads delay-seconds', () => {
    expect(parseRetryAfterMs('2')).toBe(2_000);
  });

  it('reads an HTTP date', () => {
    const at = new Date(Date.now() + 4_000).toUTCString();
    const ms = parseRetryAfterMs(at);
    expect(ms).toBeGreaterThan(2_000);
    expect(ms).toBeLessThanOrEqual(5_000);
  });

  it('returns null for a missing or unparseable header', () => {
    expect(parseRetryAfterMs(null)).toBeNull();
    expect(parseRetryAfterMs('soon')).toBeNull();
  });
});
