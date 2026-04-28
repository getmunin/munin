import { createHash, createHmac, randomBytes, timingSafeEqual as nodeTimingSafeEqual } from 'node:crypto';

/**
 * Hash a secret (API key, partner key, OAuth client secret) for at-rest storage.
 *
 * We use SHA-256 + a fixed pepper from MUNIN_KEY_PEPPER env var. Keys are
 * already high-entropy (24+ bytes random) so adding bcrypt-style work factor
 * isn't necessary; constant-time comparison and pepper avoid the main risks.
 */
export function hashSecret(secret: string, pepper?: string): string {
  const p = pepper ?? process.env.MUNIN_KEY_PEPPER ?? '';
  return createHash('sha256').update(p).update(secret).digest('hex');
}

/** Generate a high-entropy token: base64url, no padding, default 32 bytes. */
export function randomToken(byteLength = 32): string {
  return randomBytes(byteLength).toString('base64url');
}

/** Sign a payload with HMAC-SHA256, returning hex. */
export function signHmac(payload: string | Buffer, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('hex');
}

/** Verify an HMAC signature against a payload. Constant-time. */
export function verifyHmac(payload: string | Buffer, secret: string, signature: string): boolean {
  const expected = signHmac(payload, secret);
  return timingSafeEqual(expected, signature);
}

/** Constant-time string equality. Returns false for mismatched lengths. */
export function timingSafeEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return nodeTimingSafeEqual(aBuf, bBuf);
}
