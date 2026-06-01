import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildAuthRateLimit } from './auth.config.ts';

describe('buildAuthRateLimit', () => {
  let originalWindow: string | undefined;
  let originalMax: string | undefined;

  beforeEach(() => {
    originalWindow = process.env.MUNIN_AUTH_RATELIMIT_WINDOW;
    originalMax = process.env.MUNIN_AUTH_RATELIMIT_MAX;
  });
  afterEach(() => {
    if (originalWindow === undefined) delete process.env.MUNIN_AUTH_RATELIMIT_WINDOW;
    else process.env.MUNIN_AUTH_RATELIMIT_WINDOW = originalWindow;
    if (originalMax === undefined) delete process.env.MUNIN_AUTH_RATELIMIT_MAX;
    else process.env.MUNIN_AUTH_RATELIMIT_MAX = originalMax;
  });

  it('is enabled with database storage by default', () => {
    delete process.env.MUNIN_AUTH_RATELIMIT_WINDOW;
    delete process.env.MUNIN_AUTH_RATELIMIT_MAX;
    const cfg = buildAuthRateLimit()!;
    expect(cfg.enabled).toBe(true);
    expect(cfg.storage).toBe('database');
    expect(cfg.window).toBe(60);
    expect(cfg.max).toBe(30);
  });

  it('reads window and max from env', () => {
    process.env.MUNIN_AUTH_RATELIMIT_WINDOW = '120';
    process.env.MUNIN_AUTH_RATELIMIT_MAX = '10';
    const cfg = buildAuthRateLimit()!;
    expect(cfg.window).toBe(120);
    expect(cfg.max).toBe(10);
  });

  it('ratchets sensitive endpoints below the default', () => {
    const cfg = buildAuthRateLimit()!;
    const rules = cfg.customRules as Record<string, { window: number; max: number }>;
    expect(rules['/sign-in/email']).toEqual({ window: 60, max: 5 });
    expect(rules['/forget-password']).toEqual({ window: 60, max: 3 });
    expect(rules['/oauth2/register']).toEqual({ window: 60, max: 10 });
  });
});
