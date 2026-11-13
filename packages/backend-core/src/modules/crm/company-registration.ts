import { CrmInvalidError } from './crm.errors.ts';

export interface CompanyRegistration {
  country: string;
  number: string;
}

const COUNTRY_ALIASES: Record<string, string> = { UK: 'GB' };

const GENERIC_NUMBER = /^[A-Z0-9]{1,32}$/;

type CountryRule = (compact: string) => string | null;

const RULES: Record<string, CountryRule> = {
  NO: (compact) => {
    const digits = compact.replace(/^NO/, '').replace(/MVA$/, '');
    if (!/^\d{9}$/.test(digits)) return null;
    const check = mod11Check(digits.slice(0, 8), [3, 2, 7, 6, 5, 4, 3, 2]);
    return check === Number(digits[8]) ? digits : null;
  },
  DK: (compact) => {
    const digits = compact.replace(/^DK/, '');
    if (!/^\d{8}$/.test(digits)) return null;
    const weights = [2, 7, 6, 5, 4, 3, 2, 1];
    const sum = [...digits].reduce((acc, d, i) => acc + Number(d) * weights[i]!, 0);
    return sum % 11 === 0 ? digits : null;
  },
  FI: (compact) => {
    const digits = compact.replace(/^FI/, '');
    if (!/^\d{8}$/.test(digits)) return null;
    const check = mod11Check(digits.slice(0, 7), [7, 9, 10, 5, 8, 4, 2]);
    return check === Number(digits[7]) ? digits : null;
  },
  SE: (compact) => {
    const vat = compact.match(/^SE(\d{10})01$/);
    let digits = vat ? vat[1]! : compact.replace(/^SE/, '');
    if (/^\d{12}$/.test(digits)) digits = digits.slice(2);
    if (!/^\d{10}$/.test(digits)) return null;
    return luhnValid(digits) ? digits : null;
  },
  GB: (compact) => {
    const value = /^\d{1,7}$/.test(compact) ? compact.padStart(8, '0') : compact;
    return /^(?=.{8}$)[A-Z]{0,2}\d+$/.test(value) ? value : null;
  },
};

export const CHECKED_REGISTRATION_COUNTRIES = Object.keys(RULES);

export function normalizeRegistrationCountry(country: string): string {
  const upper = country.trim().toUpperCase();
  const code = COUNTRY_ALIASES[upper] ?? upper;
  if (!/^[A-Z]{2}$/.test(code)) {
    throw new CrmInvalidError(
      `registration country must be a two-letter ISO 3166 code such as NO, SE or GB (got "${country}")`,
    );
  }
  return code;
}

export function normalizeRegistration(input: CompanyRegistration): CompanyRegistration {
  const country = normalizeRegistrationCountry(input.country);
  const compact = input.number.toUpperCase().replace(/[\s.\-/]/g, '');
  const rule = RULES[country];
  const number = rule ? rule(compact) : GENERIC_NUMBER.test(compact) ? compact : null;
  if (!number) {
    throw new CrmInvalidError(
      rule
        ? `"${input.number}" is not a valid ${country} business registration number (format or check digit is wrong)`
        : `registration number must be 1-32 letters and digits after removing spaces, dots and dashes (got "${input.number}")`,
    );
  }
  return { country, number };
}

function mod11Check(digits: string, weights: number[]): number | null {
  const sum = [...digits].reduce((acc, d, i) => acc + Number(d) * weights[i]!, 0);
  const remainder = sum % 11;
  if (remainder === 0) return 0;
  if (remainder === 1) return null;
  return 11 - remainder;
}

function luhnValid(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let n = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
  }
  return sum % 10 === 0;
}
