import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  LinkedInAdapter,
  composeCommentary,
  escapeCommentary,
  isRevokedTokenError,
  permalinkFor,
  readTokenResponse,
} from './linkedin.adapter.ts';
import { SocialGrantRevokedError } from './social-oauth.ts';

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

describe('escapeCommentary', () => {
  it('escapes the characters LinkedIn reserves, which would otherwise be eaten by its renderer', () => {
    expect(escapeCommentary('a (b) [c] {d} <e> #f *g* _h_ ~i~ @j |k')).toBe(
      'a \\(b\\) \\[c\\] \\{d\\} \\<e\\> \\#f \\*g\\* \\_h\\_ \\~i\\~ \\@j \\|k',
    );
  });

  it('escapes a backslash once, not twice over', () => {
    expect(escapeCommentary('a \\ b')).toBe('a \\\\ b');
  });

  it('leaves ordinary prose untouched', () => {
    const plain = 'We shipped a thing today. It is good, and fast!';
    expect(escapeCommentary(plain)).toBe(plain);
  });
});

describe('composeCommentary', () => {
  it('appends the tracked link when the body does not already carry it', () => {
    const out = composeCommentary('Read this', 'https://example.test/a?utm_source=linkedin');
    expect(out).toBe('Read this\n\nhttps://example.test/a?utm\\_source=linkedin');
  });

  it('does not append a link the body already quotes, so it is not published twice', () => {
    const body = 'Read this https://example.test/a';
    expect(composeCommentary(body, 'https://example.test/a')).toBe(escapeCommentary(body));
  });

  it('escapes the link it appends, because utm parameters carry reserved underscores', () => {
    expect(composeCommentary('x', 'https://example.test/a?utm_content=b')).toContain(
      'utm\\_content',
    );
  });

  it('is a plain escape when there is no link at all', () => {
    expect(composeCommentary('just text', null)).toBe('just text');
  });
});

describe('permalinkFor', () => {
  it('builds a feed URL from a share urn', () => {
    expect(permalinkFor('urn:li:share:7123')).toBe(
      'https://www.linkedin.com/feed/update/urn:li:share:7123/',
    );
  });

  it('returns null for an id that is not a urn, rather than a link that 404s', () => {
    expect(permalinkFor('7123')).toBeNull();
    expect(permalinkFor('urn:li:share:abc')).toBeNull();
  });
});

describe('LinkedInAdapter.publish', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubFetch(response: Response) {
    const fetchMock = vi.fn(() => Promise.resolve(response));
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  const ok = () =>
    new Response('{}', { status: 201, headers: { 'x-restli-id': 'urn:li:share:7123' } });

  it('posts as the member urn and returns the post id with its permalink', async () => {
    const fetchMock = stubFetch(ok());
    const result = await new LinkedInAdapter().publish({
      accessToken: 'at',
      externalAccountId: 'member-1',
      body: 'Hello',
      linkUrl: null,
    });

    expect(result).toEqual({
      externalPostId: 'urn:li:share:7123',
      permalink: 'https://www.linkedin.com/feed/update/urn:li:share:7123/',
    });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.linkedin.com/rest/posts');
    const headers = init.headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer at');
    expect(headers['x-restli-protocol-version']).toBe('2.0.0');
    expect(headers['linkedin-version']).toMatch(/^\d{6}$/);
    const sent = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(sent.author).toBe('urn:li:person:member-1');
    expect(sent.commentary).toBe('Hello');
    expect(sent.lifecycleState).toBe('PUBLISHED');
    expect(sent.visibility).toBe('PUBLIC');
  });

  it('reports a lapsed grant as revocation so the member is asked to reconnect', async () => {
    stubFetch(new Response('{"error":"invalid_grant"}', { status: 401 }));
    await expect(
      new LinkedInAdapter().publish({
        accessToken: 'at',
        externalAccountId: 'member-1',
        body: 'Hello',
        linkUrl: null,
      }),
    ).rejects.toBeInstanceOf(SocialGrantRevokedError);
  });

  it('carries the platform reason out on a refusal, rather than a bare status', async () => {
    stubFetch(new Response('{"message":"commentary too long"}', { status: 422 }));
    await expect(
      new LinkedInAdapter().publish({
        accessToken: 'at',
        externalAccountId: 'member-1',
        body: 'Hello',
        linkUrl: null,
      }),
    ).rejects.toThrow(/422.*commentary too long/);
  });

  it('refuses a 201 with no post id, which would otherwise be stored as published with nothing to show', async () => {
    stubFetch(new Response('{}', { status: 201 }));
    await expect(
      new LinkedInAdapter().publish({
        accessToken: 'at',
        externalAccountId: 'member-1',
        body: 'Hello',
        linkUrl: null,
      }),
    ).rejects.toThrow(/no post id/);
  });
});
