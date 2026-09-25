import { isPersonNameCandidate, isPersonNameWord, nameWords } from './names.ts';
import { PSEUDONYM_EMAIL_DOMAIN, pseudonymToken } from './tokens.ts';

export type PiiIdentityRefKind = 'crm_contact' | 'conv_contact' | 'end_user';

export interface PiiIdentityRecord {
  kind: PiiIdentityRefKind;
  id: string;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
}

export interface PiiIdentity {
  token: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  refs: ReadonlyArray<{ kind: PiiIdentityRefKind; id: string }>;
}

export interface PiiLexicon {
  identities: readonly PiiIdentity[];
  byToken: ReadonlyMap<string, PiiIdentity>;
  byEmail: ReadonlyMap<string, PiiIdentity>;
  byPhone: ReadonlyMap<string, PiiIdentity>;
  names: ReadonlyMap<string, PiiIdentity | null>;
  detectedNames: ReadonlySet<string>;
  maxNameWords: number;
}

export interface BuildPiiLexiconInput {
  orgId: string;
  secret: string;
  records: readonly PiiIdentityRecord[];
  detectedNames?: readonly string[];
}

const MAX_NAME_WORDS = 5;
const REF_PREFERENCE: readonly PiiIdentityRefKind[] = ['crm_contact', 'conv_contact', 'end_user'];

export function emailKey(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const email = raw.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  if (email.endsWith(`@${PSEUDONYM_EMAIL_DOMAIN}`)) return null;
  return email;
}

export function phoneKey(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let digits = raw.replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.length < 8 || digits.length > 15) return null;
  return digits.slice(-8);
}

export function buildPiiLexicon(input: BuildPiiLexiconInput): PiiLexicon {
  const groups = groupRecords(input.records);
  const identities: PiiIdentity[] = [];
  const byToken = new Map<string, PiiIdentity>();
  const byEmail = new Map<string, PiiIdentity>();
  const byPhone = new Map<string, PiiIdentity>();
  const names = new Map<string, PiiIdentity | null>();
  let maxNameWords = 1;

  for (const records of groups) {
    const ordered = [...records].sort(
      (a, b) => REF_PREFERENCE.indexOf(a.kind) - REF_PREFERENCE.indexOf(b.kind),
    );
    const emails = uniqueSorted(ordered.map((r) => emailKey(r.email)));
    const phones = uniqueSorted(ordered.map((r) => phoneKey(r.phone)));
    const identityKey =
      emails.length > 0
        ? `email:${emails[0]}`
        : phones.length > 0
          ? `phone:${phones[0]}`
          : [...ordered.map((r) => `${r.kind}:${r.id}`)].sort()[0]!;
    const token = pseudonymToken(input.orgId, identityKey, input.secret);
    const name = ordered.map((r) => r.name?.trim()).find((n) => !!n && isPersonNameCandidate(n)) ?? null;
    const identity: PiiIdentity = {
      token,
      name,
      email: ordered.map((r) => r.email?.trim()).find((e) => !!e && emailKey(e)) ?? null,
      phone: ordered.map((r) => r.phone?.trim()).find((p) => !!p && phoneKey(p)) ?? null,
      refs: ordered.map((r) => ({ kind: r.kind, id: r.id })),
    };
    identities.push(identity);
    byToken.set(token, identity);
    for (const email of emails) byEmail.set(email, identity);
    for (const phone of phones) byPhone.set(phone, identity);

    const seen = new Set<string>();
    for (const record of ordered) {
      if (!record.name || !isPersonNameCandidate(record.name)) continue;
      for (const phrase of namePhrases(record.name)) {
        if (seen.has(phrase)) continue;
        seen.add(phrase);
        const existing = names.get(phrase);
        names.set(phrase, existing === undefined || existing === identity ? identity : null);
        maxNameWords = Math.max(maxNameWords, phrase.split(' ').length);
      }
    }
  }

  const detectedNames = new Set<string>();
  for (const surface of input.detectedNames ?? []) {
    const trimmed = surface.trim();
    if (!/^\p{Lu}/u.test(trimmed) || !isPersonNameCandidate(trimmed)) continue;
    const words = nameWords(trimmed);
    if (words.length > MAX_NAME_WORDS || !words.every(isPersonNameWord)) continue;
    detectedNames.add(words.join(' '));
    maxNameWords = Math.max(maxNameWords, words.length);
  }

  return { identities, byToken, byEmail, byPhone, names, detectedNames, maxNameWords };
}

function namePhrases(name: string): string[] {
  const words = nameWords(name).slice(0, MAX_NAME_WORDS);
  const out: string[] = [];
  for (let len = words.length; len >= 2; len -= 1) {
    for (let start = 0; start + len <= words.length; start += 1) {
      out.push(words.slice(start, start + len).join(' '));
    }
  }
  const first = words[0];
  const last = words[words.length - 1];
  if (first && isPersonNameWord(first)) out.push(first);
  if (last && last !== first && isPersonNameWord(last)) out.push(last);
  return out;
}

function groupRecords(records: readonly PiiIdentityRecord[]): PiiIdentityRecord[][] {
  const parent = records.map((_, i) => i);
  const find = (i: number): number => {
    let root = i;
    while (parent[root] !== root) root = parent[root]!;
    while (parent[i] !== root) {
      const next = parent[i]!;
      parent[i] = root;
      i = next;
    }
    return root;
  };
  const union = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[rb] = ra;
  };

  const owners = new Map<string, number>();
  records.forEach((record, i) => {
    for (const key of [emailKey(record.email), phoneKey(record.phone)]) {
      if (!key) continue;
      const owner = owners.get(key);
      if (owner === undefined) owners.set(key, i);
      else union(owner, i);
    }
  });

  const buckets = new Map<number, PiiIdentityRecord[]>();
  records.forEach((record, i) => {
    const root = find(i);
    const bucket = buckets.get(root);
    if (bucket) bucket.push(record);
    else buckets.set(root, [record]);
  });
  return [...buckets.values()];
}

function uniqueSorted(values: ReadonlyArray<string | null>): string[] {
  return [...new Set(values.filter((v): v is string => !!v))].sort();
}
