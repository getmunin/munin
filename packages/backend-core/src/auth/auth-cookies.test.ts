import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { authCookiePrefix, sessionCookieNames } from './auth-cookies.ts';

describe('auth cookie prefix', () => {
  let original: string | undefined;

  beforeEach(() => {
    original = process.env.MUNIN_AUTH_COOKIE_PREFIX;
  });
  afterEach(() => {
    if (original === undefined) delete process.env.MUNIN_AUTH_COOKIE_PREFIX;
    else process.env.MUNIN_AUTH_COOKIE_PREFIX = original;
  });

  it('defaults to better-auth', () => {
    delete process.env.MUNIN_AUTH_COOKIE_PREFIX;
    expect(authCookiePrefix()).toBe('better-auth');
    expect(sessionCookieNames()).toEqual([
      'better-auth.session_token',
      '__Secure-better-auth.session_token',
    ]);
  });

  it('uses MUNIN_AUTH_COOKIE_PREFIX when set', () => {
    process.env.MUNIN_AUTH_COOKIE_PREFIX = 'munin-dev';
    expect(sessionCookieNames()).toEqual([
      'munin-dev.session_token',
      '__Secure-munin-dev.session_token',
    ]);
  });

  it('falls back to the default for blank values', () => {
    process.env.MUNIN_AUTH_COOKIE_PREFIX = '  ';
    expect(authCookiePrefix()).toBe('better-auth');
  });
});
