import { describe, it, expect } from 'vitest';
import { expiryReason, grantDeadline } from './social-expiry.worker.ts';

const DAY = 24 * 60 * 60 * 1000;

describe('grantDeadline', () => {
  it('watches the refresh token when there is one, because the access token renews itself', () => {
    const at = new Date('2026-10-01T00:00:00.000Z');
    const rt = new Date('2027-06-01T00:00:00.000Z');
    expect(
      grantDeadline({ accessTokenExpiresAt: at, refreshTokenExpiresAt: rt, encryptedRefreshToken: 'rt' }),
    ).toEqual({ at: rt, renewable: true });
  });

  it('watches the access token when there is no refresh token — the LinkedIn self-serve case', () => {
    const at = new Date('2026-10-01T00:00:00.000Z');
    expect(
      grantDeadline({ accessTokenExpiresAt: at, refreshTokenExpiresAt: null, encryptedRefreshToken: null }),
    ).toEqual({ at, renewable: false });
  });
});

describe('expiryReason', () => {
  const now = Date.parse('2026-09-17T00:00:00.000Z');

  it('counts the days left so the email says when, not just that', () => {
    expect(expiryReason({ at: new Date(now + 3 * DAY), renewable: false }, now)).toBe(
      'the access grant expires in 3 days',
    );
    expect(expiryReason({ at: new Date(now + DAY), renewable: false }, now)).toBe(
      'the access grant expires in 1 day',
    );
  });

  it('says a lapsed grant needs a person, since nothing automatic will fix it', () => {
    expect(expiryReason({ at: new Date(now - DAY), renewable: false }, now)).toMatch(
      /has expired and the person must authorize again/,
    );
  });

  it('names the renewal grant when that is what ran out', () => {
    expect(expiryReason({ at: new Date(now + 2 * DAY), renewable: true }, now)).toBe(
      'the renewal grant expires in 2 days',
    );
  });

  it('does not invent a date when the vendor gave no expiry', () => {
    expect(expiryReason({ at: null, renewable: false }, now)).toBe(
      'the access grant has no recorded expiry',
    );
  });
});
