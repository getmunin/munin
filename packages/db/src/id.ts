import { randomBytes } from 'node:crypto';

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

/** Generate a short random suffix using a-z0-9, length 22 (≈110 bits of entropy). */
function suffix(): string {
  const bytes = randomBytes(22);
  let out = '';
  for (let i = 0; i < bytes.length; i += 1) {
    out += ALPHABET[bytes[i]! % ALPHABET.length];
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
