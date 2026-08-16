import { describe, expect, it } from 'vitest';
import { drainCuratorQueue } from './curator-drain.ts';

function harness(options: {
  queue: string[];
  admit?: () => Promise<boolean>;
  execute?: (job: string) => Promise<boolean>;
  maxJobs?: number;
  stopAfter?: number;
  claimThrows?: boolean;
}): {
  run: () => ReturnType<typeof drainCuratorQueue<string>>;
  executed: string[];
  claims: () => number;
} {
  const executed: string[] = [];
  let claims = 0;
  let stopped = false;
  const run = (): ReturnType<typeof drainCuratorQueue<string>> =>
    drainCuratorQueue<string>({
      admit: options.admit ?? (() => Promise.resolve(true)),
      claim: () => {
        claims += 1;
        if (options.claimThrows) return Promise.reject(new Error('claim boom'));
        const next = options.queue.shift();
        return Promise.resolve(next ? [next] : []);
      },
      execute: async (job) => {
        executed.push(job);
        if (options.stopAfter !== undefined && executed.length >= options.stopAfter) stopped = true;
        return options.execute ? await options.execute(job) : false;
      },
      maxJobs: options.maxJobs ?? 25,
      isStopped: () => stopped,
      onClaimError: () => {},
    });
  return { run, executed, claims: () => claims };
}

describe('drainCuratorQueue', () => {
  it('keeps claiming until the queue is empty instead of stopping after one job', async () => {
    const h = harness({ queue: ['a', 'b', 'c'] });
    await expect(h.run()).resolves.toBe('empty');
    expect(h.executed).toEqual(['a', 'b', 'c']);
    expect(h.claims()).toBe(4);
  });

  it('returns empty without executing anything when the queue is already drained', async () => {
    const h = harness({ queue: [] });
    await expect(h.run()).resolves.toBe('empty');
    expect(h.executed).toEqual([]);
  });

  it('stops immediately when the generate gate denies', async () => {
    const h = harness({ queue: ['a', 'b'], admit: () => Promise.resolve(false) });
    await expect(h.run()).resolves.toBe('suppressed');
    expect(h.executed).toEqual([]);
  });

  it('re-checks the gate between jobs so a mid-drain quota stop is honoured', async () => {
    let calls = 0;
    const h = harness({
      queue: ['a', 'b', 'c'],
      admit: () => {
        calls += 1;
        return Promise.resolve(calls <= 2);
      },
    });
    await expect(h.run()).resolves.toBe('suppressed');
    expect(h.executed).toEqual(['a', 'b']);
  });

  it('abandons the rest of the queue when a job fails against the provider', async () => {
    const h = harness({ queue: ['a', 'b', 'c'], execute: (job) => Promise.resolve(job === 'b') });
    await expect(h.run()).resolves.toBe('provider_unhealthy');
    expect(h.executed).toEqual(['a', 'b']);
  });

  it('pauses once the per-drain job budget is spent', async () => {
    const h = harness({ queue: ['a', 'b', 'c', 'd'], maxJobs: 2 });
    await expect(h.run()).resolves.toBe('paused');
    expect(h.executed).toEqual(['a', 'b']);
  });

  it('stops when the worker is torn down mid-drain', async () => {
    const h = harness({ queue: ['a', 'b', 'c'], stopAfter: 1 });
    await expect(h.run()).resolves.toBe('empty');
    expect(h.executed).toEqual(['a']);
  });

  it('reports a failed claim rather than spinning', async () => {
    const h = harness({ queue: ['a'], claimThrows: true });
    await expect(h.run()).resolves.toBe('claim_failed');
    expect(h.claims()).toBe(1);
  });
});
