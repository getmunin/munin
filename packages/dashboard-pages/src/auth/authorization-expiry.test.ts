import { describe, expect, it } from 'vitest';
import {
  AUTHORIZATION_CLOCK_GRACE_MS,
  authorizationExpiresAt,
  authorizationHasExpired,
} from './authorization-expiry';

const NOW = 1_770_000_000_000;
const seconds = (ms: number) => String(Math.floor(ms / 1000));

describe('authorization expiry', () => {
  it('treats a request with no exp as one that cannot be judged', () => {
    expect(authorizationExpiresAt(null)).toBeNull();
    expect(authorizationExpiresAt(undefined)).toBeNull();
    expect(authorizationExpiresAt('')).toBeNull();
    expect(authorizationHasExpired(null, NOW)).toBe(false);
  });

  it('ignores an exp that is not a positive number', () => {
    expect(authorizationExpiresAt('not-a-number')).toBeNull();
    expect(authorizationExpiresAt('-1')).toBeNull();
    expect(authorizationExpiresAt('0')).toBeNull();
    expect(authorizationHasExpired('not-a-number', NOW)).toBe(false);
  });

  it('reads exp as seconds and adds the clock grace', () => {
    expect(authorizationExpiresAt(seconds(NOW))).toBe(NOW + AUTHORIZATION_CLOCK_GRACE_MS);
  });

  it('holds a request that is still live', () => {
    expect(authorizationHasExpired(seconds(NOW + 60_000), NOW)).toBe(false);
  });

  it('keeps trusting a just-lapsed request, so a fast client clock cannot hide a live one', () => {
    expect(authorizationHasExpired(seconds(NOW - 30_000), NOW)).toBe(false);
  });

  it('calls it expired once it is past the grace', () => {
    expect(authorizationHasExpired(seconds(NOW - AUTHORIZATION_CLOCK_GRACE_MS - 1000), NOW)).toBe(
      true,
    );
  });
});
