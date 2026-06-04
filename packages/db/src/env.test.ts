import { afterEach, describe, expect, it } from 'vitest';
import { parseEnvInt } from './env.ts';

const NAME = 'MUNIN_DB_TEST_VAR';

describe('parseEnvInt', () => {
  afterEach(() => {
    delete process.env[NAME];
  });

  it('returns undefined when the env var is unset', () => {
    expect(parseEnvInt(NAME)).toBeUndefined();
  });

  it('returns undefined when the env var is empty', () => {
    process.env[NAME] = '';
    expect(parseEnvInt(NAME)).toBeUndefined();
  });

  it('parses a valid integer', () => {
    process.env[NAME] = '42';
    expect(parseEnvInt(NAME)).toBe(42);
  });

  it('enforces min', () => {
    process.env[NAME] = '0';
    expect(() => parseEnvInt(NAME, { min: 1 })).toThrow(/in 1\.\.∞/);
  });

  it('enforces max', () => {
    process.env[NAME] = '5000';
    expect(() => parseEnvInt(NAME, { max: 4000 })).toThrow(/in -∞\.\.4000/);
  });

  it('enforces both ends', () => {
    process.env[NAME] = '4001';
    expect(() => parseEnvInt(NAME, { min: 32, max: 4000 })).toThrow(/in 32\.\.4000/);
  });

  it('rejects non-numeric values', () => {
    process.env[NAME] = 'abc';
    expect(() => parseEnvInt(NAME)).toThrow(/must be an integer/);
  });

  it('rejects non-integer numbers', () => {
    process.env[NAME] = '1.5';
    expect(() => parseEnvInt(NAME)).toThrow(/must be an integer/);
  });
});
