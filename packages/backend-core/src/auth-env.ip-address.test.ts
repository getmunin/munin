import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getIP } from 'better-auth/api';
import { readAuthIpAddressFromEnv } from './auth-env.ts';

const SCALEWAY_CHAIN = '77.223.189.132,100.96.4.33, 100.96.5.92, 100.96.11.106';
const SCALEWAY_CHAIN_WITH_INJECTED_HOPS =
  '203.0.113.7, 100.96.0.1,77.223.189.132,100.96.4.21, 100.96.4.33, 100.96.16.172';

describe('readAuthIpAddressFromEnv', () => {
  const vars = ['MUNIN_AUTH_TRUSTED_PROXIES', 'MUNIN_AUTH_IP_HEADERS'] as const;
  let original: Record<string, string | undefined> = {};

  beforeEach(() => {
    original = Object.fromEntries(vars.map((v) => [v, process.env[v]]));
    for (const v of vars) delete process.env[v];
  });

  afterEach(() => {
    for (const v of vars) {
      const prior = original[v];
      if (prior === undefined) delete process.env[v];
      else process.env[v] = prior;
    }
  });

  it('is undefined when neither var is set, leaving better-auth on its own defaults', () => {
    expect(readAuthIpAddressFromEnv()).toBeUndefined();
  });

  it('splits a csv proxy list and drops blanks', () => {
    process.env.MUNIN_AUTH_TRUSTED_PROXIES = '100.64.0.0/10, ,192.0.2.10';
    expect(readAuthIpAddressFromEnv()).toEqual({
      trustedProxies: ['100.64.0.0/10', '192.0.2.10'],
    });
  });

  it('lowercases header names, since better-auth looks them up on a Headers object', () => {
    process.env.MUNIN_AUTH_IP_HEADERS = 'CF-Connecting-IP, X-Forwarded-For';
    expect(readAuthIpAddressFromEnv()).toEqual({
      ipAddressHeaders: ['cf-connecting-ip', 'x-forwarded-for'],
    });
  });

  it('omits the key a var did not set rather than passing an empty list', () => {
    process.env.MUNIN_AUTH_TRUSTED_PROXIES = '100.64.0.0/10';
    expect(readAuthIpAddressFromEnv()).not.toHaveProperty('ipAddressHeaders');
  });
});

describe('a forwarded chain from a serverless platform', () => {
  it('resolves to the client when the platform hops are the trusted proxies', () => {
    const headers = new Headers({ 'x-forwarded-for': SCALEWAY_CHAIN });
    const resolved = getIP(headers, {
      advanced: { ipAddress: { trustedProxies: ['100.64.0.0/10'] } },
    });
    expect(resolved).toBe('77.223.189.132');
  });

  it('ignores entries a caller prepended, including ones inside the trusted range', () => {
    const headers = new Headers({ 'x-forwarded-for': SCALEWAY_CHAIN_WITH_INJECTED_HOPS });
    const resolved = getIP(headers, {
      advanced: { ipAddress: { trustedProxies: ['100.64.0.0/10'] } },
    });
    expect(resolved).toBe('77.223.189.132');
  });

  it('collapses to one shared bucket without trusted proxies, which is the bug', () => {
    const headers = new Headers({ 'x-forwarded-for': SCALEWAY_CHAIN });
    expect(getIP(headers, { advanced: {} })).not.toBe('77.223.189.132');
  });
});
