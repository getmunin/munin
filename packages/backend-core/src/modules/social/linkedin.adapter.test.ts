import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  LinkedInAdapter,
  apiVersion,
  composeCommentText,
  composeCommentary,
  escapeCommentary,
  isRevokedTokenError,
  permalinkFor,
  commentRouteExhausted,
  readCommentId,
  readTokenResponse,
  readUploadInstructions,
} from './linkedin.adapter.ts';
import { SocialGrantRevokedError, type SocialPublishRequest } from './social-oauth.ts';

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

describe('apiVersion', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('pins a default inside the one-year window LinkedIn supports a version for', () => {
    const pinned = apiVersion();
    const year = Number(pinned.slice(0, 4));
    const month = Number(pinned.slice(4, 6));
    const now = new Date();
    const monthsOld =
      (now.getUTCFullYear() - year) * 12 + (now.getUTCMonth() + 1 - month);

    expect(monthsOld).toBeGreaterThanOrEqual(0);
    expect(monthsOld).toBeLessThanOrEqual(11);
  });

  it('ignores a configured version that is not YYYYMM, which LinkedIn answers with a bare 426', () => {
    vi.stubEnv('MUNIN_LINKEDIN_API_VERSION', '20260901');
    expect(apiVersion()).toMatch(/^\d{6}$/);
    vi.stubEnv('MUNIN_LINKEDIN_API_VERSION', '202601');
    expect(apiVersion()).toBe('202601');
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

  const request = (over: Partial<SocialPublishRequest> = {}): SocialPublishRequest => ({
    accessToken: 'at',
    externalAccountId: 'member-1',
    body: 'Hello',
    linkUrl: null,
    linkPlacement: 'body',
    linkCommentText: null,
    media: null,
    ...over,
  });

  it('posts as the member urn and returns the post id with its permalink', async () => {
    const fetchMock = stubFetch(ok());
    const result = await new LinkedInAdapter().publish(request());

    expect(result).toEqual({
      externalPostId: 'urn:li:share:7123',
      permalink: 'https://www.linkedin.com/feed/update/urn:li:share:7123/',
      commentExternalId: null,
      commentError: null,
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
      new LinkedInAdapter().publish(request()),
    ).rejects.toBeInstanceOf(SocialGrantRevokedError);
  });

  it('carries the platform reason out on a refusal, rather than a bare status', async () => {
    stubFetch(new Response('{"message":"commentary too long"}', { status: 422 }));
    await expect(
      new LinkedInAdapter().publish(request()),
    ).rejects.toThrow(/422.*commentary too long/);
  });

  it('refuses a 201 with no post id, which would otherwise be stored as published with nothing to show', async () => {
    stubFetch(new Response('{}', { status: 201 }));
    await expect(
      new LinkedInAdapter().publish(request()),
    ).rejects.toThrow(/no post id/);
  });
});

describe('composeCommentText', () => {
  it('falls back to the bare link when no wording was written for the comment', () => {
    expect(composeCommentText('https://example.com/a', null)).toBe('https://example.com/a');
    expect(composeCommentText('https://example.com/a', '   ')).toBe('https://example.com/a');
  });

  it('appends the link to the wording, and does not repeat one the wording already carries', () => {
    expect(composeCommentText('https://example.com/a', 'Full write-up:')).toBe(
      'Full write-up:\n\nhttps://example.com/a',
    );
    expect(composeCommentText('https://example.com/a', 'Here: https://example.com/a')).toBe(
      'Here: https://example.com/a',
    );
  });
});

describe('readCommentId', () => {
  it('prefers the id in the body and falls back to the header', () => {
    expect(readCommentId({ id: '7506' }, null)).toBe('7506');
    expect(readCommentId(null, '7507')).toBe('7507');
    expect(readCommentId({}, '')).toBeNull();
  });
});

describe('readUploadInstructions', () => {
  it('rejects a response with no parts rather than finalizing an empty upload', () => {
    expect(() => readUploadInstructions({ uploadInstructions: [] })).toThrow(/no video upload/);
  });

  it('rejects a malformed part rather than PUTting bytes at undefined', () => {
    expect(() =>
      readUploadInstructions({ uploadInstructions: [{ firstByte: 0, lastByte: 10 }] }),
    ).toThrow(/malformed/);
  });
});

describe('LinkedInAdapter media and comments', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function routeFetch(handler: (url: string, init: RequestInit) => Response) {
    const calls: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((url: unknown, init: RequestInit) => {
        const href = String(url);
        calls.push({ url: href, init });
        return Promise.resolve(handler(href, init));
      }),
    );
    return calls;
  }

  it('uploads an image and hands the post its urn with the alt text', async () => {
    const calls = routeFetch((url) => {
      if (url.startsWith('https://api.linkedin.com/rest/images')) {
        return new Response(
          JSON.stringify({ value: { image: 'urn:li:image:42', uploadUrl: 'https://upload/1' } }),
          { status: 200 },
        );
      }
      return new Response('', { status: 201 });
    });

    const ref = await new LinkedInAdapter().uploadMedia({
      accessToken: 'at',
      externalAccountId: 'member-1',
      media: {
        kind: 'image',
        bytes: Buffer.from('png-bytes'),
        contentType: 'image/png',
        altText: 'A chart',
      },
    });

    expect(ref).toEqual({ kind: 'image', id: 'urn:li:image:42', altText: 'A chart' });
    expect(calls[0]!.url).toBe('https://api.linkedin.com/rest/images?action=initializeUpload');
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual({
      initializeUploadRequest: { owner: 'urn:li:person:member-1' },
    });
    expect(calls[1]!.url).toBe('https://upload/1');
    expect(calls[1]!.init.method).toBe('PUT');
  });

  it('uploads a video part by part and finalizes with the ETags in order', async () => {
    const bytes = Buffer.alloc(10, 7);
    const calls = routeFetch((url) => {
      if (url.includes('action=initializeUpload')) {
        return new Response(
          JSON.stringify({
            value: {
              video: 'urn:li:video:9',
              uploadToken: 'tok',
              uploadInstructions: [
                { firstByte: 0, lastByte: 4, uploadUrl: 'https://upload/part-0' },
                { firstByte: 5, lastByte: 99, uploadUrl: 'https://upload/part-1' },
              ],
            },
          }),
          { status: 200 },
        );
      }
      if (url.startsWith('https://upload/part-')) {
        return new Response('', {
          status: 200,
          headers: { etag: `"etag-${url.slice(-1)}"` },
        });
      }
      return new Response('{}', { status: 200 });
    });

    const ref = await new LinkedInAdapter().uploadMedia({
      accessToken: 'at',
      externalAccountId: 'member-1',
      media: { kind: 'video', bytes, contentType: 'video/mp4', altText: null },
    });

    expect(ref.id).toBe('urn:li:video:9');
    const parts = calls.filter((call) => call.url.startsWith('https://upload/part-'));
    expect((parts[0]!.init.body as Uint8Array).length).toBe(5);
    expect((parts[1]!.init.body as Uint8Array).length).toBe(5);
    const finalize = calls.at(-1)!;
    expect(finalize.url).toBe('https://api.linkedin.com/rest/videos?action=finalizeUpload');
    expect(JSON.parse(finalize.init.body as string)).toEqual({
      finalizeUploadRequest: {
        video: 'urn:li:video:9',
        uploadToken: 'tok',
        uploadedPartIds: ['etag-0', 'etag-1'],
      },
    });
  });

  it('keeps the link out of the body and posts it as the first comment', async () => {
    const calls = routeFetch((url) => {
      if (url === 'https://api.linkedin.com/rest/posts') {
        return new Response('{}', { status: 201, headers: { 'x-restli-id': 'urn:li:share:7' } });
      }
      return new Response(JSON.stringify({ id: '7506' }), { status: 201 });
    });

    const result = await new LinkedInAdapter().publish({
      accessToken: 'at',
      externalAccountId: 'member-1',
      body: 'Hello',
      linkUrl: 'https://example.com/a',
      linkPlacement: 'comment',
      linkCommentText: 'Full write-up:',
      media: { kind: 'image', id: 'urn:li:image:42', altText: 'A chart' },
    });

    expect(result.commentExternalId).toBe('7506');
    expect(result.commentError).toBeNull();
    const post = JSON.parse(calls[0]!.init.body as string) as Record<string, unknown>;
    expect(post.commentary).toBe('Hello');
    expect(post.content).toEqual({ media: { id: 'urn:li:image:42', altText: 'A chart' } });
    expect(calls[1]!.url).toBe(
      'https://api.linkedin.com/rest/socialActions/urn%3Ali%3Ashare%3A7/comments',
    );
    expect(JSON.parse(calls[1]!.init.body as string)).toEqual({
      actor: 'urn:li:person:member-1',
      object: 'urn:li:share:7',
      message: { text: 'Full write-up:\n\nhttps://example.com/a' },
    });
  });

  it('falls back to the unversioned route when the versioned one is gated behind a product', async () => {
    const calls = routeFetch((url) => {
      if (url === 'https://api.linkedin.com/rest/posts') {
        return new Response('{}', { status: 201, headers: { 'x-restli-id': 'urn:li:share:7' } });
      }
      if (url.startsWith('https://api.linkedin.com/rest/socialActions')) {
        return new Response('{"code":"ACCESS_DENIED"}', { status: 403 });
      }
      return new Response(JSON.stringify({ id: '7506' }), { status: 201 });
    });

    const result = await new LinkedInAdapter().publish({
      accessToken: 'at',
      externalAccountId: 'member-1',
      body: 'Hello',
      linkUrl: 'https://example.com/a',
      linkPlacement: 'comment',
      linkCommentText: null,
      media: null,
    });

    expect(result.commentExternalId).toBe('7506');
    expect(result.commentError).toBeNull();
    expect(calls.map((call) => call.url)).toEqual([
      'https://api.linkedin.com/rest/posts',
      'https://api.linkedin.com/rest/socialActions/urn%3Ali%3Ashare%3A7/comments',
      'https://api.linkedin.com/v2/socialActions/urn%3Ali%3Ashare%3A7/comments',
    ]);
    expect(calls[2]!.init.headers as Record<string, string>).not.toHaveProperty('linkedin-version');
  });

  it('does not retry the unversioned route for a refusal that is not a product gate', async () => {
    const calls = routeFetch((url) => {
      if (url === 'https://api.linkedin.com/rest/posts') {
        return new Response('{}', { status: 201, headers: { 'x-restli-id': 'urn:li:share:7' } });
      }
      return new Response('{"message":"comment create throttled"}', { status: 429 });
    });

    const result = await new LinkedInAdapter().publish({
      accessToken: 'at',
      externalAccountId: 'member-1',
      body: 'Hello',
      linkUrl: 'https://example.com/a',
      linkPlacement: 'comment',
      linkCommentText: null,
      media: null,
    });

    expect(result.commentError).toMatch(/429.*throttled/);
    expect(calls).toHaveLength(2);
  });

  it('keeps the published post when both comment routes are refused, and reports why', async () => {
    routeFetch((url) => {
      if (url === 'https://api.linkedin.com/rest/posts') {
        return new Response('{}', { status: 201, headers: { 'x-restli-id': 'urn:li:share:7' } });
      }
      return new Response('{"code":"ACCESS_DENIED"}', { status: 403 });
    });

    const result = await new LinkedInAdapter().publish({
      accessToken: 'at',
      externalAccountId: 'member-1',
      body: 'Hello',
      linkUrl: 'https://example.com/a',
      linkPlacement: 'comment',
      linkCommentText: null,
      media: null,
    });

    expect(result.externalPostId).toBe('urn:li:share:7');
    expect(result.commentExternalId).toBeNull();
    expect(result.commentError).toMatch(/403 versioned, 403 legacy/);
  });
});

describe('commentRouteExhausted', () => {
  it('treats only a product gate as worth a second route', () => {
    expect(commentRouteExhausted(403)).toBe(false);
    expect(commentRouteExhausted(404)).toBe(false);
    expect(commentRouteExhausted(426)).toBe(false);
    expect(commentRouteExhausted(429)).toBe(true);
    expect(commentRouteExhausted(422)).toBe(true);
  });
});
