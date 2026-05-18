import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createDb, type Db } from '@getmunin/db';
import { sql } from 'drizzle-orm';
import {
  hashSecret,
  randomToken,
  signHmac,
  verifyHmac,
  timingSafeEqual,
  setEncryptionKeySql,
  encryptSecretSql,
  decryptSecretSql,
} from './primitives.js';

describe('hashSecret', () => {
  it('produces deterministic output for the same input', () => {
    expect(hashSecret('foo')).toBe(hashSecret('foo'));
  });
  it('differs when pepper differs', () => {
    expect(hashSecret('foo', 'a')).not.toBe(hashSecret('foo', 'b'));
  });
  it('is constant length (sha256 hex)', () => {
    expect(hashSecret('x')).toHaveLength(64);
  });
});

describe('randomToken', () => {
  it('produces a base64url string of the expected entropy', () => {
    const t = randomToken(32);
    expect(t).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(t.length).toBeGreaterThan(40);
  });
  it('does not collide across calls', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 100; i += 1) seen.add(randomToken(16));
    expect(seen.size).toBe(100);
  });
});

describe('signHmac / verifyHmac', () => {
  it('round-trips', () => {
    const sig = signHmac('hello', 'secret');
    expect(verifyHmac('hello', 'secret', sig)).toBe(true);
  });
  it('rejects bad signature', () => {
    expect(verifyHmac('hello', 'secret', 'deadbeef')).toBe(false);
  });
  it('rejects mismatched secret', () => {
    const sig = signHmac('hello', 'secret');
    expect(verifyHmac('hello', 'other-secret', sig)).toBe(false);
  });
});

describe('timingSafeEqual', () => {
  it('returns true for equal strings', () => {
    expect(timingSafeEqual('abc', 'abc')).toBe(true);
  });
  it('returns false for different lengths', () => {
    expect(timingSafeEqual('abc', 'abcd')).toBe(false);
  });
  it('returns false for different content', () => {
    expect(timingSafeEqual('abc', 'abd')).toBe(false);
  });
});

const TEST_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const skipPgcrypto = TEST_URL ? null : 'Set DATABASE_URL or TEST_DATABASE_URL to run pgcrypto tests';

(skipPgcrypto ? describe.skip : describe)('pgcrypto secret encryption', () => {
  let db: Db;

  beforeAll(async () => {
    process.env.MUNIN_ENCRYPTION_KEY ??= 'test-encryption-key-do-not-use-in-prod';
    db = createDb(TEST_URL!, { serviceRole: true });
    await db.execute(sql`CREATE EXTENSION IF NOT EXISTS pgcrypto`);
  });

  afterAll(() => {
    // Drizzle wraps a postgres-js Sql client; close via $client.
    void db?.$client.end();
  });

  function inTx<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
    return db.transaction(async (tx) => {
      await tx.execute(setEncryptionKeySql());
      return fn(tx as unknown as Db);
    });
  }

  it('encrypts and decrypts a string round-trip', async () => {
    const value = 's3cr3t-imap-password';
    const result = await inTx(async (tx) => {
      const enc = await tx.execute<{ ct: string }>(sql`SELECT ${encryptSecretSql(value)} AS ct`);
      const ct = enc[0]!.ct;
      expect(ct.length).toBeGreaterThan(20);
      const dec = await tx.execute<{ pt: string }>(sql`SELECT ${decryptSecretSql(ct)} AS pt`);
      return dec[0]!.pt;
    });
    expect(result).toBe(value);
  });

  it('produces different ciphertext for the same input each call (random IV)', async () => {
    const value = 'same-input';
    const [a, b] = await inTx(async (tx) => {
      const r1 = await tx.execute<{ ct: string }>(sql`SELECT ${encryptSecretSql(value)} AS ct`);
      const r2 = await tx.execute<{ ct: string }>(sql`SELECT ${encryptSecretSql(value)} AS ct`);
      return [r1[0]!.ct, r2[0]!.ct] as const;
    });
    expect(a).not.toBe(b);
  });

  it('throws on tampered ciphertext', async () => {
    await expect(
      inTx(async (tx) => {
        const enc = await tx.execute<{ ct: string }>(
          sql`SELECT ${encryptSecretSql('hello')} AS ct`,
        );
        // Flip a byte mid-payload.
        const original = enc[0]!.ct;
        const flipChar = original.charAt(20) === 'A' ? 'B' : 'A';
        const bad = original.slice(0, 20) + flipChar + original.slice(21);
        await tx.execute(sql`SELECT ${decryptSecretSql(bad)} AS pt`);
      }),
    ).rejects.toBeTruthy();
  });

  it('throws when decrypting with a different key', async () => {
    const value = 'orig-key-secret';
    const ct = await inTx(async (tx) => {
      const r = await tx.execute<{ ct: string }>(sql`SELECT ${encryptSecretSql(value)} AS ct`);
      return r[0]!.ct;
    });
    const before = process.env.MUNIN_ENCRYPTION_KEY;
    process.env.MUNIN_ENCRYPTION_KEY = 'a-completely-different-key';
    try {
      await expect(
        inTx(async (tx) => {
          await tx.execute(sql`SELECT ${decryptSecretSql(ct)} AS pt`);
        }),
      ).rejects.toBeTruthy();
    } finally {
      process.env.MUNIN_ENCRYPTION_KEY = before;
    }
  });
});
