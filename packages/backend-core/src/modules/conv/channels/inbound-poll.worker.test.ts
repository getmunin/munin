import { describe, expect, it } from 'vitest';
import { pollBackoffMs } from './inbound-poll.worker.ts';

describe('pollBackoffMs', () => {
  it('keeps the normal cadence after a single failure', () => {
    expect(pollBackoffMs(0, 60_000)).toBe(0);
    expect(pollBackoffMs(1, 60_000)).toBe(0);
  });

  it('doubles the gap for each further failure in a row', () => {
    expect(pollBackoffMs(2, 60_000)).toBe(120_000);
    expect(pollBackoffMs(3, 60_000)).toBe(240_000);
    expect(pollBackoffMs(4, 60_000)).toBe(480_000);
  });

  it('never waits longer than fifteen minutes', () => {
    expect(pollBackoffMs(5, 60_000)).toBe(15 * 60_000);
    expect(pollBackoffMs(40, 60_000)).toBe(15 * 60_000);
  });
});
