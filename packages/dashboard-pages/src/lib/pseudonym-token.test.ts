import { describe, expect, it } from 'vitest';
import { extractPseudonymToken } from './pseudonym-token';

describe('extractPseudonymToken', () => {
  it('reads the token out of every form an AI client might paste', () => {
    for (const input of [
      'abcd2345',
      '[Contact abcd2345]',
      'Contact ABCD2345',
      'contact-abcd2345@pseudonym.invalid',
      '[Phone abcd2345]',
      '  [Contact abcd2345]  ',
    ]) {
      expect(extractPseudonymToken(input), input).toBe('abcd2345');
    }
  });

  it('refuses anything that is not a token', () => {
    for (const input of ['', 'Kari Nordmann', 'abcd234', 'abcd23456', 'abcd1345']) {
      expect(extractPseudonymToken(input), input).toBeNull();
    }
  });
});
