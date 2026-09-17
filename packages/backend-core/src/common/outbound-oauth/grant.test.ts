import { describe, it, expect } from 'vitest';
import {
  ACCESS_TOKEN_REFRESH_SKEW_MS,
  MissingRefreshTokenError,
  accessTokenIsFresh,
  nextGrant,
  readGrant,
  type StoredOAuthGrant,
} from './grant.ts';

const NOW = Date.parse('2026-01-01T12:00:00.000Z');

function grant(overrides: Partial<StoredOAuthGrant> = {}): StoredOAuthGrant {
  return {
    encryptedRefreshToken: 'ct-refresh',
    encryptedAccessToken: 'ct-access',
    accessTokenExpiresAt: new Date(NOW + 3600_000).toISOString(),
    scopes: ['read'],
    connectedAt: '2025-12-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('readGrant', () => {
  it('refuses anything without a refresh token, because nothing can be renewed without one', () => {
    expect(readGrant(null)).toBeNull();
    expect(readGrant('a string')).toBeNull();
    expect(readGrant({})).toBeNull();
    expect(readGrant({ encryptedAccessToken: 'ct' })).toBeNull();
  });

  it('keeps only the scopes that are strings', () => {
    const parsed = readGrant({ encryptedRefreshToken: 'ct', scopes: ['read', 7, null, 'write'] });
    expect(parsed?.scopes).toEqual(['read', 'write']);
  });

  it('defaults every optional field rather than carrying a half-read grant', () => {
    expect(readGrant({ encryptedRefreshToken: 'ct' })).toEqual({
      encryptedRefreshToken: 'ct',
      encryptedAccessToken: null,
      accessTokenExpiresAt: null,
      scopes: [],
      connectedAt: '',
    });
  });
});

describe('accessTokenIsFresh', () => {
  it('is false without a stored access token', () => {
    expect(accessTokenIsFresh(grant({ encryptedAccessToken: null }), undefined, NOW)).toBe(false);
  });

  it('treats an unknown expiry as not fresh, so the token is refreshed rather than trusted', () => {
    expect(accessTokenIsFresh(grant({ accessTokenExpiresAt: null }), undefined, NOW)).toBe(false);
  });

  it('treats an unparseable expiry as not fresh', () => {
    expect(accessTokenIsFresh(grant({ accessTokenExpiresAt: 'soon' }), undefined, NOW)).toBe(false);
  });

  it('refreshes a token that expires inside the skew window', () => {
    const insideSkew = new Date(NOW + ACCESS_TOKEN_REFRESH_SKEW_MS - 1).toISOString();
    expect(accessTokenIsFresh(grant({ accessTokenExpiresAt: insideSkew }), undefined, NOW)).toBe(
      false,
    );
  });

  it('keeps a token that outlives the skew window', () => {
    const outsideSkew = new Date(NOW + ACCESS_TOKEN_REFRESH_SKEW_MS + 1000).toISOString();
    expect(accessTokenIsFresh(grant({ accessTokenExpiresAt: outsideSkew }), undefined, NOW)).toBe(
      true,
    );
  });
});

describe('nextGrant', () => {
  it('keeps the previous refresh token when the vendor rotates only the access token', () => {
    const next = nextGrant({
      encryptedAccessToken: 'ct-access-2',
      encryptedRefreshToken: null,
      expiresInSeconds: 3600,
      scopes: ['read'],
      previous: grant(),
      now: NOW,
    });
    expect(next.encryptedRefreshToken).toBe('ct-refresh');
    expect(next.encryptedAccessToken).toBe('ct-access-2');
  });

  it('takes the new refresh token when the vendor rotates it', () => {
    const next = nextGrant({
      encryptedAccessToken: 'ct-access-2',
      encryptedRefreshToken: 'ct-refresh-2',
      scopes: [],
      previous: grant(),
      now: NOW,
    });
    expect(next.encryptedRefreshToken).toBe('ct-refresh-2');
  });

  it('refuses a first grant with no refresh token at all', () => {
    expect(() =>
      nextGrant({
        encryptedAccessToken: 'ct',
        encryptedRefreshToken: null,
        scopes: [],
        previous: null,
        now: NOW,
      }),
    ).toThrow(MissingRefreshTokenError);
  });

  it('dates the connection from the first grant, not the latest refresh', () => {
    const next = nextGrant({
      encryptedAccessToken: 'ct',
      encryptedRefreshToken: 'ct-r',
      scopes: [],
      previous: grant({ connectedAt: '2025-12-01T00:00:00.000Z' }),
      now: NOW,
    });
    expect(next.connectedAt).toBe('2025-12-01T00:00:00.000Z');
  });

  it('stamps connectedAt now when the previous grant never recorded one', () => {
    const next = nextGrant({
      encryptedAccessToken: 'ct',
      encryptedRefreshToken: 'ct-r',
      scopes: [],
      previous: grant({ connectedAt: '' }),
      now: NOW,
    });
    expect(next.connectedAt).toBe(new Date(NOW).toISOString());
  });

  it('leaves the expiry unknown when the vendor does not say how long the token lasts', () => {
    const next = nextGrant({
      encryptedAccessToken: 'ct',
      encryptedRefreshToken: 'ct-r',
      scopes: [],
      previous: null,
      now: NOW,
    });
    expect(next.accessTokenExpiresAt).toBeNull();
    expect(accessTokenIsFresh(next, undefined, NOW)).toBe(false);
  });

  it('copies the scope list rather than aliasing the adapter constant', () => {
    const scopes = ['read', 'write'];
    const next = nextGrant({
      encryptedAccessToken: 'ct',
      encryptedRefreshToken: 'ct-r',
      scopes,
      previous: null,
      now: NOW,
    });
    scopes.push('admin');
    expect(next.scopes).toEqual(['read', 'write']);
  });
});
