import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  MIN_PRODUCTION_KEY_LENGTH,
  assertProductionKeySecrets,
  assertProductionSecret,
  readKeyPepper,
} from './production-secrets.ts';
import { hashSecret } from './primitives.ts';

const STRONG = 'Z4kP+yV1c3xQ9bN2mL8wF6rE7tH0jU5o';
const ENV_KEYS = ['NODE_ENV', 'MUNIN_KEY_PEPPER', 'MUNIN_ENCRYPTION_KEY'] as const;

describe('production key secrets', () => {
  const saved: Partial<Record<(typeof ENV_KEYS)[number], string>> = {};

  beforeEach(() => {
    for (const key of ENV_KEYS) saved[key] = process.env[key];
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  function production(env: { pepper?: string; key?: string }): void {
    process.env.NODE_ENV = 'production';
    if (env.pepper === undefined) delete process.env.MUNIN_KEY_PEPPER;
    else process.env.MUNIN_KEY_PEPPER = env.pepper;
    if (env.key === undefined) delete process.env.MUNIN_ENCRYPTION_KEY;
    else process.env.MUNIN_ENCRYPTION_KEY = env.key;
  }

  it('accepts strong values for both', () => {
    production({ pepper: STRONG, key: STRONG });
    expect(() => assertProductionKeySecrets()).not.toThrow();
  });

  it.each([
    ['a missing pepper', { key: STRONG }, /MUNIN_KEY_PEPPER is required in production/],
    ['an empty pepper', { pepper: '', key: STRONG }, /MUNIN_KEY_PEPPER is required in production/],
    ['a missing encryption key', { pepper: STRONG }, /MUNIN_ENCRYPTION_KEY is required in production/],
    [
      'the .env.example pepper',
      { pepper: 'replace-me-with-strong-random-pepper', key: STRONG },
      /MUNIN_KEY_PEPPER looks like a placeholder/,
    ],
    [
      'the .env.example encryption key',
      { pepper: STRONG, key: 'replace-me-with-strong-random-key' },
      /MUNIN_ENCRYPTION_KEY looks like a placeholder/,
    ],
    [
      'a short pepper',
      { pepper: 'Ab1+'.repeat(3), key: STRONG },
      new RegExp(`MUNIN_KEY_PEPPER must be at least ${MIN_PRODUCTION_KEY_LENGTH} characters`),
    ],
    [
      'a dev-looking encryption key',
      { pepper: STRONG, key: 'integration-test-key-do-not-use' },
      /MUNIN_ENCRYPTION_KEY looks like a placeholder/,
    ],
  ])('refuses to boot with %s', (_label, env, message) => {
    production(env);
    expect(() => assertProductionKeySecrets()).toThrow(message);
  });

  it('warns that rotating either value breaks existing data', () => {
    production({ key: STRONG });
    expect(() => assertProductionKeySecrets()).toThrow(/invalidates every existing API key/);
    production({ pepper: STRONG });
    expect(() => assertProductionKeySecrets()).toThrow(/stored channel, connector and LLM secret unreadable/);
  });

  it('skips every check outside production', () => {
    process.env.NODE_ENV = 'test';
    delete process.env.MUNIN_KEY_PEPPER;
    delete process.env.MUNIN_ENCRYPTION_KEY;
    expect(() => assertProductionKeySecrets()).not.toThrow();
    expect(() => assertProductionSecret('MUNIN_KEY_PEPPER', 'replace-me', 16)).not.toThrow();
  });

  it('hashes with an empty pepper outside production but refuses to in production', () => {
    process.env.NODE_ENV = 'test';
    delete process.env.MUNIN_KEY_PEPPER;
    expect(readKeyPepper()).toBe('');
    expect(() => hashSecret('mn_admin_x')).not.toThrow();
    production({ key: STRONG });
    expect(() => hashSecret('mn_admin_x')).toThrow(/MUNIN_KEY_PEPPER is required in production/);
    expect(() => hashSecret('mn_admin_x', 'explicit-pepper')).not.toThrow();
  });
});
