import { createHash, createHmac, randomBytes, timingSafeEqual as nodeTimingSafeEqual } from 'node:crypto';
import { sql, type SQL } from 'drizzle-orm';

/**
 * Hash a secret (API key, OAuth client secret) for at-rest storage.
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

// ─── At-rest secret encryption (pgcrypto) ───────────────────────────────────
// For secrets we need to recover (SMTP / IMAP passwords on conv_channels,
// future API-provider creds) we lean on Postgres's pgcrypto extension —
// `pgp_sym_encrypt` / `pgp_sym_decrypt` — instead of rolling AES in TypeScript.
// pgcrypto is well-audited, ships with stock Postgres, and keeps the crypto
// adjacent to the data it protects. The extension is enabled by `runMigrations`
// alongside vector / pg_trgm / citext.
//
// Key handling mirrors the existing RLS GUC pattern: the request transaction
// sets `app.crypt_key` once via SET LOCAL, and the SQL fragments below read it
// via current_setting. The key never appears in query parameters or logs.

/**
 * Read the at-rest encryption key from `MUNIN_ENCRYPTION_KEY` env. The key is
 * never decoded into a Buffer — it's passed to Postgres as a string and
 * pgcrypto handles the rest. Tolerates base64 / base64url / hex / raw text;
 * the only requirement is that it's stable across deployments (rotation is a
 * v0.5 concern).
 */
export function readEncryptionKey(): string {
  const raw = process.env.MUNIN_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error('MUNIN_ENCRYPTION_KEY is required for at-rest secret encryption');
  }
  return raw;
}

/**
 * SQL helper to set `app.crypt_key` for the current transaction. Call once at
 * the top of a tenant transaction (alongside the RLS GUCs) so subsequent
 * encrypt/decrypt fragments can reach for it via current_setting.
 *
 * Use as: `await tx.execute(setEncryptionKeySql())`.
 */
export function setEncryptionKeySql(): SQL {
  return sql`SELECT set_config('app.crypt_key', ${readEncryptionKey()}, true)`;
}

/**
 * SQL fragment that encrypts a value with the per-tx key. Wraps
 * `pgp_sym_encrypt(plain, current_setting('app.crypt_key'))` and base64-
 * encodes the bytea so the result round-trips through text columns / jsonb.
 *
 * Use as: `sql\`UPDATE x SET secret_ct = ${encryptSecretSql(value)} WHERE …\``
 */
export function encryptSecretSql(plaintext: string | SQL): SQL {
  return sql`encode(pgp_sym_encrypt(${plaintext}, current_setting('app.crypt_key')), 'base64')`;
}

/**
 * SQL fragment that decrypts a base64-encoded ciphertext column produced by
 * `encryptSecretSql`. Returns `text`; throws (Postgres-side) on a wrong key
 * or corrupted ciphertext.
 *
 * Use as: `sql\`SELECT ${decryptSecretSql(schema.foo.secretCt)} AS pw FROM …\``
 */
export function decryptSecretSql(ciphertext: string | SQL): SQL {
  return sql`pgp_sym_decrypt(decode(${ciphertext}, 'base64'), current_setting('app.crypt_key'))::text`;
}
