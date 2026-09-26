import { createHmac } from 'node:crypto';

const TOKEN_ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567';

export const PSEUDONYM_TOKEN_LENGTH = 8;
export const PSEUDONYM_EMAIL_DOMAIN = 'pseudonym.invalid';

export function pseudonymToken(orgId: string, identityKey: string, secret: string): string {
  const digest = createHmac('sha256', secret)
    .update(`munin.pii.pseudonym.v1:${orgId}:${identityKey}`)
    .digest();
  let out = '';
  for (let i = 0; i < PSEUDONYM_TOKEN_LENGTH; i += 1) {
    out += TOKEN_ALPHABET[digest[i]! & 31];
  }
  return out;
}

export function formatContactName(token: string): string {
  return `[Contact ${token}]`;
}

export function formatContactEmail(token: string): string {
  return `contact-${token}@${PSEUDONYM_EMAIL_DOMAIN}`;
}

export function formatContactPhone(token: string): string {
  return `[Phone ${token}]`;
}

export type PseudonymReferenceKind = 'name' | 'email' | 'phone';

export interface PseudonymReference {
  kind: PseudonymReferenceKind;
  token: string;
  start: number;
  end: number;
}

const TOKEN_CHARS = `[a-z2-7]{${PSEUDONYM_TOKEN_LENGTH}}`;
const REFERENCE_PATTERN = new RegExp(
  [
    `(?<email>contact-(?<emailToken>${TOKEN_CHARS})@pseudonym\\.invalid)(?![\\w.-])`,
    `(?<name>\\[?Contact (?<nameToken>${TOKEN_CHARS})\\]?)(?![a-z2-7])`,
    `(?<phone>\\[?Phone (?<phoneToken>${TOKEN_CHARS})\\]?)(?![a-z2-7])`,
  ].join('|'),
  'gi',
);

export function findPseudonymReferences(text: string): PseudonymReference[] {
  const out: PseudonymReference[] = [];
  for (const match of text.matchAll(REFERENCE_PATTERN)) {
    const groups = match.groups ?? {};
    const start = match.index;
    const end = start + match[0].length;
    if (groups.email) out.push({ kind: 'email', token: groups.emailToken!.toLowerCase(), start, end });
    else if (groups.name) out.push({ kind: 'name', token: groups.nameToken!.toLowerCase(), start, end });
    else if (groups.phone) out.push({ kind: 'phone', token: groups.phoneToken!.toLowerCase(), start, end });
  }
  return out;
}
