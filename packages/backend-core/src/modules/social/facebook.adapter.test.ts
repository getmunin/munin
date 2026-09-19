import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  FacebookAdapter,
  apiVersion,
  composeCommentText,
  composeMessage,
  graphErrorDetail,
  isRevokedTokenError,
  permalinkFor,
  readPageEntries,
  readPostId,
  readTokenResponse,
} from './facebook.adapter.ts';
import { SocialGrantRevokedError, type SocialPublishRequest } from './social-oauth.ts';

const oauthError = (code: number, message = 'nope') =>
  JSON.stringify({ error: { message, type: 'OAuthException', code } });

describe('readTokenResponse', () => {
  it('reads the long-lived token and its sixty-day expiry', () => {
    const set = readTokenResponse({ access_token: 'at', expires_in: 5183944 });
    expect(set.accessToken).toBe('at');
    expect(set.expiresInSeconds).toBe(5183944);
  });

  it('rejects a response with no access token rather than storing an empty grant', () => {
    expect(() => readTokenResponse({ expires_in: 60 })).toThrow(/no access token/);
    expect(() => readTokenResponse({ access_token: '' })).toThrow(/no access token/);
    expect(() => readTokenResponse('nope')).toThrow(/not an object/);
  });

  it('ignores a non-numeric expiry instead of minting an Invalid Date', () => {
    expect(
      readTokenResponse({ access_token: 'at', expires_in: 'soon' }).expiresInSeconds,
    ).toBeUndefined();
  });
});

describe('isRevokedTokenError', () => {
  it('treats an OAuthException as revocation, so the person is asked to reconnect', () => {
    expect(isRevokedTokenError(oauthError(190, 'Session has expired'))).toBe(true);
    expect(isRevokedTokenError(JSON.stringify({ error: { code: 102 } }))).toBe(true);
  });

  it('leaves a transient fault alone, which reconnecting would not fix', () => {
    expect(
      isRevokedTokenError(JSON.stringify({ error: { code: 4, type: 'GraphMethodException' } })),
    ).toBe(false);
    expect(
      isRevokedTokenError(JSON.stringify({ error: { code: 1, type: 'GraphMethodException' } })),
    ).toBe(false);
  });

  it('does not mistake unparseable output for revocation', () => {
    expect(isRevokedTokenError('<html>502 Bad Gateway</html>')).toBe(false);
    expect(isRevokedTokenError('')).toBe(false);
  });
});

describe('graphErrorDetail', () => {
  it('lifts the vendor message out so a refusal says what was wrong', () => {
    expect(graphErrorDetail(JSON.stringify({ error: { message: 'Message is too long' } }))).toBe(
      'Message is too long',
    );
  });

  it('falls back to the raw body when there is no error envelope', () => {
    expect(graphErrorDetail('plain trouble')).toBe('plain trouble');
  });
});

describe('composeMessage', () => {
  it('appends the tracked link when the body does not already carry it', () => {
    expect(composeMessage('Read this', 'https://example.test/a')).toBe(
      'Read this\n\nhttps://example.test/a',
    );
  });

  it('does not append a link the body already quotes, so it is not published twice', () => {
    const body = 'Read this https://example.test/a';
    expect(composeMessage(body, 'https://example.test/a')).toBe(body);
  });

  it('leaves the body alone when there is no link', () => {
    expect(composeMessage('just text', null)).toBe('just text');
  });
});

describe('composeCommentText', () => {
  it('uses the bare link when no wording was given', () => {
    expect(composeCommentText('https://example.test/a', null)).toBe('https://example.test/a');
  });

  it('appends the link to wording that omits it', () => {
    expect(composeCommentText('https://example.test/a', 'More here:')).toBe(
      'More here:\n\nhttps://example.test/a',
    );
  });
});

describe('permalinkFor', () => {
  it('builds a Page post URL from the compound id Facebook returns', () => {
    expect(permalinkFor('1234_5678')).toBe('https://www.facebook.com/1234/posts/5678');
  });

  it('returns null for an id of another shape, rather than a link that 404s', () => {
    expect(permalinkFor('1234')).toBeNull();
    expect(permalinkFor('page_post')).toBeNull();
  });
});

describe('readPostId', () => {
  it('rejects an accepted-but-idless response instead of recording an empty post', () => {
    expect(() => readPostId({})).toThrow(/no post id/);
    expect(() => readPostId(null)).toThrow(/no post id/);
  });
});

describe('readPageEntries', () => {
  const page = (over: Record<string, unknown> = {}) => ({
    id: '1',
    name: 'Acme',
    access_token: 'page-at',
    tasks: ['CREATE_CONTENT', 'MANAGE'],
    ...over,
  });

  it('keeps only the Pages this person may actually post to', () => {
    const { targets } = readPageEntries({
      data: [page(), page({ id: '2', name: 'Globex', tasks: ['ANALYZE'] })],
    });
    expect(targets).toEqual([
      { externalAccountId: '1', displayName: 'Acme', accessToken: 'page-at' },
    ]);
  });

  it('skips an entry with no page token, which could never publish', () => {
    const { targets } = readPageEntries({ data: [page({ access_token: undefined })] });
    expect(targets).toEqual([]);
  });

  it('carries the next cursor so a long Page list is not silently truncated', () => {
    const { next } = readPageEntries({ data: [], paging: { next: 'https://graph.example.test/next' } });
    expect(next).toBe('https://graph.example.test/next');
    expect(readPageEntries({ data: [] }).next).toBeNull();
  });

  it('refuses a body with no data array rather than reporting no Pages', () => {
    expect(() => readPageEntries({})).toThrow(/no Page list/);
  });
});

describe('apiVersion', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('pins a default of the documented vN.N shape', () => {
    expect(apiVersion()).toMatch(/^v\d+\.\d+$/);
  });

  it('takes an override, so a version rotation needs no release', () => {
    vi.stubEnv('MUNIN_FACEBOOK_API_VERSION', 'v99.0');
    expect(apiVersion()).toBe('v99.0');
  });

  it('ignores a malformed override rather than building a broken URL', () => {
    vi.stubEnv('MUNIN_FACEBOOK_API_VERSION', '202609');
    expect(apiVersion()).toMatch(/^v\d+\.\d+$/);
  });
});

describe('FacebookAdapter.authorizeUrl', () => {
  it('requests the Page scopes, without which nothing can be posted', () => {
    const url = new URL(
      new FacebookAdapter().authorizeUrl({
        state: 'st',
        redirectUri: 'https://munin.example.test/v1/social/oauth/callback',
        clientId: 'cid',
      }),
    );
    expect(url.pathname).toMatch(/\/dialog\/oauth$/);
    expect(url.searchParams.get('scope')?.split(',')).toContain('pages_manage_posts');
    expect(url.searchParams.get('state')).toBe('st');
    expect(url.searchParams.get('client_id')).toBe('cid');
  });
});

describe('FacebookAdapter.refresh', () => {
  it('reports revocation rather than pretending a Page token can be renewed', async () => {
    await expect(new FacebookAdapter().refresh()).rejects.toBeInstanceOf(SocialGrantRevokedError);
  });
});

describe('FacebookAdapter.exchangeCode', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('trades the code for a short-lived token and then for the long-lived one', async () => {
    const fetchMock = vi.fn((url: unknown) => {
      const query = new URL(String(url)).searchParams;
      return Promise.resolve(
        new Response(
          JSON.stringify(
            query.get('grant_type') === 'fb_exchange_token'
              ? { access_token: 'long-lived', expires_in: 5183944 }
              : { access_token: 'short-lived', expires_in: 3600 },
          ),
          { status: 200 },
        ),
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    const tokens = await new FacebookAdapter().exchangeCode({
      code: 'code',
      redirectUri: 'https://munin.example.test/v1/social/oauth/callback',
      client: { clientId: 'cid', clientSecret: 'secret' },
    });

    expect(tokens.accessToken).toBe('long-lived');
    expect(tokens.expiresInSeconds).toBe(5183944);
    const second = new URL(String((fetchMock.mock.calls[1] as unknown[])[0]));
    expect(second.searchParams.get('fb_exchange_token')).toBe('short-lived');
  });
});

describe('FacebookAdapter.listTargets', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('follows paging so a person with many Pages sees them all', async () => {
    const fetchMock = vi.fn((url: unknown) =>
      Promise.resolve(
        new Response(
          JSON.stringify(
            String(url).includes('after=2')
              ? { data: [{ id: '2', name: 'Globex', access_token: 'b', tasks: ['CREATE_CONTENT'] }] }
              : {
                  data: [{ id: '1', name: 'Acme', access_token: 'a', tasks: ['CREATE_CONTENT'] }],
                  paging: { next: 'https://graph.example.test/me/accounts?after=2' },
                },
          ),
          { status: 200 },
        ),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const targets = await new FacebookAdapter().listTargets({ accessToken: 'owner' });
    expect(targets.map((t) => t.externalAccountId)).toEqual(['1', '2']);
  });

  it('reports a lapsed grant as revocation rather than an empty Page list', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response(oauthError(190), { status: 400 }))),
    );
    await expect(new FacebookAdapter().listTargets({ accessToken: 'owner' })).rejects.toBeInstanceOf(
      SocialGrantRevokedError,
    );
  });
});

describe('FacebookAdapter.publish', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubFetch(...responses: Response[]) {
    const queue = [...responses];
    const fetchMock = vi.fn(() =>
      Promise.resolve(queue.shift() ?? new Response('{}', { status: 200 })),
    );
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  const posted = (id = '1234_5678') => new Response(JSON.stringify({ id }), { status: 200 });

  const request = (over: Partial<SocialPublishRequest> = {}): SocialPublishRequest => ({
    accessToken: 'page-at',
    externalAccountId: '1234',
    body: 'Hello',
    linkUrl: null,
    linkPlacement: 'body',
    linkCommentText: null,
    media: null,
    ...over,
  });

  function sentParams(call: unknown): URLSearchParams {
    const init = (call as unknown[])[1] as RequestInit;
    return new URLSearchParams(init.body as string);
  }

  it('posts to the Page feed and returns the post id with its permalink', async () => {
    const fetchMock = stubFetch(posted());
    const result = await new FacebookAdapter().publish(request());

    expect(result).toEqual({
      externalPostId: '1234_5678',
      permalink: 'https://www.facebook.com/1234/posts/5678',
      commentExternalId: null,
      commentError: null,
    });
    const [url] = fetchMock.mock.calls[0] as unknown as [string];
    expect(url).toMatch(/\/1234\/feed$/);
    const sent = sentParams(fetchMock.mock.calls[0]);
    expect(sent.get('message')).toBe('Hello');
    expect(sent.get('access_token')).toBe('page-at');
  });

  it('sends a bare link as the link parameter, so Facebook renders its preview card', async () => {
    const fetchMock = stubFetch(posted());
    await new FacebookAdapter().publish(request({ linkUrl: 'https://example.test/a' }));
    const sent = sentParams(fetchMock.mock.calls[0]);
    expect(sent.get('link')).toBe('https://example.test/a');
    expect(sent.get('message')).toBe('Hello');
  });

  it('puts the link in the text when a photo is attached, since a photo post carries no preview', async () => {
    const fetchMock = stubFetch(posted());
    await new FacebookAdapter().publish(
      request({
        linkUrl: 'https://example.test/a',
        media: { kind: 'image', id: 'photo-1', altText: null },
      }),
    );
    const sent = sentParams(fetchMock.mock.calls[0]);
    expect(sent.get('link')).toBeNull();
    expect(sent.get('attached_media')).toBe('[{"media_fbid":"photo-1"}]');
    expect(sent.get('message')).toBe('Hello\n\nhttps://example.test/a');
  });

  it('publishes the link as the first comment when asked to', async () => {
    const fetchMock = stubFetch(posted(), posted('1234_5678_9'));
    const result = await new FacebookAdapter().publish(
      request({ linkUrl: 'https://example.test/a', linkPlacement: 'comment' }),
    );

    expect(result.commentExternalId).toBe('1234_5678_9');
    expect(result.commentError).toBeNull();
    const [commentUrl] = fetchMock.mock.calls[1] as unknown as [string];
    expect(commentUrl).toMatch(/\/1234_5678\/comments$/);
    expect(sentParams(fetchMock.mock.calls[1]).get('message')).toBe('https://example.test/a');
    expect(sentParams(fetchMock.mock.calls[0]).get('message')).toBe('Hello');
  });

  it('keeps the post when the comment is refused, reporting why', async () => {
    stubFetch(posted(), new Response(JSON.stringify({ error: { message: 'no' } }), { status: 403 }));
    const result = await new FacebookAdapter().publish(
      request({ linkUrl: 'https://example.test/a', linkPlacement: 'comment' }),
    );
    expect(result.externalPostId).toBe('1234_5678');
    expect(result.commentError).toMatch(/403/);
  });

  it('reports a lapsed grant as revocation so the person is asked to reconnect', async () => {
    stubFetch(new Response(oauthError(190), { status: 400 }));
    await expect(new FacebookAdapter().publish(request())).rejects.toBeInstanceOf(
      SocialGrantRevokedError,
    );
  });

  it('carries the platform reason out on a refusal, rather than a bare status', async () => {
    stubFetch(
      new Response(JSON.stringify({ error: { message: 'Message is too long', code: 100 } }), {
        status: 400,
      }),
    );
    await expect(new FacebookAdapter().publish(request())).rejects.toThrow(/Message is too long/);
  });
});

describe('FacebookAdapter.uploadMedia', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uploads an unpublished photo and returns the id the post attaches', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(new Response(JSON.stringify({ id: 'photo-1' }), { status: 200 })),
    );
    vi.stubGlobal('fetch', fetchMock);

    const ref = await new FacebookAdapter().uploadMedia({
      accessToken: 'page-at',
      externalAccountId: '1234',
      media: {
        kind: 'image',
        bytes: Buffer.from('png-bytes'),
        contentType: 'image/png',
        altText: 'A chart',
      },
    });

    expect(ref).toEqual({ kind: 'image', id: 'photo-1', altText: 'A chart' });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/\/1234\/photos$/);
    const form = init.body as FormData;
    expect(form.get('published')).toBe('false');
    expect(form.get('alt_text_custom')).toBe('A chart');
  });

  it('refuses a video rather than uploading it to an endpoint that takes photos', async () => {
    await expect(
      new FacebookAdapter().uploadMedia({
        accessToken: 'page-at',
        externalAccountId: '1234',
        media: {
          kind: 'video',
          bytes: Buffer.from('mp4'),
          contentType: 'video/mp4',
          altText: null,
        },
      }),
    ).rejects.toThrow(/image, not a video/);
  });
});
