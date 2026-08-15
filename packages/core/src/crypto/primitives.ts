import { createHash, createHmac, randomBytes, timingSafeEqual as nodeTimingSafeEqual } from 'node:crypto';
import { sql, type SQL } from 'drizzle-orm';

export function hashSecret(secret: string, pepper?: string): string {
  const p = pepper ?? process.env.MUNIN_KEY_PEPPER ?? '';
  return createHash('sha256').update(p).update(secret).digest('hex');
}

export function randomToken(byteLength = 32): string {
  return randomBytes(byteLength).toString('base64url');
}

export function signHmac(payload: string | Buffer, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('hex');
}

export function verifyHmac(payload: string | Buffer, secret: string, signature: string): boolean {
  const expected = signHmac(payload, secret);
  return timingSafeEqual(expected, signature);
}

export function identityHashPayload(parts: {
  externalId: string;
  visitorId: string;
  email?: string | null;
}): string {
  return ['mn.identity.v1', parts.externalId, parts.visitorId, parts.email ?? '']
    .map((field) => `${Buffer.byteLength(field, 'utf8')}:${field}`)
    .join('');
}

export function legacyIdentityHashPayload(externalId: string, visitorId: string): string {
  return `${externalId}:${visitorId}`;
}

export function timingSafeEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return nodeTimingSafeEqual(aBuf, bBuf);
}

export function readEncryptionKey(): string {
  const raw = process.env.MUNIN_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error('MUNIN_ENCRYPTION_KEY is required for at-rest secret encryption');
  }
  return raw;
}

export function setEncryptionKeySql(): SQL {
  return sql`SELECT set_config('app.crypt_key', ${readEncryptionKey()}, true)`;
}

export function encryptSecretSql(plaintext: string | SQL): SQL {
  return sql`encode(pgp_sym_encrypt(${plaintext}, current_setting('app.crypt_key')), 'base64')`;
}

export function decryptSecretSql(ciphertext: string | SQL): SQL {
  return sql`pgp_sym_decrypt(decode(${ciphertext}, 'base64'), current_setting('app.crypt_key'))::text`;
}
