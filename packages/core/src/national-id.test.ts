import { describe, expect, it } from 'vitest';
import {
  countNationalIds,
  findNationalIds,
  redactNationalIds,
  type NationalIdDetector,
} from './national-id.ts';

const ALL: readonly NationalIdDetector[] = ['no_fnr', 'se_pnr', 'dk_cpr'];

const NO_SYNTHETIC = '01819012365';
const NO_SYNTHETIC_D_NUMBER = '41819012359';
const NO_H_NUMBER = '01419012382';
const SE_SHORT = '9001011239';
const SE_LONG = '199001011239';
const SE_COORDINATION = '9001611236';
const DK = '0101901234';

describe('no_fnr', () => {
  it('matches a synthetic fødselsnummer whose month carries Skatteetaten +80', () => {
    const matches = findNationalIds(NO_SYNTHETIC, ['no_fnr']);
    expect(matches).toEqual([{ detector: 'no_fnr', confidence: 'high', start: 0, end: 11 }]);
  });

  it('matches a D-number, whose day carries +40', () => {
    expect(findNationalIds(NO_SYNTHETIC_D_NUMBER, ['no_fnr'])).toHaveLength(1);
  });

  it('matches an H-number, whose month carries +40', () => {
    expect(findNationalIds(NO_H_NUMBER, ['no_fnr'])).toHaveLength(1);
  });

  it('accepts a single space or hyphen before the personnummer', () => {
    const spaced = `${NO_SYNTHETIC.slice(0, 6)} ${NO_SYNTHETIC.slice(6)}`;
    const hyphenated = `${NO_SYNTHETIC.slice(0, 6)}-${NO_SYNTHETIC.slice(6)}`;
    expect(findNationalIds(spaced, ['no_fnr'])).toHaveLength(1);
    expect(findNationalIds(hyphenated, ['no_fnr'])).toHaveLength(1);
  });

  it('rejects a number whose second check digit is wrong', () => {
    const broken = `${NO_SYNTHETIC.slice(0, 10)}${(Number(NO_SYNTHETIC[10]) + 1) % 10}`;
    expect(findNationalIds(broken, ['no_fnr'])).toEqual([]);
  });

  it('rejects a number whose first check digit is wrong', () => {
    const broken = `${NO_SYNTHETIC.slice(0, 9)}${(Number(NO_SYNTHETIC[9]) + 1) % 10}${NO_SYNTHETIC[10]}`;
    expect(findNationalIds(broken, ['no_fnr'])).toEqual([]);
  });

  it('rejects an impossible date even when both check digits hold', () => {
    expect(findNationalIds('00000000000', ['no_fnr'])).toEqual([]);
  });

  it('finds every occurrence in a multi-line body', () => {
    const body = `Hei\n\nFødselsnummer: ${NO_SYNTHETIC}\nEktefelle: ${NO_SYNTHETIC_D_NUMBER}\n\nMvh`;
    expect(findNationalIds(body, ['no_fnr'])).toHaveLength(2);
  });
});

describe('no_fnr false positives', () => {
  it('ignores a dotted kontonummer, which has no eleven-digit run', () => {
    expect(findNationalIds('Kontonummer 1234.56.78903', ALL)).toEqual([]);
  });

  it('ignores digit runs longer than the identifier', () => {
    expect(findNationalIds('Ordrenr 100200300400500', ALL)).toEqual([]);
  });

  it('ignores an international phone number', () => {
    expect(findNationalIds('Ring meg på +47 12345678', ALL)).toEqual([]);
  });

  it('ignores ISO dates and times', () => {
    expect(findNationalIds('Levert 2026-09-17 kl 09:15:00', ALL)).toEqual([]);
  });

  it('does not match an eleven-digit run as a ten-digit identifier', () => {
    expect(findNationalIds(NO_SYNTHETIC, ['se_pnr', 'dk_cpr'])).toEqual([]);
  });
});

describe('se_pnr', () => {
  it('matches the ten-digit form with a separator at high confidence', () => {
    const matches = findNationalIds('900101-1239', ['se_pnr']);
    expect(matches).toEqual([{ detector: 'se_pnr', confidence: 'high', start: 0, end: 11 }]);
  });

  it('matches the twelve-digit form', () => {
    expect(findNationalIds(SE_LONG, ['se_pnr'])).toHaveLength(1);
  });

  it('matches a samordningsnummer, whose day carries +60', () => {
    expect(findNationalIds(SE_COORDINATION, ['se_pnr'], { minConfidence: 'medium' })).toHaveLength(1);
  });

  it('treats a bare ten-digit run as medium confidence, so it is dropped by default', () => {
    expect(findNationalIds(SE_SHORT, ['se_pnr'])).toEqual([]);
    expect(findNationalIds(SE_SHORT, ['se_pnr'], { minConfidence: 'medium' })).toHaveLength(1);
  });

  it('accepts the + separator used for people over one hundred', () => {
    expect(findNationalIds('900101+1239', ['se_pnr'])).toHaveLength(1);
  });

  it('rejects a failed Luhn check digit', () => {
    expect(findNationalIds('900101-1230', ['se_pnr'])).toEqual([]);
  });

  it('rejects an organisationsnummer, whose month pair is never a real month', () => {
    expect(findNationalIds('556677-8899', ALL, { minConfidence: 'medium' })).toEqual([]);
  });
});

describe('dk_cpr', () => {
  it('matches the hyphenated form at high confidence', () => {
    const matches = findNationalIds('010190-1234', ['dk_cpr']);
    expect(matches).toEqual([{ detector: 'dk_cpr', confidence: 'high', start: 0, end: 11 }]);
  });

  it('treats a bare ten-digit run as medium confidence, because Denmark dropped the modulus-11 check in 2007', () => {
    expect(findNationalIds(DK, ['dk_cpr'])).toEqual([]);
    expect(findNationalIds(DK, ['dk_cpr'], { minConfidence: 'medium' })).toHaveLength(1);
  });

  it('rejects an impossible date', () => {
    expect(findNationalIds('990990-1234', ['dk_cpr'])).toEqual([]);
  });

  it('does not collide with a Swedish personnummer, because the date fields are in the opposite order', () => {
    expect(findNationalIds('900101-1239', ALL)).toEqual([
      { detector: 'se_pnr', confidence: 'high', start: 0, end: 11 },
    ]);
    expect(findNationalIds('010190-1234', ALL)).toEqual([
      { detector: 'dk_cpr', confidence: 'high', start: 0, end: 11 },
    ]);
  });
});

describe('detector selection', () => {
  it('finds nothing when no detector is enabled', () => {
    expect(findNationalIds(NO_SYNTHETIC, [])).toEqual([]);
  });

  it('only reports detectors the org opted into', () => {
    expect(findNationalIds(NO_SYNTHETIC, ['se_pnr', 'dk_cpr'])).toEqual([]);
  });

  it('breaks a tie at the same offset by the caller-supplied detector order', () => {
    const ambiguous = '030507-1235';
    const seFirst = findNationalIds(ambiguous, ['se_pnr', 'dk_cpr']);
    const dkFirst = findNationalIds(ambiguous, ['dk_cpr', 'se_pnr']);
    expect(seFirst.map((m) => m.detector)).toEqual(['se_pnr']);
    expect(dkFirst.map((m) => m.detector)).toEqual(['dk_cpr']);
  });
});

describe('redactNationalIds', () => {
  it('masks a fødselsnummer down to its birth date', () => {
    const text = `Mitt fnr er ${NO_SYNTHETIC}.`;
    const out = redactNationalIds(text, findNationalIds(text, ['no_fnr']), 'mask');
    expect(out).toBe('Mitt fnr er 018190*****.');
  });

  it('removes a fødselsnummer behind a Norwegian marker', () => {
    const text = `Mitt fnr er ${NO_SYNTHETIC}.`;
    const out = redactNationalIds(text, findNationalIds(text, ['no_fnr']), 'remove');
    expect(out).toBe('Mitt fnr er [fødselsnummer fjernet].');
  });

  it('uses the language of the identifier, not of the reader', () => {
    const se = redactNationalIds('900101-1239', findNationalIds('900101-1239', ALL), 'remove');
    const dk = redactNationalIds('010190-1234', findNationalIds('010190-1234', ALL), 'remove');
    expect(se).toBe('[personnummer borttaget]');
    expect(dk).toBe('[CPR-nummer fjernet]');
  });

  it('keeps the century when masking the twelve-digit Swedish form', () => {
    const out = redactNationalIds(SE_LONG, findNationalIds(SE_LONG, ['se_pnr']), 'mask');
    expect(out).toBe('19900101-****');
  });

  it('normalises a separated fødselsnummer to the canonical masked form', () => {
    const text = `018190 12365`;
    const out = redactNationalIds(text, findNationalIds(text, ['no_fnr']), 'mask');
    expect(out).toBe('018190*****');
  });

  it('redacts every occurrence and leaves surrounding text intact', () => {
    const text = `A ${NO_SYNTHETIC} B ${NO_SYNTHETIC_D_NUMBER} C`;
    const out = redactNationalIds(text, findNationalIds(text, ['no_fnr']), 'remove');
    expect(out).toBe('A [fødselsnummer fjernet] B [fødselsnummer fjernet] C');
  });

  it('returns the input unchanged when nothing matched', () => {
    expect(redactNationalIds('ingenting her', [], 'remove')).toBe('ingenting her');
  });
});

describe('countNationalIds', () => {
  it('buckets by detector and confidence without carrying any digits', () => {
    const text = `${NO_SYNTHETIC} ${NO_SYNTHETIC_D_NUMBER} 010190-1234`;
    const counts = countNationalIds(findNationalIds(text, ALL));
    expect(counts).toEqual([
      { detector: 'no_fnr', confidence: 'high', count: 2 },
      { detector: 'dk_cpr', confidence: 'high', count: 1 },
    ]);
  });
});
