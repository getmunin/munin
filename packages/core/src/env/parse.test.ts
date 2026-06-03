import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  parseEnvBool,
  parseEnvCron,
  parseEnvDisableFlag,
  parseEnvInt,
} from './parse.ts';

const ENV_KEY = '__MUNIN_ENV_PARSE_TEST__';

describe('parseEnvInt', () => {
  beforeEach(() => {
    delete process.env[ENV_KEY];
  });
  afterEach(() => {
    delete process.env[ENV_KEY];
  });

  it('returns parsed integer when value is valid', () => {
    process.env[ENV_KEY] = '42';
    expect(parseEnvInt({ name: ENV_KEY, default: 10 })).toBe(42);
  });

  it('falls back to default when value is missing', () => {
    expect(parseEnvInt({ name: ENV_KEY, default: 10 })).toBe(10);
  });

  it('falls back to default when value is empty string', () => {
    process.env[ENV_KEY] = '';
    expect(parseEnvInt({ name: ENV_KEY, default: 10 })).toBe(10);
  });

  it('falls back to default on unparseable input (no silent NaN)', () => {
    process.env[ENV_KEY] = 'garbage';
    expect(parseEnvInt({ name: ENV_KEY, default: 10 })).toBe(10);
  });

  it('throws when value is missing and no default provided', () => {
    expect(() => parseEnvInt({ name: ENV_KEY })).toThrow(/required/);
  });

  it('throws when out of range with onInvalid=throw', () => {
    process.env[ENV_KEY] = '5000';
    expect(() =>
      parseEnvInt({ name: ENV_KEY, default: 1536, min: 32, max: 4000, onInvalid: 'throw' }),
    ).toThrow(/32\.\.4000/);
  });

  it('falls back when out of range with default and no onInvalid override', () => {
    process.env[ENV_KEY] = '5000';
    expect(parseEnvInt({ name: ENV_KEY, default: 1536, min: 32, max: 4000 })).toBe(1536);
  });

  it('throws on non-integer when no default', () => {
    process.env[ENV_KEY] = 'abc';
    expect(() => parseEnvInt({ name: ENV_KEY })).toThrow(/must be an integer/);
  });
});

describe('parseEnvBool', () => {
  beforeEach(() => {
    delete process.env[ENV_KEY];
  });
  afterEach(() => {
    delete process.env[ENV_KEY];
  });

  it.each([
    ['1', true],
    ['0', false],
    ['true', true],
    ['false', false],
    ['TRUE', true],
    ['False', false],
  ])('parses %j as %s', (raw, expected) => {
    process.env[ENV_KEY] = raw;
    expect(parseEnvBool({ name: ENV_KEY, default: !expected })).toBe(expected);
  });

  it('returns default when unset', () => {
    expect(parseEnvBool({ name: ENV_KEY, default: true })).toBe(true);
    expect(parseEnvBool({ name: ENV_KEY, default: false })).toBe(false);
  });

  it('returns default on unrecognized value', () => {
    process.env[ENV_KEY] = 'yes';
    expect(parseEnvBool({ name: ENV_KEY, default: false })).toBe(false);
  });
});

describe('parseEnvDisableFlag', () => {
  beforeEach(() => {
    delete process.env[ENV_KEY];
  });
  afterEach(() => {
    delete process.env[ENV_KEY];
  });

  it('returns false when unset', () => {
    expect(parseEnvDisableFlag(ENV_KEY)).toBe(false);
  });

  it('returns true for "1"', () => {
    process.env[ENV_KEY] = '1';
    expect(parseEnvDisableFlag(ENV_KEY)).toBe(true);
  });

  it('returns true for "true" (widened from strict =="1")', () => {
    process.env[ENV_KEY] = 'true';
    expect(parseEnvDisableFlag(ENV_KEY)).toBe(true);
  });

  it('returns false for "0"', () => {
    process.env[ENV_KEY] = '0';
    expect(parseEnvDisableFlag(ENV_KEY)).toBe(false);
  });
});

describe('parseEnvCron', () => {
  beforeEach(() => {
    delete process.env[ENV_KEY];
  });
  afterEach(() => {
    delete process.env[ENV_KEY];
  });

  it('returns env value when set', () => {
    process.env[ENV_KEY] = '0 0 * * *';
    expect(parseEnvCron({ name: ENV_KEY, default: '0 12 * * *' })).toBe('0 0 * * *');
  });

  it('returns default when unset or blank', () => {
    expect(parseEnvCron({ name: ENV_KEY, default: '0 12 * * *' })).toBe('0 12 * * *');
    process.env[ENV_KEY] = '   ';
    expect(parseEnvCron({ name: ENV_KEY, default: '0 12 * * *' })).toBe('0 12 * * *');
  });

  it('returns null when value is "off"', () => {
    process.env[ENV_KEY] = 'off';
    expect(parseEnvCron({ name: ENV_KEY, default: '0 12 * * *' })).toBeNull();
  });

  it('returns null when value is "0"', () => {
    process.env[ENV_KEY] = '0';
    expect(parseEnvCron({ name: ENV_KEY, default: '0 12 * * *' })).toBeNull();
  });

  it('returns null when default itself is "off"', () => {
    expect(parseEnvCron({ name: ENV_KEY, default: 'off' })).toBeNull();
  });

  it('trims surrounding whitespace', () => {
    process.env[ENV_KEY] = '  0 * * * *  ';
    expect(parseEnvCron({ name: ENV_KEY, default: 'off' })).toBe('0 * * * *');
  });
});
