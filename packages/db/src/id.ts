import { randomBytes } from 'node:crypto';

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';
const ACCEPT_MAX = 256 - (256 % ALPHABET.length);

/** Generate a short random suffix using a-z0-9, length 22 (≈113 bits of entropy). */
function suffix(): string {
  let out = '';
  while (out.length < 22) {
    const bytes = randomBytes(32);
    for (let i = 0; i < bytes.length && out.length < 22; i += 1) {
      const b = bytes[i]!;
      if (b < ACCEPT_MAX) out += ALPHABET[b % ALPHABET.length];
    }
  }
  return out;
}

/**
 * Build a prefixed ID like `org_<22-char-suffix>`.
 * Stripe-style. Far more useful in logs and APIs than raw UUIDs.
 */
export function makeId(prefix: string): string {
  return `${prefix}_${suffix()}`;
}
