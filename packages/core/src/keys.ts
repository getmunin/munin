import { randomToken } from './crypto.js';

/**
 * Munin API-key format: `mn_<kind>_<random>`
 *
 *   kind = 'admin' | 'part' (partner) | 'dlg' (delegated end-user, short-lived)
 *
 * The first 8 chars of the key (`mn_admin`, `mn_part_`, `mn_dlg__`) are the
 * "prefix" we index by — narrows the row lookup in resolveApiKey before we
 * compute the full hash. Random portion is 32 bytes base64url (~43 chars,
 * ~256 bits of entropy).
 */

export type KeyKind = 'admin' | 'part' | 'dlg';

const PREFIX_LENGTH = 8;

export function buildApiKey(kind: KeyKind): string {
  const random = randomToken(32);
  return `mn_${kind}_${random}`;
}

export function keyPrefix(rawKey: string): string {
  return rawKey.slice(0, PREFIX_LENGTH);
}

export function isWellFormedKey(rawKey: string): boolean {
  return /^mn_(admin|part|dlg)_[A-Za-z0-9_-]+$/.test(rawKey);
}
