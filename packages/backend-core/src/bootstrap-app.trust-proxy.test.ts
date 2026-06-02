import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readTrustProxySetting } from './bootstrap-app.ts';

describe('readTrustProxySetting', () => {
  let original: string | undefined;
  beforeEach(() => {
    original = process.env.MUNIN_TRUST_PROXY;
  });
  afterEach(() => {
    if (original === undefined) delete process.env.MUNIN_TRUST_PROXY;
    else process.env.MUNIN_TRUST_PROXY = original;
  });

  it('returns null when unset (Express default: trust nothing)', () => {
    delete process.env.MUNIN_TRUST_PROXY;
    expect(readTrustProxySetting()).toBeNull();
  });

  it('returns null for explicit false/0', () => {
    process.env.MUNIN_TRUST_PROXY = 'false';
    expect(readTrustProxySetting()).toBeNull();
    process.env.MUNIN_TRUST_PROXY = '0';
    expect(readTrustProxySetting()).toBeNull();
  });

  it('returns true for true/1 (trust the first hop)', () => {
    process.env.MUNIN_TRUST_PROXY = 'true';
    expect(readTrustProxySetting()).toBe(true);
    process.env.MUNIN_TRUST_PROXY = '1';
    expect(readTrustProxySetting()).toBe(true);
  });

  it('returns the integer for numeric hop counts', () => {
    process.env.MUNIN_TRUST_PROXY = '2';
    expect(readTrustProxySetting()).toBe(2);
  });

  it('forwards IPs / CIDRs / csv verbatim', () => {
    process.env.MUNIN_TRUST_PROXY = '10.0.0.0/8';
    expect(readTrustProxySetting()).toBe('10.0.0.0/8');
    process.env.MUNIN_TRUST_PROXY = '127.0.0.1, 10.0.0.0/8';
    expect(readTrustProxySetting()).toBe('127.0.0.1, 10.0.0.0/8');
  });
});
