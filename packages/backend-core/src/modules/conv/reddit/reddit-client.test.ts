import { describe, it, expect, beforeEach } from 'vitest';
import {
  RedditApiError,
  RedditClientService,
  classifyRedditJsonErrors,
  classifyRedditStatus,
  parseRedditRateLimit,
  redditUserAgent,
  stripFullnamePrefix,
  stripSubredditPrefix,
  type RedditCredentials,
  type RedditHttp,
  type RedditHttpRequest,
  type RedditHttpResponse,
} from './reddit-client.service.ts';

const CREDENTIALS: RedditCredentials = {
  clientId: 'cid',
  clientSecret: 'csecret',
  username: 'munin_bot',
  password: 'pw',
};

class ScriptedHttp implements RedditHttp {
  readonly seen: RedditHttpRequest[] = [];
  private readonly queue: RedditHttpResponse[] = [];

  push(...responses: RedditHttpResponse[]): void {
    this.queue.push(...responses);
  }

  pushToken(): void {
    this.push({
      status: 200,
      headers: {},
      body: JSON.stringify({ access_token: 'tok', expires_in: 3600 }),
    });
  }

  request(req: RedditHttpRequest): Promise<RedditHttpResponse> {
    this.seen.push(req);
    const next = this.queue.shift();
    if (!next) throw new Error(`no scripted response for ${req.method} ${req.url}`);
    return Promise.resolve(next);
  }
}

function json(body: unknown, headers: Record<string, string> = {}, status = 200): RedditHttpResponse {
  return { status, headers, body: JSON.stringify(body) };
}

describe('redditUserAgent', () => {
  it('names the platform, app, version and the operating account', () => {
    expect(redditUserAgent('munin_bot')).toMatch(/^web:munin:v[\w.-]+ \(by \/u\/munin_bot\)$/);
  });
});

describe('parseRedditRateLimit', () => {
  it('reads the three ratelimit headers as numbers', () => {
    expect(
      parseRedditRateLimit({
        'x-ratelimit-remaining': '297.0',
        'x-ratelimit-reset': '412',
        'x-ratelimit-used': '3',
      }),
    ).toEqual({ remaining: 297, reset: 412, used: 3 });
  });

  it('reports nulls when Reddit omits the headers', () => {
    expect(parseRedditRateLimit({})).toEqual({ remaining: null, reset: null, used: null });
  });
});

describe('classifyRedditStatus', () => {
  it('treats a success as no failure at all', () => {
    expect(classifyRedditStatus(200, {})).toBeNull();
  });

  it('defers a 429 until the ratelimit window resets', () => {
    expect(classifyRedditStatus(429, { 'x-ratelimit-reset': '90' })).toEqual({
      kind: 'deferred',
      retryAfterSeconds: 90,
    });
  });

  it('falls back to Retry-After when there is no reset header', () => {
    expect(classifyRedditStatus(429, { 'retry-after': '30' })).toEqual({
      kind: 'deferred',
      retryAfterSeconds: 30,
    });
  });

  it('retries a 5xx because the account is not the problem', () => {
    expect(classifyRedditStatus(503, {})).toEqual({ kind: 'retry', retryAfterSeconds: null });
  });

  it('never retries an unauthorized or forbidden response', () => {
    expect(classifyRedditStatus(401, {})?.kind).toBe('terminal');
    expect(classifyRedditStatus(403, {})?.kind).toBe('terminal');
  });

  it('never retries an ordinary 4xx', () => {
    expect(classifyRedditStatus(404, {})?.kind).toBe('terminal');
    expect(classifyRedditStatus(400, {})?.kind).toBe('terminal');
  });
});

describe('classifyRedditJsonErrors', () => {
  it('reports no failure for an empty error list', () => {
    expect(classifyRedditJsonErrors([], null)).toBeNull();
  });

  it('defers RATELIMIT for the seconds Reddit names in the same envelope', () => {
    expect(
      classifyRedditJsonErrors(
        [['RATELIMIT', 'you are doing that too much. try again in 9 minutes.', 'ratelimit']],
        543,
      ),
    ).toMatchObject({ kind: 'deferred', code: 'RATELIMIT', retryAfterSeconds: 543 });
  });

  it('defers RATELIMIT with a conservative default when no seconds are given', () => {
    const failure = classifyRedditJsonErrors([['RATELIMIT', 'slow down', 'ratelimit']], null);
    expect(failure?.kind).toBe('deferred');
    expect(failure?.retryAfterSeconds).toBeGreaterThan(0);
  });

  it.each([
    'USER_BLOCKED',
    'NOT_WHITELISTED_BY_USER_MESSAGE',
    'SUBREDDIT_NOTALLOWED',
    'THREAD_LOCKED',
    'TOO_OLD',
    'DELETED_COMMENT',
    'BANNED_FROM_SUBREDDIT',
  ])('kills the delivery outright on %s', (code) => {
    expect(classifyRedditJsonErrors([[code, 'nope', null]], null)).toMatchObject({
      kind: 'terminal',
      code,
    });
  });

  it('kills the delivery on an unrecognised code rather than hammering the account', () => {
    expect(classifyRedditJsonErrors([['SOME_NEW_CODE', 'nope', null]], null)).toMatchObject({
      kind: 'terminal',
      code: 'SOME_NEW_CODE',
    });
  });
});

describe('fullname and subreddit normalisation', () => {
  it('strips a fullname prefix', () => {
    expect(stripFullnamePrefix('t3_abc123')).toBe('abc123');
    expect(stripFullnamePrefix('abc123')).toBe('abc123');
  });

  it('strips an r/ prefix in either form', () => {
    expect(stripSubredditPrefix('r/devops')).toBe('devops');
    expect(stripSubredditPrefix('/r/devops')).toBe('devops');
    expect(stripSubredditPrefix('devops')).toBe('devops');
  });
});

describe('RedditClientService', () => {
  let http: ScriptedHttp;
  let client: RedditClientService;

  beforeEach(() => {
    http = new ScriptedHttp();
    client = new RedditClientService();
    client.setHttp(http);
  });

  it('exchanges the script app credentials for a bearer token and sends the User-Agent everywhere', async () => {
    http.pushToken();
    http.push(json({ name: 'munin_bot', total_karma: 12 }));

    await client.getMe(CREDENTIALS);

    const [token, me] = http.seen;
    expect(token!.url).toContain('/api/v1/access_token');
    expect(token!.headers.authorization).toBe(
      `Basic ${Buffer.from('cid:csecret').toString('base64')}`,
    );
    expect(token!.body).toContain('grant_type=password');
    expect(token!.body).toContain('username=munin_bot');
    expect(token!.headers['user-agent']).toBe(redditUserAgent('munin_bot'));
    expect(me!.url).toBe('https://oauth.reddit.com/api/v1/me');
    expect(me!.headers.authorization).toBe('Bearer tok');
    expect(me!.headers['user-agent']).toBe(redditUserAgent('munin_bot'));
  });

  it('reuses the cached token for a second call with the same credentials', async () => {
    http.pushToken();
    http.push(json({ name: 'munin_bot' }), json({ name: 'munin_bot' }));

    await client.getMe(CREDENTIALS);
    await client.getMe(CREDENTIALS);

    expect(http.seen.filter((r) => r.url.includes('access_token'))).toHaveLength(1);
  });

  it('rejects bad script app credentials terminally', async () => {
    http.push({ status: 401, headers: {}, body: '{}' });
    await expect(client.getMe(CREDENTIALS)).rejects.toMatchObject({
      name: 'RedditApiError',
      kind: 'terminal',
    });
  });

  it('reports a 200 carrying json.errors as a failure, not a success', async () => {
    http.pushToken();
    http.push(
      json({ json: { errors: [['USER_BLOCKED', 'that user has blocked you', null]] } }),
    );

    const err = await client
      .sendDm(CREDENTIALS, { to: 'someone', subject: 's', text: 't' })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RedditApiError);
    expect(err).toMatchObject({ kind: 'terminal', code: 'USER_BLOCKED' });
  });

  it('defers on a 429 using the ratelimit reset header', async () => {
    http.pushToken();
    http.push({
      status: 429,
      headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '120' },
      body: '',
    });

    const err = await client
      .postComment(CREDENTIALS, { parentFullname: 't3_abc', text: 'hi' })
      .catch((e: unknown) => e);
    expect(err).toMatchObject({ kind: 'deferred', retryAfterSeconds: 120 });
  });

  it('refuses a further write once the window reports no requests remaining', async () => {
    http.pushToken();
    http.push(
      json(
        { json: { errors: [], data: { things: [{ kind: 't1', data: { id: 'x1', name: 't1_x1' } }] } } },
        { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '300' },
      ),
    );

    await client.postComment(CREDENTIALS, { parentFullname: 't3_abc', text: 'first' });
    const callsAfterFirst = http.seen.length;

    const err = await client
      .postComment(CREDENTIALS, { parentFullname: 't3_abc', text: 'second' })
      .catch((e: unknown) => e);
    expect(err).toMatchObject({ kind: 'deferred', code: 'RATELIMIT' });
    expect(http.seen).toHaveLength(callsAfterFirst);
  });

  it('retries a 5xx as ordinary transport flakiness', async () => {
    http.pushToken();
    http.push({ status: 503, headers: {}, body: 'upstream down' });
    await expect(
      client.postComment(CREDENTIALS, { parentFullname: 't3_abc', text: 'hi' }),
    ).rejects.toMatchObject({ kind: 'retry' });
  });

  it('turns a socket failure into a retryable error', async () => {
    const failing: RedditHttp = {
      request: () => Promise.reject(new Error('socket hang up')),
    };
    client.setHttp(failing);
    await expect(client.getMe(CREDENTIALS)).rejects.toMatchObject({ kind: 'retry' });
  });

  it('returns the created comment fullname so inbound replies can attach to it', async () => {
    http.pushToken();
    http.push(
      json({
        json: {
          errors: [],
          data: { things: [{ kind: 't1', data: { id: 'k9', name: 't1_k9', body: 'hi' } }] },
        },
      }),
    );
    const res = await client.postComment(CREDENTIALS, { parentFullname: 't3_abc', text: 'hi' });
    expect(res.data).toEqual({ fullname: 't1_k9', id: 'k9' });
    const post = http.seen[1]!;
    expect(post.body).toContain('api_type=json');
    expect(post.body).toContain('thing_id=t3_abc');
  });

  it('reports a null fullname when Reddit answers a compose with no created thing', async () => {
    http.pushToken();
    http.push(json({ json: { errors: [] } }));
    const res = await client.sendDm(CREDENTIALS, { to: 'ada', subject: 'Hi', text: 'hello' });
    expect(res.data.fullname).toBeNull();
  });

  it('caps the DM subject at Reddit’s 100 character limit', async () => {
    http.pushToken();
    http.push(json({ json: { errors: [] } }));
    await client.sendDm(CREDENTIALS, { to: 'ada', subject: 'x'.repeat(200), text: 'hello' });
    const body = new URLSearchParams(http.seen[1]!.body ?? '');
    expect(body.get('subject')).toHaveLength(100);
  });

  it('splits the unread inbox into DMs and comment replies', async () => {
    http.pushToken();
    http.push(
      json({
        kind: 'Listing',
        data: {
          children: [
            {
              kind: 't4',
              data: {
                id: 'd1',
                name: 't4_d1',
                author: 'ada_l',
                body: 'hello there',
                subject: 'question',
                created_utc: 1_700_000_000,
              },
            },
            {
              kind: 't1',
              data: {
                id: 'c1',
                name: 't1_c1',
                author: 'grace_h',
                body: 'good point',
                link_id: 't3_abc123',
                parent_id: 't1_ours',
                subreddit: 'devops',
                created_utc: 1_700_000_100,
                was_comment: true,
                type: 'comment_reply',
              },
            },
          ],
        },
      }),
    );
    const res = await client.listUnread(CREDENTIALS, { limit: 10 });
    expect(res.data.map((i) => i.kind)).toEqual(['t4', 't1']);
    expect(res.data[1]).toMatchObject({
      fullname: 't1_c1',
      linkId: 't3_abc123',
      parentId: 't1_ours',
      subreddit: 'devops',
    });
  });

  it('marks messages read in one batched request', async () => {
    http.pushToken();
    http.push(json({}));
    const res = await client.markRead(CREDENTIALS, ['t1_a', 't4_b']);
    expect(res.data.marked).toBe(2);
    expect(http.seen[1]!.body).toContain('id=t1_a%2Ct4_b');
  });

  it('skips the network entirely when there is nothing to mark read', async () => {
    await client.markRead(CREDENTIALS, []);
    expect(http.seen).toHaveLength(0);
  });

  it('flattens a comment tree with a depth cap and flags that more remains', async () => {
    http.pushToken();
    http.push(
      json([
        {
          kind: 'Listing',
          data: {
            children: [
              {
                kind: 't3',
                data: {
                  id: 'abc123',
                  name: 't3_abc123',
                  title: 'How do you handle X?',
                  author: 'ada_l',
                  selftext: 'the long version',
                  subreddit: 'devops',
                  num_comments: 4,
                },
              },
            ],
          },
        },
        {
          kind: 'Listing',
          data: {
            children: [
              {
                kind: 't1',
                data: {
                  id: 'c1',
                  name: 't1_c1',
                  author: 'grace_h',
                  body: 'top level',
                  replies: {
                    kind: 'Listing',
                    data: {
                      children: [
                        {
                          kind: 't1',
                          data: {
                            id: 'c2',
                            name: 't1_c2',
                            author: 'alan_t',
                            body: 'nested',
                            replies: {
                              kind: 'Listing',
                              data: { children: [{ kind: 'more', data: { count: 7 } }] },
                            },
                          },
                        },
                      ],
                    },
                  },
                },
              },
            ],
          },
        },
      ]),
    );
    const res = await client.getThread(CREDENTIALS, { threadId: 't3_abc123', maxDepth: 1 });
    expect(res.data.post?.title).toBe('How do you handle X?');
    expect(res.data.comments.map((c) => [c.fullname, c.depth])).toEqual([
      ['t1_c1', 0],
      ['t1_c2', 1],
    ]);
    expect(res.data.moreCommentsAvailable).toBe(true);
  });

  it('reads subreddit rules and the site rules', async () => {
    http.pushToken();
    http.push(
      json({
        rules: [
          {
            kind: 'link',
            short_name: 'No self promotion',
            description: 'Do not link your own product',
            violation_reason: 'Self promotion',
          },
        ],
        site_rules: ['Spam'],
      }),
    );
    const res = await client.getSubredditRules(CREDENTIALS, 'r/devops');
    expect(http.seen[1]!.url).toContain('/r/devops/about/rules');
    expect(res.data.rules[0]).toEqual({
      shortName: 'No self promotion',
      appliesTo: 'link',
      violationReason: 'Self promotion',
      description: 'Do not link your own product',
    });
    expect(res.data.siteRules).toEqual(['Spam']);
  });

  it('batches engagement lookups into one /api/info request', async () => {
    http.pushToken();
    http.push(
      json({
        data: {
          children: [
            { kind: 't1', data: { name: 't1_a', score: 12 } },
            { kind: 't1', data: { name: 't1_b', ups: 3, banned_by: 'AutoModerator' } },
          ],
        },
      }),
    );
    const res = await client.listThingStats(CREDENTIALS, ['t1_a', 't1_b']);
    expect(http.seen[1]!.url).toContain('/api/info?id=t1_a%2Ct1_b');
    expect(res.data).toEqual([
      { fullname: 't1_a', score: 12, removed: false, author: null },
      { fullname: 't1_b', score: 3, removed: true, author: null },
    ]);
  });
});
