import { randomBytes } from 'node:crypto';

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';
const ACCEPT_MAX = 256 - (256 % ALPHABET.length);

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

export function makeId(prefix: string): string {
  return `${prefix}_${suffix()}`;
}
