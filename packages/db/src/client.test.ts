import { afterEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_IDLE_TIMEOUT_SECONDS,
  resolveIdleTimeoutSeconds,
  resolvePoolMax,
} from './client.ts';

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

describe('resolveIdleTimeoutSeconds', () => {
  const original = process.env.MUNIN_DB_IDLE_TIMEOUT;

  afterEach(() => {
    if (original === undefined) delete process.env.MUNIN_DB_IDLE_TIMEOUT;
    else process.env.MUNIN_DB_IDLE_TIMEOUT = original;
  });

  it('closes idle connections after a minute when nothing is set', () => {
    delete process.env.MUNIN_DB_IDLE_TIMEOUT;
    expect(resolveIdleTimeoutSeconds(undefined)).toBe(DEFAULT_IDLE_TIMEOUT_SECONDS);
  });

  it('reads MUNIN_DB_IDLE_TIMEOUT from the environment', () => {
    process.env.MUNIN_DB_IDLE_TIMEOUT = '15';
    expect(resolveIdleTimeoutSeconds(undefined)).toBe(15);
  });

  it('treats an empty MUNIN_DB_IDLE_TIMEOUT as unset', () => {
    process.env.MUNIN_DB_IDLE_TIMEOUT = '';
    expect(resolveIdleTimeoutSeconds(undefined)).toBe(DEFAULT_IDLE_TIMEOUT_SECONDS);
  });

  it('reads zero as leaving idle connections open, the postgres.js default', () => {
    process.env.MUNIN_DB_IDLE_TIMEOUT = '0';
    expect(resolveIdleTimeoutSeconds(undefined)).toBeUndefined();
    expect(resolveIdleTimeoutSeconds(0)).toBeUndefined();
  });

  it('prefers the explicit option over the env var', () => {
    process.env.MUNIN_DB_IDLE_TIMEOUT = '15';
    expect(resolveIdleTimeoutSeconds(30)).toBe(30);
  });

  it('rejects env values that are not whole seconds', () => {
    for (const bad of ['abc', '-5', '1.5']) {
      process.env.MUNIN_DB_IDLE_TIMEOUT = bad;
      expect(() => resolveIdleTimeoutSeconds(undefined)).toThrow(/must be an integer/);
    }
  });

  it('rejects explicit values that are not whole seconds', () => {
    for (const bad of [-1, 1.5, Number.NaN]) {
      expect(() => resolveIdleTimeoutSeconds(bad)).toThrow(/non-negative integer/);
    }
  });
});
