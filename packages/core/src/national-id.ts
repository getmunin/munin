export type NationalIdDetector = 'no_fnr' | 'se_pnr' | 'dk_cpr';
export type NationalIdConfidence = 'high' | 'medium';
export type NationalIdPolicy = 'off' | 'mask' | 'remove';

export const NATIONAL_ID_DETECTORS: readonly NationalIdDetector[] = ['no_fnr', 'se_pnr', 'dk_cpr'];

export interface NationalIdMatch {
  detector: NationalIdDetector;
  confidence: NationalIdConfidence;
  start: number;
  end: number;
}

interface Candidate extends NationalIdMatch {
  digits: string;
}

const NO_K1_WEIGHTS = [3, 7, 6, 1, 8, 9, 4, 5, 2];
const NO_K2_WEIGHTS = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];

const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

const PATTERN_NO = /(?<!\d)(\d{6})[ -]?(\d{5})(?!\d)/g;
const PATTERN_SHORT = /(?<!\d)(\d{6})([-+]?)(\d{4})(?!\d)/g;
const PATTERN_LONG = /(?<!\d)(\d{8})([-+]?)(\d{4})(?!\d)/g;

const CONFIDENCE_RANK: Record<NationalIdConfidence, number> = { high: 2, medium: 1 };

const REMOVAL_MARKER: Record<NationalIdDetector, string> = {
  no_fnr: '[fødselsnummer fjernet]',
  se_pnr: '[personnummer borttaget]',
  dk_cpr: '[CPR-nummer fjernet]',
};

export function findNationalIds(
  text: string,
  detectors: readonly NationalIdDetector[],
  options: { minConfidence?: NationalIdConfidence } = {},
): NationalIdMatch[] {
  if (!text || detectors.length === 0) return [];
  const enabled = new Set(detectors);
  const floor = CONFIDENCE_RANK[options.minConfidence ?? 'high'];
  const candidates: Candidate[] = [];

  if (enabled.has('no_fnr')) {
    for (const m of text.matchAll(PATTERN_NO)) {
      const digits = m[1]! + m[2]!;
      if (isValidNoFnr(digits)) {
        candidates.push({
          detector: 'no_fnr',
          confidence: 'high',
          start: m.index,
          end: m.index + m[0].length,
          digits,
        });
      }
    }
  }

  if (enabled.has('se_pnr')) {
    for (const m of text.matchAll(PATTERN_LONG)) {
      const digits = m[1]! + m[3]!;
      if (isValidSePnr(digits.slice(2))) {
        candidates.push({
          detector: 'se_pnr',
          confidence: 'high',
          start: m.index,
          end: m.index + m[0].length,
          digits,
        });
      }
    }
    for (const m of text.matchAll(PATTERN_SHORT)) {
      const digits = m[1]! + m[3]!;
      if (isValidSePnr(digits)) {
        candidates.push({
          detector: 'se_pnr',
          confidence: m[2] ? 'high' : 'medium',
          start: m.index,
          end: m.index + m[0].length,
          digits,
        });
      }
    }
  }

  if (enabled.has('dk_cpr')) {
    for (const m of text.matchAll(PATTERN_SHORT)) {
      const digits = m[1]! + m[3]!;
      if (isValidDkCpr(digits)) {
        candidates.push({
          detector: 'dk_cpr',
          confidence: m[2] === '-' ? 'high' : 'medium',
          start: m.index,
          end: m.index + m[0].length,
          digits,
        });
      }
    }
  }

  return resolveOverlaps(
    candidates.filter((c) => CONFIDENCE_RANK[c.confidence] >= floor),
    detectors,
  );
}

export function redactNationalIds(
  text: string,
  matches: readonly NationalIdMatch[],
  mode: Exclude<NationalIdPolicy, 'off'>,
): string {
  if (matches.length === 0) return text;
  const ordered = [...matches].sort((a, b) => a.start - b.start);
  let out = '';
  let cursor = 0;
  for (const match of ordered) {
    if (match.start < cursor) continue;
    out += text.slice(cursor, match.start);
    out += replacementFor(text.slice(match.start, match.end), match.detector, mode);
    cursor = match.end;
  }
  return out + text.slice(cursor);
}

export function countNationalIds(
  matches: readonly NationalIdMatch[],
): { detector: NationalIdDetector; confidence: NationalIdConfidence; count: number }[] {
  const buckets = new Map<string, { detector: NationalIdDetector; confidence: NationalIdConfidence; count: number }>();
  for (const match of matches) {
    const key = `${match.detector}:${match.confidence}`;
    const existing = buckets.get(key);
    if (existing) existing.count += 1;
    else buckets.set(key, { detector: match.detector, confidence: match.confidence, count: 1 });
  }
  return [...buckets.values()];
}

function replacementFor(
  original: string,
  detector: NationalIdDetector,
  mode: Exclude<NationalIdPolicy, 'off'>,
): string {
  if (mode === 'remove') return REMOVAL_MARKER[detector];
  const digits = original.replace(/\D/g, '');
  if (detector === 'no_fnr') return `${digits.slice(0, 6)}*****`;
  return `${digits.slice(0, digits.length - 4)}-****`;
}

function resolveOverlaps(
  candidates: Candidate[],
  detectors: readonly NationalIdDetector[],
): NationalIdMatch[] {
  const priority = new Map(detectors.map((d, i) => [d, i]));
  const ranked = [...candidates].sort((a, b) => {
    if (a.start !== b.start) return a.start - b.start;
    const byConfidence = CONFIDENCE_RANK[b.confidence] - CONFIDENCE_RANK[a.confidence];
    if (byConfidence !== 0) return byConfidence;
    const byDetector = (priority.get(a.detector) ?? 0) - (priority.get(b.detector) ?? 0);
    if (byDetector !== 0) return byDetector;
    return b.end - a.end;
  });

  const accepted: NationalIdMatch[] = [];
  let lastEnd = -1;
  for (const candidate of ranked) {
    if (candidate.start < lastEnd) continue;
    accepted.push({
      detector: candidate.detector,
      confidence: candidate.confidence,
      start: candidate.start,
      end: candidate.end,
    });
    lastEnd = candidate.end;
  }
  return accepted;
}

function isValidNoFnr(digits: string): boolean {
  const d = toDigits(digits);
  let day = d[0]! * 10 + d[1]!;
  let month = d[2]! * 10 + d[3]!;
  if (day > 40) day -= 40;
  if (month > 80) month -= 80;
  else if (month > 40) month -= 40;
  if (!isValidDate(day, month)) return false;
  return mod11(d, NO_K1_WEIGHTS) === d[9] && mod11(d, NO_K2_WEIGHTS) === d[10];
}

function isValidSePnr(digits: string): boolean {
  const day = Number(digits.slice(4, 6));
  const month = Number(digits.slice(2, 4));
  if (!isValidDate(day > 60 ? day - 60 : day, month)) return false;
  return luhn(digits);
}

function isValidDkCpr(digits: string): boolean {
  return isValidDate(Number(digits.slice(0, 2)), Number(digits.slice(2, 4)));
}

function isValidDate(day: number, month: number): boolean {
  if (month < 1 || month > 12) return false;
  return day >= 1 && day <= DAYS_IN_MONTH[month - 1]!;
}

function mod11(digits: number[], weights: number[]): number | null {
  let sum = 0;
  for (let i = 0; i < weights.length; i++) sum += weights[i]! * digits[i]!;
  const rest = sum % 11;
  if (rest === 0) return 0;
  return rest === 1 ? null : 11 - rest;
}

function luhn(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let value = digits.charCodeAt(i) - 48;
    if (i % 2 === 0) {
      value *= 2;
      if (value > 9) value -= 9;
    }
    sum += value;
  }
  return sum % 10 === 0;
}

function toDigits(digits: string): number[] {
  return Array.from(digits, (c) => c.charCodeAt(0) - 48);
}
