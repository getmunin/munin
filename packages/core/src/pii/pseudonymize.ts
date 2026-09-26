import { detectPii, type PiiDetectionKind } from './detectors.ts';
import { emailKey, phoneKey, type PiiIdentity, type PiiLexicon } from './lexicon.ts';
import { NAME_WORD_PATTERN, normalizeName } from './names.ts';
import {
  findPseudonymReferences,
  formatContactEmail,
  formatContactName,
  formatContactPhone,
} from './tokens.ts';

export type PiiMaskKind = 'name' | PiiDetectionKind;

export const PII_MASKS: Readonly<Record<PiiMaskKind, string>> = {
  name: '[NAME]',
  email: '[EMAIL]',
  phone: '[PHONE]',
  national_id: '[NATIONAL_ID]',
  bank_account: '[BANK_ACCOUNT]',
  card_number: '[CARD_NUMBER]',
};

export interface PiiStats {
  masked: Record<PiiMaskKind, number>;
  tokenized: number;
}

export function emptyPiiStats(): PiiStats {
  return {
    masked: { name: 0, email: 0, phone: 0, national_id: 0, bank_account: 0, card_number: 0 },
    tokenized: 0,
  };
}

interface Replacement {
  start: number;
  end: number;
  text: string | null;
  kind: PiiMaskKind | 'reference';
  tokenized: boolean;
}

const NAME_GAP = /^[\s\-‐.]{1,3}$/u;
const UPPERCASE_START = /^\p{Lu}/u;
const OPAQUE_ID = /^(?:[a-z]{2,6}_[0-9a-z]{16,32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

const PERSON_NAME_KEYS: ReadonlySet<string> = new Set([
  'authorName',
  'contactName',
  'customerName',
  'displayName',
  'endUserName',
  'firstName',
  'fromName',
  'fullName',
  'guestName',
  'lastName',
  'recipientName',
  'senderName',
  'toName',
]);

const PHONE_KEYS: ReadonlySet<string> = new Set([
  'callerNumber',
  'customerNumber',
  'fromNumber',
  'mobile',
  'msisdn',
  'phone',
  'phoneNumber',
  'toNumber',
]);

export function pseudonymizeText(text: string, lexicon: PiiLexicon, stats?: PiiStats): string {
  if (!text || OPAQUE_ID.test(text)) return text;
  const replacements: Replacement[] = [];

  for (const ref of findPseudonymReferences(text)) {
    replacements.push({ start: ref.start, end: ref.end, text: null, kind: 'reference', tokenized: false });
  }

  const isKnownPhone = (raw: string) => {
    const key = phoneKey(raw);
    return key !== null && lexicon.byPhone.has(key);
  };
  for (const detection of detectPii(text, { isKnownPhone })) {
    const identity =
      detection.kind === 'email'
        ? lexicon.byEmail.get(emailKey(detection.value) ?? '')
        : detection.kind === 'phone'
          ? lexicon.byPhone.get(phoneKey(detection.value) ?? '')
          : undefined;
    replacements.push({
      start: detection.start,
      end: detection.end,
      text: identity
        ? detection.kind === 'email'
          ? formatContactEmail(identity.token)
          : formatContactPhone(identity.token)
        : PII_MASKS[detection.kind],
      kind: detection.kind,
      tokenized: !!identity,
    });
  }

  replacements.push(...findNames(text, lexicon));
  return apply(text, replacements, stats);
}

export function pseudonymizeValue(value: unknown, lexicon: PiiLexicon, stats?: PiiStats): unknown {
  return walk(value, undefined, undefined, lexicon, stats);
}

export interface ResolvedPseudonyms {
  value: unknown;
  resolved: number;
  unresolved: number;
}

export function resolvePseudonyms(value: unknown, lexicon: PiiLexicon): ResolvedPseudonyms {
  const counts = { resolved: 0, unresolved: 0 };
  const resolveText = (text: string): string => {
    const refs = findPseudonymReferences(text);
    if (refs.length === 0) return text;
    let out = '';
    let cursor = 0;
    for (const ref of refs) {
      const identity = lexicon.byToken.get(ref.token);
      const real =
        ref.kind === 'email'
          ? identity?.email
          : ref.kind === 'phone'
            ? identity?.phone
            : (identity?.name ?? identity?.email);
      out += text.slice(cursor, ref.start);
      if (real) {
        out += real;
        counts.resolved += 1;
      } else {
        out += text.slice(ref.start, ref.end);
        counts.unresolved += 1;
      }
      cursor = ref.end;
    }
    return out + text.slice(cursor);
  };
  const visit = (node: unknown): unknown => {
    if (typeof node === 'string') return resolveText(node);
    if (Array.isArray(node)) return node.map(visit);
    if (node && typeof node === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(node)) out[k] = visit(v);
      return out;
    }
    return node;
  };
  return { value: visit(value), ...counts };
}

function walk(
  node: unknown,
  key: string | undefined,
  parent: Record<string, unknown> | undefined,
  lexicon: PiiLexicon,
  stats: PiiStats | undefined,
): unknown {
  if (typeof node === 'string') {
    if (key && isPersonNameField(key, parent)) return maskPersonName(node, lexicon, stats);
    if (key && PHONE_KEYS.has(key)) return maskPhone(node, lexicon, stats);
    return pseudonymizeText(node, lexicon, stats);
  }
  if (Array.isArray(node)) return node.map((item) => walk(item, key, parent, lexicon, stats));
  if (node && typeof node === 'object') {
    const record = node as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(record)) {
      out[pseudonymizeText(k, lexicon, stats)] = walk(v, k, record, lexicon, stats);
    }
    return out;
  }
  return node;
}

function isPersonNameField(key: string, parent: Record<string, unknown> | undefined): boolean {
  if (PERSON_NAME_KEYS.has(key)) return true;
  return key === 'name' && !!parent && ('email' in parent || 'phone' in parent);
}

function maskPersonName(value: string, lexicon: PiiLexicon, stats: PiiStats | undefined): string {
  if (!value.trim() || findPseudonymReferences(value).length > 0) return value;
  const identity = lexicon.names.get(normalizeName(value));
  if (identity) {
    if (stats) stats.tokenized += 1;
    return formatContactName(identity.token);
  }
  if (!/[\p{L}\p{N}]/u.test(value)) return value;
  if (/@/.test(value)) return pseudonymizeText(value, lexicon, stats);
  if (stats) stats.masked.name += 1;
  return PII_MASKS.name;
}

function maskPhone(value: string, lexicon: PiiLexicon, stats: PiiStats | undefined): string {
  const key = phoneKey(value);
  const identity = key ? lexicon.byPhone.get(key) : undefined;
  if (identity) {
    if (stats) stats.tokenized += 1;
    return formatContactPhone(identity.token);
  }
  if (value.replace(/\D/g, '').length >= 6) {
    if (stats) stats.masked.phone += 1;
    return PII_MASKS.phone;
  }
  return pseudonymizeText(value, lexicon, stats);
}

function findNames(text: string, lexicon: PiiLexicon): Replacement[] {
  const words = [...text.matchAll(NAME_WORD_PATTERN)];
  const out: Replacement[] = [];
  let i = 0;
  while (i < words.length) {
    const match = matchNameAt(text, words, i, lexicon);
    if (!match) {
      i += 1;
      continue;
    }
    const first = words[i]!;
    const last = words[i + match.length - 1]!;
    out.push({
      start: first.index,
      end: last.index + last[0].length,
      text: match.identity ? formatContactName(match.identity.token) : PII_MASKS.name,
      kind: 'name',
      tokenized: !!match.identity,
    });
    i += match.length;
  }
  return out;
}

function matchNameAt(
  text: string,
  words: RegExpExecArray[],
  i: number,
  lexicon: PiiLexicon,
): { length: number; identity: PiiIdentity | null } | null {
  const maxLength = Math.min(lexicon.maxNameWords, words.length - i);
  for (let length = maxLength; length >= 1; length -= 1) {
    const slice = words.slice(i, i + length);
    const coversWholeText = i === 0 && length === words.length;
    if (!coversWholeText && !slice.every((w) => UPPERCASE_START.test(w[0]))) continue;
    if (!gapsAreNameLike(text, slice)) continue;
    const key = slice.map((w) => w[0].normalize('NFC').toLowerCase()).join(' ');
    const identity = lexicon.names.get(key);
    if (identity !== undefined) return { length, identity };
    if (lexicon.detectedNames.has(key)) return { length, identity: null };
  }
  return null;
}

function gapsAreNameLike(text: string, slice: RegExpExecArray[]): boolean {
  for (let j = 1; j < slice.length; j += 1) {
    const prev = slice[j - 1]!;
    const gap = text.slice(prev.index + prev[0].length, slice[j]!.index);
    if (!NAME_GAP.test(gap)) return false;
  }
  return true;
}

function apply(text: string, replacements: Replacement[], stats: PiiStats | undefined): string {
  if (replacements.length === 0) return text;
  const byPrecedence = [...replacements].sort((a, b) => {
    const byClass = precedence(a) - precedence(b);
    if (byClass !== 0) return byClass;
    if (a.start !== b.start) return a.start - b.start;
    return b.end - a.end;
  });
  const accepted: Replacement[] = [];
  for (const r of byPrecedence) {
    if (accepted.some((a) => r.start < a.end && a.start < r.end)) continue;
    accepted.push(r);
  }
  const ordered = accepted.sort((a, b) => a.start - b.start);
  let out = '';
  let cursor = 0;
  for (const r of ordered) {
    out += text.slice(cursor, r.start);
    if (r.text === null) {
      out += text.slice(r.start, r.end);
    } else {
      out += r.text;
      if (stats) {
        if (r.tokenized) stats.tokenized += 1;
        else if (r.kind !== 'reference') stats.masked[r.kind] += 1;
      }
    }
    cursor = r.end;
  }
  return out + text.slice(cursor);
}

function precedence(r: Replacement): number {
  if (r.kind === 'reference') return 0;
  return r.kind === 'name' ? 2 : 1;
}
