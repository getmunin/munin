import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readTurnstileCaptchaFromEnv } from './auth-env.ts';

describe('readTurnstileCaptchaFromEnv', () => {
  let originalSite: string | undefined;
  let originalSecret: string | undefined;

  beforeEach(() => {
    originalSite = process.env.TURNSTILE_SITE_KEY;
    originalSecret = process.env.TURNSTILE_SECRET_KEY;
  });
  afterEach(() => {
    if (originalSite === undefined) delete process.env.TURNSTILE_SITE_KEY;
    else process.env.TURNSTILE_SITE_KEY = originalSite;
    if (originalSecret === undefined) delete process.env.TURNSTILE_SECRET_KEY;
    else process.env.TURNSTILE_SECRET_KEY = originalSecret;
  });

  it('returns undefined when neither key is set', () => {
    delete process.env.TURNSTILE_SITE_KEY;
    delete process.env.TURNSTILE_SECRET_KEY;
    expect(readTurnstileCaptchaFromEnv()).toBeUndefined();
  });

  it('returns undefined when only the site key is set', () => {
    process.env.TURNSTILE_SITE_KEY = 'site';
    delete process.env.TURNSTILE_SECRET_KEY;
    expect(readTurnstileCaptchaFromEnv()).toBeUndefined();
  });

  it('returns undefined when only the secret key is set', () => {
    delete process.env.TURNSTILE_SITE_KEY;
    process.env.TURNSTILE_SECRET_KEY = 'secret';
    expect(readTurnstileCaptchaFromEnv()).toBeUndefined();
  });

  it('returns the config only when both keys are set', () => {
    process.env.TURNSTILE_SITE_KEY = 'site';
    process.env.TURNSTILE_SECRET_KEY = 'secret';
    expect(readTurnstileCaptchaFromEnv()).toEqual({
      provider: 'cloudflare-turnstile',
      secretKey: 'secret',
      siteKey: 'site',
    });
  });
});
