import { describe, expect, it } from 'vitest';
import { redactNationalIdsForPrompt } from './redact-ids.ts';

const NO_SYNTHETIC = '01819012365';

describe('redactNationalIdsForPrompt', () => {
  it('removes a Norwegian fødselsnummer rather than masking it, so no digits reach the model', () => {
    const out = redactNationalIdsForPrompt(`Mitt fnr er ${NO_SYNTHETIC}, kan dere sjekke?`);
    expect(out).toBe('Mitt fnr er [fødselsnummer fjernet], kan dere sjekke?');
    expect(out).not.toContain('018190');
  });

  it('leaves a marker so the agent can tell one was supplied', () => {
    expect(redactNationalIdsForPrompt(NO_SYNTHETIC)).toContain('fjernet');
  });

  it('runs every detector regardless of which ones an org enabled for storage', () => {
    expect(redactNationalIdsForPrompt('900101-1239')).toBe('[personnummer borttaget]');
    expect(redactNationalIdsForPrompt('010190-1234')).toBe('[CPR-nummer fjernet]');
  });

  it('holds the default high-confidence floor, so bare ten-digit runs pass through', () => {
    expect(redactNationalIdsForPrompt('0101901234')).toBe('0101901234');
  });

  it('returns the input unchanged when there is nothing to redact', () => {
    const text = 'Ordrenr 100200300400, ring +47 12345678';
    expect(redactNationalIdsForPrompt(text)).toBe(text);
  });
});
