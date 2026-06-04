import { afterEach, describe, expect, it } from 'vitest';
import { resolvePoolMax } from './client.ts';

describe('resolvePoolMax', () => {
  const original = process.env.MUNIN_DB_POOL_MAX;

  afterEach(() => {
    if (original === undefined) delete process.env.MUNIN_DB_POOL_MAX;
    else process.env.MUNIN_DB_POOL_MAX = original;
  });

  it('returns undefined when nothing is set', () => {
    delete process.env.MUNIN_DB_POOL_MAX;
    expect(resolvePoolMax(undefined)).toBeUndefined();
  });

  it('reads MUNIN_DB_POOL_MAX from the environment', () => {
    process.env.MUNIN_DB_POOL_MAX = '25';
    expect(resolvePoolMax(undefined)).toBe(25);
  });

  it('treats an empty MUNIN_DB_POOL_MAX as unset', () => {
    process.env.MUNIN_DB_POOL_MAX = '';
    expect(resolvePoolMax(undefined)).toBeUndefined();
  });

  it('prefers the explicit option over the env var', () => {
    process.env.MUNIN_DB_POOL_MAX = '25';
    expect(resolvePoolMax(50)).toBe(50);
  });

  it('rejects non-positive-integer env values', () => {
    for (const bad of ['abc', '0', '-5', '1.5']) {
      process.env.MUNIN_DB_POOL_MAX = bad;
      expect(() => resolvePoolMax(undefined)).toThrow(/must be an integer/);
    }
  });

  it('rejects non-positive-integer explicit values', () => {
    for (const bad of [0, -1, 1.5, Number.NaN]) {
      expect(() => resolvePoolMax(bad)).toThrow(/positive integer/);
    }
  });
});
