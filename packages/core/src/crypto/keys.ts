import { randomToken } from './primitives.ts';

export type KeyKind = 'admin' | 'part' | 'dlg' | 'widget' | 'track';

const PREFIX_LENGTH = 8;

export function buildApiKey(kind: KeyKind): string {
  const random = randomToken(32);
  return `mn_${kind}_${random}`;
}

export function keyPrefix(rawKey: string): string {
  return rawKey.slice(0, PREFIX_LENGTH);
}

export function isWellFormedKey(rawKey: string): boolean {
  return /^mn_(admin|part|dlg|widget|track)_[A-Za-z0-9_-]+$/.test(rawKey);
}
