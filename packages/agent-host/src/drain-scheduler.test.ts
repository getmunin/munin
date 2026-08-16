import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDrainScheduler } from './drain-scheduler.ts';

describe('createDrainScheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('spaces out drains enqueued in the same tick instead of running them all at once', () => {
    const scheduler = createDrainScheduler(5_000, () => Date.now());
    const ran: string[] = [];
    for (const id of ['a', 'b', 'c']) scheduler.enqueue(() => ran.push(id));

    vi.advanceTimersByTime(0);
    expect(ran).toEqual(['a']);

    vi.advanceTimersByTime(5_000);
    expect(ran).toEqual(['a', 'b']);

    vi.advanceTimersByTime(5_000);
    expect(ran).toEqual(['a', 'b', 'c']);
  });

  it('does not delay a lone drain that arrives after the spacing window has passed', () => {
    const scheduler = createDrainScheduler(5_000, () => Date.now());
    const ran: string[] = [];
    scheduler.enqueue(() => ran.push('first'));
    vi.advanceTimersByTime(60_000);

    scheduler.enqueue(() => ran.push('second'));
    vi.advanceTimersByTime(0);
    expect(ran).toEqual(['first', 'second']);
  });

  it('cancel prevents a pending drain from running', () => {
    const scheduler = createDrainScheduler(5_000, () => Date.now());
    const ran: string[] = [];
    scheduler.enqueue(() => ran.push('a'));
    const cancel = scheduler.enqueue(() => ran.push('b'));
    cancel();

    vi.advanceTimersByTime(30_000);
    expect(ran).toEqual(['a']);
  });
});
