import { describe, it, expect } from 'vitest';
import { LinkedInAdapter, isRevokedTokenError, readTokenResponse } from './linkedin.adapter.ts';

describe('readTokenResponse', () => {
  it('reads an access token with no refresh token, which is what a self-serve app gets', () => {
    const set = readTokenResponse({ access_token: 'at', expires_in: 5184000, scope: 'w_member_social openid' });
    expect(set.accessToken).toBe('at');
    expect(set.expiresInSeconds).toBe(5184000);
    expect(set.refreshToken).toBeUndefined();
    expect(set.scopes).toEqual(['w_member_social', 'openid']);
  });

  it('reads the refresh token an approved partner app receives', () => {
    const set = readTokenResponse({
      access_token: 'at',
      expires_in: 5184000,
      refresh_token: 'rt',
      refresh_token_expires_in: 31536000,
    });
    expect(set.refreshToken).toBe('rt');
    expect(set.refreshTokenExpiresInSeconds).toBe(31536000);
  });

  it('rejects a response with no access token rather than storing an empty grant', () => {
    expect(() => readTokenResponse({ expires_in: 60 })).toThrow(/no access token/);
    expect(() => readTokenResponse({ access_token: '' })).toThrow(/no access token/);
    expect(() => readTokenResponse('nope')).toThrow(/not an object/);
  });

  it('ignores a non-numeric expiry instead of minting an Invalid Date', () => {
    const set = readTokenResponse({ access_token: 'at', expires_in: 'soon' });
    expect(set.expiresInSeconds).toBeUndefined();
  });
});

describe('isRevokedTokenError', () => {
  it('treats invalid_grant as revocation, so the member is asked to reconnect', () => {
    expect(isRevokedTokenError(400, '{"error":"invalid_grant"}')).toBe(true);
    expect(isRevokedTokenError(401, 'token revoked')).toBe(true);
  });

  it('leaves a server-side failure alone, so a LinkedIn outage does not look like revocation', () => {
    expect(isRevokedTokenError(500, 'invalid_grant')).toBe(false);
    expect(isRevokedTokenError(429, 'slow down')).toBe(false);
    expect(isRevokedTokenError(400, 'something else entirely')).toBe(false);
  });
});

describe('LinkedInAdapter.authorizeUrl', () => {
  it('requests w_member_social, without which nothing can be posted', () => {
    const url = new URL(
      new LinkedInAdapter().authorizeUrl({
        state: 'st',
        redirectUri: 'https://munin.example/v1/social/oauth/callback',
        clientId: 'cid',
      }),
    );
    expect(url.origin + url.pathname).toBe('https://www.linkedin.com/oauth/v2/authorization');
    expect(url.searchParams.get('scope')?.split(' ')).toContain('w_member_social');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('state')).toBe('st');
    expect(url.searchParams.get('client_id')).toBe('cid');
  });
});
