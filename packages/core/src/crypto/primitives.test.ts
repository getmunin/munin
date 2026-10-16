import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createDb, type Db, type Tx } from '@getmunin/db';
import { sql } from 'drizzle-orm';
import {
  hashSecret,
  identityHashPayload,
  widgetIdentityHashPayload,
  randomToken,
  signHmac,
  verifyHmac,
  timingSafeEqual,
  encryptSecretSql,
  decryptSecretSql,
} from './primitives.ts';

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

describe('identityHashPayload', () => {
  it('cannot be shifted between fields by a value containing the separator', () => {
    expect(
      identityHashPayload({ externalId: 'email:a@b.no', visitorId: 'v1' }),
    ).not.toBe(identityHashPayload({ externalId: 'email', visitorId: 'a@b.no:v1' }));
  });
  it('separates a signed email from an absent one', () => {
    expect(identityHashPayload({ externalId: 'a', visitorId: 'v', email: 'x@y.no' })).not.toBe(
      identityHashPayload({ externalId: 'a', visitorId: 'v' }),
    );
  });
  it('treats a null email as absent', () => {
    expect(identityHashPayload({ externalId: 'a', visitorId: 'v', email: null })).toBe(
      identityHashPayload({ externalId: 'a', visitorId: 'v' }),
    );
  });
  it('counts bytes, not code units, so multibyte values stay unambiguous', () => {
    expect(identityHashPayload({ externalId: 'æ', visitorId: 'v' })).toContain('2:æ');
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

const TEST_URL = process.env.TEST_DATABASE_URL;
const skipPgcrypto = TEST_URL ? null : 'Set TEST_DATABASE_URL to run pgcrypto tests';

(skipPgcrypto ? describe.skip : describe)('pgcrypto secret encryption', () => {
  const KEY = 'test-encryption-key-do-not-use-in-prod';
  let db: Db;
  let otherKeyDb: Db;

  beforeAll(async () => {
    db = createDb(TEST_URL!, { serviceRole: true, encryptionKey: KEY });
    otherKeyDb = createDb(TEST_URL!, {
      serviceRole: true,
      encryptionKey: 'a-completely-different-key',
    });
    await db.execute(sql`CREATE EXTENSION IF NOT EXISTS pgcrypto`);
  });

  afterAll(() => {
    void db?.$client.end();
    void otherKeyDb?.$client.end();
  });

  function inTx<T>(fn: (tx: Tx) => Promise<T>, pool: Db = db): Promise<T> {
    return pool.transaction(fn);
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
    await expect(
      inTx(async (tx) => {
        await tx.execute(sql`SELECT ${decryptSecretSql(ct)} AS pt`);
      }, otherKeyDb),
    ).rejects.toBeTruthy();
  });

  it('round-trips through a fresh pool without any statement carrying the key', async () => {
    const fresh = createDb(TEST_URL!, { encryptionKey: KEY });
    try {
      const ct = await inTx(async (tx) => {
        const r = await tx.execute<{ ct: string }>(sql`SELECT ${encryptSecretSql('fresh')} AS ct`);
        return r[0]!.ct;
      }, fresh);
      const pt = await fresh.execute<{ pt: string }>(sql`SELECT ${decryptSecretSql(ct)} AS pt`);
      expect(pt[0]!.pt).toBe('fresh');
    } finally {
      await fresh.$client.end();
    }
  });

  it('keeps the key out of a failing query, its parameters and pg_stat_activity', async () => {
    const failure = await db
      .execute(sql`SELECT ${decryptSecretSql('not-base64-ciphertext!')} AS pt`)
      .then(
        () => null,
        (err: unknown) => err,
      );
    expect(failure).toBeInstanceOf(Error);
    const err = failure as Error & { params?: unknown; cause?: unknown };
    const surface = JSON.stringify({
      message: err.message,
      stack: err.stack,
      params: err.params,
      cause: Object.getOwnPropertyNames(err.cause ?? {}).map((k) =>
        String((err.cause as Record<string, unknown>)[k]),
      ),
    });
    expect(surface).not.toContain(KEY);
    const activity = await db.execute<{ n: string }>(
      sql`SELECT count(*)::text AS n FROM pg_stat_activity WHERE query LIKE ${'%' + KEY + '%'} AND pid <> pg_backend_pid()`,
    );
    expect(activity[0]!.n).toBe('0');
  });
});

describe('widgetIdentityHashPayload', () => {
  it('cannot be shifted between the external id and the email', () => {
    expect(widgetIdentityHashPayload({ externalId: 'a:b', email: 'c@example.test' })).not.toBe(
      widgetIdentityHashPayload({ externalId: 'a', email: 'b:c@example.test' }),
    );
  });
  it('never equals the tracker payload or the bare external id', () => {
    const widget = widgetIdentityHashPayload({ externalId: 'a', email: 'x@example.test' });
    expect(widget).not.toBe(
      identityHashPayload({ externalId: 'a', visitorId: '', email: 'x@example.test' }),
    );
    expect(widget).not.toBe('a');
  });
});

