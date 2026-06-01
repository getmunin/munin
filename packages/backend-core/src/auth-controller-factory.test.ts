import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { assertProductionAuthSecret, requireAuthSecret } from './auth-controller-factory.ts';

describe('assertProductionAuthSecret', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalSecret = process.env.MUNIN_AUTH_SECRET;

  beforeEach(() => {
    delete process.env.NODE_ENV;
    delete process.env.MUNIN_AUTH_SECRET;
  });
  afterEach(() => {
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
    if (originalSecret === undefined) delete process.env.MUNIN_AUTH_SECRET;
    else process.env.MUNIN_AUTH_SECRET = originalSecret;
  });

  it('is a no-op outside production', () => {
    process.env.NODE_ENV = 'development';
    expect(() => assertProductionAuthSecret('short')).not.toThrow();
    expect(() => assertProductionAuthSecret('replace-me-with-strong-random-secret')).not.toThrow();
  });

  it('rejects secrets shorter than 32 characters in production', () => {
    process.env.NODE_ENV = 'production';
    expect(() => assertProductionAuthSecret('a'.repeat(31))).toThrow(/at least 32 characters/);
  });

  it('accepts a 32+ character non-placeholder secret in production', () => {
    process.env.NODE_ENV = 'production';
    expect(() => assertProductionAuthSecret('Z4kP+yV1c3xQ9bN2mL8wF6rE7tH0jU5o')).not.toThrow();
  });

  it('rejects known placeholder shapes even at full length', () => {
    process.env.NODE_ENV = 'production';
    const padded = (s: string) => s + 'x'.repeat(Math.max(0, 33 - s.length));
    expect(() => assertProductionAuthSecret(padded('replace-me-with-strong-random-secret'))).toThrow(
      /placeholder\/dev value/,
    );
    expect(() => assertProductionAuthSecret(padded('dev-secret-do-not-use-in-prod'))).toThrow(
      /placeholder\/dev value/,
    );
    expect(() => assertProductionAuthSecret(padded('changeme-please-rotate-rotate'))).toThrow(
      /placeholder\/dev value/,
    );
    expect(() => assertProductionAuthSecret(padded('test-secret-test-test-test-test'))).toThrow(
      /placeholder\/dev value/,
    );
  });

  it('rejects trivially low-entropy secrets in production', () => {
    process.env.NODE_ENV = 'production';
    expect(() => assertProductionAuthSecret('x'.repeat(64))).toThrow(/placeholder\/dev value/);
    expect(() => assertProductionAuthSecret('a'.repeat(64))).toThrow(/placeholder\/dev value/);
    expect(() => assertProductionAuthSecret('0'.repeat(64))).toThrow(/placeholder\/dev value/);
  });

  it('requireAuthSecret propagates production validation', () => {
    process.env.NODE_ENV = 'production';
    process.env.MUNIN_AUTH_SECRET = 'replace-me-with-strong-random-secret';
    expect(() => requireAuthSecret()).toThrow(/placeholder\/dev value/);
  });
});
