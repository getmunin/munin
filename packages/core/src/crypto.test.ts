import { describe, it, expect } from 'vitest';
import { hashSecret, randomToken, signHmac, verifyHmac, timingSafeEqual } from './crypto.js';

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
