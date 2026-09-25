import { NATIONAL_ID_DETECTORS, findNationalIds } from '../national-id.ts';
import { PSEUDONYM_EMAIL_DOMAIN } from './tokens.ts';

export type PiiDetectionKind = 'email' | 'phone' | 'national_id' | 'bank_account' | 'card_number';

export interface PiiDetection {
  kind: PiiDetectionKind;
  start: number;
  end: number;
  value: string;
}

export interface DetectPiiOptions {
  isKnownPhone?: (raw: string) => boolean;
}

const EMAIL_PATTERN = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)*\.\p{L}{2,}/gu;
const DIGIT_RUN_PATTERN = /(?<![\p{L}\p{N}_+])\+?\d[\d \t().-]{5,24}\d(?![\p{L}\p{N}_])/gu;
const IBAN_PATTERN = /(?<![\p{L}\p{N}])[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){2,7}(?: ?[A-Z0-9]{1,3})?(?![\p{L}\p{N}])/gu;

const PRIORITY: Record<PiiDetectionKind, number> = {
  national_id: 0,
  email: 1,
  bank_account: 2,
  card_number: 3,
  phone: 4,
};

const NO_ACCOUNT_WEIGHTS = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];

export function detectPii(text: string, options: DetectPiiOptions = {}): PiiDetection[] {
  if (!text) return [];
  const found: PiiDetection[] = [];

  for (const match of findNationalIds(text, NATIONAL_ID_DETECTORS, { minConfidence: 'medium' })) {
    found.push({
      kind: 'national_id',
      start: match.start,
      end: match.end,
      value: text.slice(match.start, match.end),
    });
  }

  for (const match of text.matchAll(EMAIL_PATTERN)) {
    const value = match[0];
    if (value.toLowerCase().endsWith(`@${PSEUDONYM_EMAIL_DOMAIN}`)) continue;
    found.push({ kind: 'email', start: match.index, end: match.index + value.length, value });
  }

  for (const match of text.matchAll(IBAN_PATTERN)) {
    if (!isValidIban(match[0])) continue;
    found.push({
      kind: 'bank_account',
      start: match.index,
      end: match.index + match[0].length,
      value: match[0],
    });
  }

  for (const match of text.matchAll(DIGIT_RUN_PATTERN)) {
    const kind = classifyDigitRun(match[0], options);
    if (!kind) continue;
    found.push({ kind, start: match.index, end: match.index + match[0].length, value: match[0] });
  }

  return resolveOverlaps(found);
}

function classifyDigitRun(raw: string, options: DetectPiiOptions): PiiDetectionKind | null {
  const digits = raw.replace(/\D/g, '');
  if (options.isKnownPhone?.(raw)) return 'phone';
  if (digits.length >= 13 && digits.length <= 19 && /^[\d -]+$/.test(raw) && luhn(digits)) {
    return 'card_number';
  }
  if (digits.length === 11 && /^\d{4}[ .]?\d{2}[ .]?\d{5}$/.test(raw) && isValidNoAccount(digits)) {
    return 'bank_account';
  }
  if (/[\t.]/.test(raw)) return null;
  if (raw.startsWith('+') && digits.length >= 8 && digits.length <= 15) return 'phone';
  if (raw.startsWith('00') && digits.length >= 10 && digits.length <= 17) return 'phone';
  if (/^(?:00|\(?\+?47\)?[ -]?)?[49]\d(?:[ -]?\d){6}$/.test(raw)) return 'phone';
  return null;
}

function resolveOverlaps(found: PiiDetection[]): PiiDetection[] {
  const ranked = [...found].sort((a, b) => {
    if (a.start !== b.start) return a.start - b.start;
    const byLength = b.end - b.start - (a.end - a.start);
    if (byLength !== 0) return byLength;
    return PRIORITY[a.kind] - PRIORITY[b.kind];
  });
  const accepted: PiiDetection[] = [];
  for (const candidate of ranked) {
    const last = accepted[accepted.length - 1];
    if (last && candidate.start < last.end) {
      if (PRIORITY[candidate.kind] < PRIORITY[last.kind] && candidate.end >= last.end) {
        accepted[accepted.length - 1] = candidate;
      }
      continue;
    }
    accepted.push(candidate);
  }
  return accepted;
}

function luhn(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let d = digits.charCodeAt(i) - 48;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

function isValidNoAccount(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < 10; i += 1) sum += (digits.charCodeAt(i) - 48) * NO_ACCOUNT_WEIGHTS[i]!;
  const remainder = sum % 11;
  const check = remainder === 0 ? 0 : 11 - remainder;
  return check !== 10 && check === digits.charCodeAt(10) - 48;
}

function isValidIban(raw: string): boolean {
  const iban = raw.replace(/ /g, '');
  if (iban.length < 15 || iban.length > 34) return false;
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  let remainder = 0;
  for (const char of rearranged) {
    const code = char.charCodeAt(0);
    const value = code >= 65 ? String(code - 55) : char;
    for (const digit of value) remainder = (remainder * 10 + (digit.charCodeAt(0) - 48)) % 97;
  }
  return remainder === 1;
}
