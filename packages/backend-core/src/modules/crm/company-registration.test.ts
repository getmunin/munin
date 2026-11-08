import { describe, expect, it } from 'vitest';
import { normalizeRegistration, normalizeRegistrationCountry } from './company-registration.ts';
import { CrmInvalidError } from './crm.errors.ts';

describe('normalizeRegistration', () => {
  it.each([
    ['NO', '123456785', '123456785'],
    ['no', '123 456 785', '123456785'],
    ['NO', 'NO 123 456 785 MVA', '123456785'],
    ['NO', '123.456.785', '123456785'],
    ['DK', '01234560', '01234560'],
    ['DK', 'DK 01 23 45 60', '01234560'],
    ['FI', '0000001-9', '00000019'],
    ['FI', 'FI00000019', '00000019'],
    ['SE', '000000-0018', '0000000018'],
    ['SE', '160000000018', '0000000018'],
    ['SE', 'SE000000001801', '0000000018'],
    ['GB', '123', '00000123'],
    ['GB', 'zz123456', 'ZZ123456'],
    ['UK', 'ZZ123456', 'ZZ123456'],
    ['DE', 'HRB 12345', 'HRB12345'],
  ])('%s %s normalizes to %s', (country, number, expected) => {
    expect(normalizeRegistration({ country, number }).number).toBe(expected);
  });

  it('maps the UK alias to the ISO code GB', () => {
    expect(normalizeRegistration({ country: 'uk', number: 'ZZ123456' }).country).toBe('GB');
  });

  it.each([
    ['NO', '123456789'],
    ['NO', '12345678'],
    ['DK', '01234561'],
    ['FI', '0000001-8'],
    ['SE', '000000-0019'],
    ['GB', 'ZZ12345'],
    ['DE', 'HRB_12345'],
    ['DE', ''],
  ])('rejects %s %s', (country, number) => {
    expect(() => normalizeRegistration({ country, number })).toThrow(CrmInvalidError);
  });

  it('rejects a country that is not a two-letter code', () => {
    expect(() => normalizeRegistrationCountry('NOR')).toThrow(/two-letter ISO 3166/);
  });
});
