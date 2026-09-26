import { describe, it, expect } from 'vitest';
import { ConversationRateLimiter } from './teams-rate-limiter.ts';

describe('ConversationRateLimiter', () => {
  it('lets sends through until a window fills, then reports when the oldest send expires', () => {
    const limiter = new ConversationRateLimiter([{ ms: 1_000, max: 3 }]);
    const t0 = 10_000;
    for (let i = 0; i < 3; i++) {
      expect(limiter.waitMs('c1', t0 + i)).toBe(0);
      limiter.record('c1', t0 + i);
    }
    expect(limiter.waitMs('c1', t0 + 10)).toBe(990);
    expect(limiter.waitMs('c1', t0 + 1_000)).toBe(0);
  });

  it('keeps separate budgets per conversation key', () => {
    const limiter = new ConversationRateLimiter([{ ms: 1_000, max: 1 }]);
    limiter.record('c1', 0);
    expect(limiter.waitMs('c1', 1)).toBeGreaterThan(0);
    expect(limiter.waitMs('c2', 1)).toBe(0);
  });

  it('honours the longest window that is exhausted', () => {
    const limiter = new ConversationRateLimiter([
      { ms: 1_000, max: 10 },
      { ms: 30_000, max: 2 },
    ]);
    limiter.record('c1', 0);
    limiter.record('c1', 5_000);
    expect(limiter.waitMs('c1', 6_000)).toBe(24_000);
  });
});
