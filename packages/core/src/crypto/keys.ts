import { randomToken } from './primitives.ts';

/**
 * Munin API-key format: `mn_<kind>_<random>`
 *
 *   kind = 'admin' | 'dlg' (delegated end-user, short-lived)
 *        | 'widget' (chat-widget channel binding; api_keys.channel_id is set)
 *
 * The `'part'` kind exists in the type union for downstream packages
 * that mint partner-style credentials; OSS does not produce or accept
 * them.
 *
 * The first 8 chars of the key (`mn_admin`, `mn_dlg__`) are the "prefix"
 * we index by — narrows the row lookup in resolveApiKey before we compute
 * the full hash. Random portion is 32 bytes base64url (~43 chars, ~256
 * bits of entropy).
 */

export type KeyKind = 'admin' | 'part' | 'dlg' | 'widget';

const PREFIX_LENGTH = 8;

export function buildApiKey(kind: KeyKind): string {
  const random = randomToken(32);
  return `mn_${kind}_${random}`;
}

export function keyPrefix(rawKey: string): string {
  return rawKey.slice(0, PREFIX_LENGTH);
}

export function isWellFormedKey(rawKey: string): boolean {
  return /^mn_(admin|part|dlg|widget)_[A-Za-z0-9_-]+$/.test(rawKey);
}
