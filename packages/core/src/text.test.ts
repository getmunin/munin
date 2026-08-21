import { describe, expect, it } from 'vitest';
import { normalizeForCompare, sameAfterNormalizing } from './text.ts';

describe('normalizeForCompare', () => {
  it('trims and collapses runs of whitespace', () => {
    expect(normalizeForCompare('  we open   at\n\n10am  ')).toBe('we open at 10am');
  });

  it('leaves already-normal text untouched', () => {
    expect(normalizeForCompare('we open at 10am')).toBe('we open at 10am');
  });
});

describe('sameAfterNormalizing', () => {
  it('treats a reflowed draft as unchanged', () => {
    expect(sameAfterNormalizing('We open at 10am.', '  We open\nat 10am.  ')).toBe(true);
  });

  it('treats a corrected fact as changed', () => {
    expect(sameAfterNormalizing('We open at 10am.', 'We open at 09am.')).toBe(false);
  });

  it('does not fold case or punctuation differences away', () => {
    expect(sameAfterNormalizing('We open at 10am', 'we open at 10am')).toBe(false);
  });
});
