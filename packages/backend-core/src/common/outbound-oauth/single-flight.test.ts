import { describe, it, expect } from 'vitest';
import { SingleFlight } from './single-flight.ts';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (err: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('SingleFlight', () => {
  it('runs once when several callers race for the same key', async () => {
    const flight = new SingleFlight<string>();
    const gate = deferred<string>();
    let runs = 0;

    const all = Promise.all([
      flight.run('k', () => {
        runs += 1;
        return gate.promise;
      }),
      flight.run('k', () => {
        runs += 1;
        return gate.promise;
      }),
    ]);
    gate.resolve('token');

    expect(await all).toEqual(['token', 'token']);
    expect(runs).toBe(1);
  });

  it('keeps separate keys separate', async () => {
    const flight = new SingleFlight<string>();
    const [a, b] = await Promise.all([
      flight.run('a', () => Promise.resolve('one')),
      flight.run('b', () => Promise.resolve('two')),
    ]);
    expect([a, b]).toEqual(['one', 'two']);
  });

  it('releases the key once settled, so a later call really refreshes', async () => {
    const flight = new SingleFlight<string>();
    let runs = 0;
    const work = () => {
      runs += 1;
      return Promise.resolve(`run-${runs}`);
    };
    expect(await flight.run('k', work)).toBe('run-1');
    expect(await flight.run('k', work)).toBe('run-2');
  });

  it('shares a failure with everyone waiting and still releases the key', async () => {
    const flight = new SingleFlight<string>();
    const gate = deferred<string>();
    const first = flight.run('k', () => gate.promise);
    const second = flight.run('k', () => gate.promise);
    gate.reject(new Error('vendor down'));

    await expect(first).rejects.toThrow('vendor down');
    await expect(second).rejects.toThrow('vendor down');
    expect(await flight.run('k', () => Promise.resolve('recovered'))).toBe('recovered');
  });
});
