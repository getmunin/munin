import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';

export const REDDIT_TOKEN_URL = 'https://www.reddit.com/api/v1/access_token';
export const REDDIT_API_BASE = 'https://oauth.reddit.com';

const FALLBACK_VERSION = '4.77.0';
const TOKEN_EXPIRY_SAFETY_MS = 60_000;
const DEFAULT_DEFERRAL_SECONDS = 600;

export interface RedditCredentials {
  cacheKey: string;
  clientId: string;
  clientSecret: string;
  username: string;
  password: string;
}

export interface RedditRateLimit {
  remaining: number | null;
  reset: number | null;
  used: number | null;
}

export interface RedditCallResult<T> {
  data: T;
  rateLimit: RedditRateLimit;
}

export type RedditFailureKind = 'terminal' | 'deferred' | 'retry';

export class RedditApiError extends Error {
  readonly kind: RedditFailureKind;
  readonly status: number;
  readonly code: string | null;
  readonly retryAfterSeconds: number | null;

  constructor(opts: {
    message: string;
    kind: RedditFailureKind;
    status: number;
    code?: string | null;
    retryAfterSeconds?: number | null;
  }) {
    super(opts.message);
    this.name = 'RedditApiError';
    this.kind = opts.kind;
    this.status = opts.status;
    this.code = opts.code ?? null;
    this.retryAfterSeconds = opts.retryAfterSeconds ?? null;
  }
}

export interface RedditHttpRequest {
  method: 'GET' | 'POST';
  url: string;
  headers: Record<string, string>;
  body?: string;
}

export interface RedditHttpResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

export interface RedditHttp {
  request(req: RedditHttpRequest): Promise<RedditHttpResponse>;
}

class FetchRedditHttp implements RedditHttp {
  async request(req: RedditHttpRequest): Promise<RedditHttpResponse> {
    const res = await fetch(req.url, {
      method: req.method,
      headers: req.headers,
      ...(req.body === undefined ? {} : { body: req.body }),
    });
    const headers: Record<string, string> = {};
    res.headers.forEach((value, key) => {
      headers[key.toLowerCase()] = value;
    });
    return { status: res.status, headers, body: await res.text() };
  }
}

const TokenResponseSchema = z.object({
  access_token: z.string().min(1),
  token_type: z.string().optional(),
  expires_in: z.number().optional(),
  scope: z.string().optional(),
});

const MeSchema = z.object({
  name: z.string(),
  id: z.string().optional(),
  link_karma: z.number().nullable().optional(),
  comment_karma: z.number().nullable().optional(),
  total_karma: z.number().nullable().optional(),
  created_utc: z.number().nullable().optional(),
  is_suspended: z.boolean().nullable().optional(),
});

const ThingSchema = z.object({
  kind: z.string(),
  data: z.record(z.string(), z.unknown()),
});

const ListingSchema = z.object({
  data: z.object({
    after: z.string().nullable().optional(),
    before: z.string().nullable().optional(),
    children: z.array(ThingSchema).default([]),
  }),
});

const JsonEnvelopeSchema = z.object({
  json: z
    .object({
      errors: z.array(z.array(z.unknown())).default([]),
      ratelimit: z.number().nullable().optional(),
      data: z
        .object({
          things: z.array(ThingSchema).optional(),
          id: z.string().optional(),
          name: z.string().optional(),
        })
        .partial()
        .optional(),
    })
    .default({ errors: [] }),
});

const InboxItemDataSchema = z.object({
  id: z.string(),
  name: z.string(),
  author: z.string().nullable().optional(),
  body: z.string().nullable().optional(),
  body_html: z.string().nullable().optional(),
  subject: z.string().nullable().optional(),
  created_utc: z.number().nullable().optional(),
  link_id: z.string().nullable().optional(),
  link_title: z.string().nullable().optional(),
  parent_id: z.string().nullable().optional(),
  subreddit: z.string().nullable().optional(),
  context: z.string().nullable().optional(),
  was_comment: z.boolean().nullable().optional(),
  type: z.string().nullable().optional(),
  dest: z.string().nullable().optional(),
});

const PostDataSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  title: z.string().nullable().optional(),
  author: z.string().nullable().optional(),
  selftext: z.string().nullable().optional(),
  subreddit: z.string().nullable().optional(),
  permalink: z.string().nullable().optional(),
  url: z.string().nullable().optional(),
  score: z.number().nullable().optional(),
  upvote_ratio: z.number().nullable().optional(),
  num_comments: z.number().nullable().optional(),
  created_utc: z.number().nullable().optional(),
  over_18: z.boolean().nullable().optional(),
  locked: z.boolean().nullable().optional(),
  archived: z.boolean().nullable().optional(),
  link_flair_text: z.string().nullable().optional(),
});

const CommentDataSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  author: z.string().nullable().optional(),
  body: z.string().nullable().optional(),
  score: z.number().nullable().optional(),
  created_utc: z.number().nullable().optional(),
  parent_id: z.string().nullable().optional(),
  link_id: z.string().nullable().optional(),
  replies: z.unknown().optional(),
});

const StatsDataSchema = z.object({
  name: z.string(),
  score: z.number().nullable().optional(),
  ups: z.number().nullable().optional(),
  num_comments: z.number().nullable().optional(),
  removed: z.boolean().nullable().optional(),
  banned_by: z.unknown().optional(),
  author: z.string().nullable().optional(),
});

const RulesSchema = z.object({
  rules: z
    .array(
      z.object({
        kind: z.string().nullable().optional(),
        short_name: z.string().nullable().optional(),
        description: z.string().nullable().optional(),
        violation_reason: z.string().nullable().optional(),
        priority: z.number().nullable().optional(),
        created_utc: z.number().nullable().optional(),
      }),
    )
    .default([]),
  site_rules: z.array(z.string()).default([]),
});

export interface RedditMe {
  username: string;
  linkKarma: number | null;
  commentKarma: number | null;
  totalKarma: number | null;
  isSuspended: boolean;
}

export interface RedditInboxItem {
  kind: 't1' | 't4';
  fullname: string;
  id: string;
  author: string | null;
  body: string;
  bodyHtml: string | null;
  subject: string | null;
  createdUtc: number | null;
  linkId: string | null;
  linkTitle: string | null;
  parentId: string | null;
  subreddit: string | null;
  itemType: string | null;
}

export interface RedditThreadSummary {
  id: string;
  fullname: string | null;
  title: string;
  author: string | null;
  subreddit: string | null;
  permalink: string | null;
  url: string | null;
  score: number | null;
  upvoteRatio: number | null;
  numComments: number | null;
  createdUtc: number | null;
  selftext: string;
  flair: string | null;
  over18: boolean;
  locked: boolean;
  archived: boolean;
}

export interface RedditThreadComment {
  id: string;
  fullname: string | null;
  author: string | null;
  body: string;
  score: number | null;
  createdUtc: number | null;
  parentFullname: string | null;
  depth: number;
}

export interface RedditThreadDetail {
  post: RedditThreadSummary | null;
  comments: RedditThreadComment[];
  moreCommentsAvailable: boolean;
}

export interface RedditSubredditRules {
  rules: Array<{
    shortName: string;
    description: string;
    appliesTo: string | null;
    violationReason: string | null;
  }>;
  siteRules: string[];
}

export interface RedditThingStats {
  fullname: string;
  score: number | null;
  removed: boolean;
  author: string | null;
}

export interface RedditCreatedThing {
  fullname: string | null;
  id: string | null;
}

const TERMINAL_ERROR_CODES = new Set([
  'BAD_CAPTCHA',
  'BANNED_FROM_SUBREDDIT',
  'CANT_SEND_TO_SELF',
  'DELETED_COMMENT',
  'DELETED_LINK',
  'DELETED_THING',
  'NOT_AUTHOR',
  'NOT_WHITELISTED_BY_USER_MESSAGE',
  'NO_TEXT',
  'NO_USER',
  'SUBREDDIT_NOEXIST',
  'SUBREDDIT_NOTALLOWED',
  'SUBREDDIT_REQUIRED',
  'THREAD_LOCKED',
  'TOO_LONG',
  'TOO_OLD',
  'USER_BLOCKED',
  'USER_DOESNT_EXIST',
  'USER_REQUIRED',
]);

const DEFERRED_ERROR_CODES = new Set(['RATELIMIT', 'QUOTA_FILLED']);

export function redditUserAgent(username: string): string {
  const version = process.env.MUNIN_VERSION ?? FALLBACK_VERSION;
  return `web:munin:v${version} (by /u/${username})`;
}

export function parseRedditRateLimit(headers: Record<string, string>): RedditRateLimit {
  return {
    remaining: numericHeader(headers['x-ratelimit-remaining']),
    reset: numericHeader(headers['x-ratelimit-reset']),
    used: numericHeader(headers['x-ratelimit-used']),
  };
}

export function classifyRedditStatus(
  status: number,
  headers: Record<string, string>,
): { kind: RedditFailureKind; retryAfterSeconds: number | null } | null {
  if (status >= 200 && status < 300) return null;
  if (status === 429) {
    return { kind: 'deferred', retryAfterSeconds: deferralSecondsFromHeaders(headers) };
  }
  if (status >= 500) return { kind: 'retry', retryAfterSeconds: null };
  if (status === 401 || status === 403) return { kind: 'terminal', retryAfterSeconds: null };
  return { kind: 'terminal', retryAfterSeconds: null };
}

export function classifyRedditJsonErrors(
  errors: unknown[][],
  ratelimitSeconds: number | null,
): { kind: RedditFailureKind; code: string; detail: string; retryAfterSeconds: number | null } | null {
  if (errors.length === 0) return null;
  const first = errors[0] ?? [];
  const code = typeof first[0] === 'string' ? first[0].toUpperCase() : 'UNKNOWN';
  const detail = typeof first[1] === 'string' ? first[1] : '';
  if (DEFERRED_ERROR_CODES.has(code)) {
    return {
      kind: 'deferred',
      code,
      detail,
      retryAfterSeconds:
        ratelimitSeconds !== null && ratelimitSeconds > 0
          ? Math.ceil(ratelimitSeconds)
          : DEFAULT_DEFERRAL_SECONDS,
    };
  }
  if (TERMINAL_ERROR_CODES.has(code)) {
    return { kind: 'terminal', code, detail, retryAfterSeconds: null };
  }
  return { kind: 'terminal', code, detail, retryAfterSeconds: null };
}

@Injectable()
export class RedditClientService {
  private readonly logger = new Logger(RedditClientService.name);
  private http: RedditHttp = new FetchRedditHttp();
  private readonly tokens = new Map<string, { token: string; expiresAt: number }>();
  private readonly budgets = new Map<string, { rateLimit: RedditRateLimit; observedAt: number }>();

  setHttp(http: RedditHttp): void {
    this.http = http;
    this.tokens.clear();
    this.budgets.clear();
  }

  async getMe(credentials: RedditCredentials): Promise<RedditCallResult<RedditMe>> {
    const res = await this.call(credentials, { method: 'GET', path: '/api/v1/me' });
    const parsed = MeSchema.parse(res.json);
    return {
      rateLimit: res.rateLimit,
      data: {
        username: parsed.name,
        linkKarma: parsed.link_karma ?? null,
        commentKarma: parsed.comment_karma ?? null,
        totalKarma: parsed.total_karma ?? null,
        isSuspended: parsed.is_suspended === true,
      },
    };
  }

  async sendDm(
    credentials: RedditCredentials,
    input: { to: string; subject: string; text: string },
  ): Promise<RedditCallResult<RedditCreatedThing>> {
    this.assertWriteBudget(credentials);
    const res = await this.call(credentials, {
      method: 'POST',
      path: '/api/compose',
      form: {
        api_type: 'json',
        to: input.to,
        subject: input.subject.slice(0, 100),
        text: input.text,
      },
    });
    return { rateLimit: res.rateLimit, data: this.readCreatedThing(res.json, res.rateLimit) };
  }

  async postComment(
    credentials: RedditCredentials,
    input: { parentFullname: string; text: string },
  ): Promise<RedditCallResult<RedditCreatedThing>> {
    this.assertWriteBudget(credentials);
    const res = await this.call(credentials, {
      method: 'POST',
      path: '/api/comment',
      form: { api_type: 'json', thing_id: input.parentFullname, text: input.text },
    });
    return { rateLimit: res.rateLimit, data: this.readCreatedThing(res.json, res.rateLimit) };
  }

  async listUnread(
    credentials: RedditCredentials,
    input?: { limit?: number },
  ): Promise<RedditCallResult<RedditInboxItem[]>> {
    const limit = clamp(input?.limit ?? 50, 1, 100);
    const res = await this.call(credentials, {
      method: 'GET',
      path: `/message/unread?limit=${limit}&raw_json=1`,
    });
    const listing = ListingSchema.parse(res.json);
    const items: RedditInboxItem[] = [];
    for (const child of listing.data.children) {
      if (child.kind !== 't1' && child.kind !== 't4') continue;
      const data = InboxItemDataSchema.safeParse(child.data);
      if (!data.success) continue;
      items.push({
        kind: child.kind,
        fullname: data.data.name,
        id: data.data.id,
        author: data.data.author ?? null,
        body: data.data.body ?? '',
        bodyHtml: data.data.body_html ?? null,
        subject: data.data.subject ?? null,
        createdUtc: data.data.created_utc ?? null,
        linkId: data.data.link_id ?? null,
        linkTitle: data.data.link_title ?? null,
        parentId: data.data.parent_id ?? null,
        subreddit: data.data.subreddit ?? null,
        itemType: data.data.type ?? null,
      });
    }
    return { rateLimit: res.rateLimit, data: items };
  }

  async markRead(
    credentials: RedditCredentials,
    fullnames: readonly string[],
  ): Promise<RedditCallResult<{ marked: number }>> {
    if (fullnames.length === 0) {
      return { rateLimit: emptyRateLimit(), data: { marked: 0 } };
    }
    const res = await this.call(credentials, {
      method: 'POST',
      path: '/api/read_message',
      form: { api_type: 'json', id: fullnames.join(',') },
    });
    return { rateLimit: res.rateLimit, data: { marked: fullnames.length } };
  }

  async searchThreads(
    credentials: RedditCredentials,
    input: {
      subreddit?: string;
      query: string;
      limit?: number;
      sort?: 'relevance' | 'hot' | 'top' | 'new' | 'comments';
      time?: 'hour' | 'day' | 'week' | 'month' | 'year' | 'all';
    },
  ): Promise<RedditCallResult<RedditThreadSummary[]>> {
    const limit = clamp(input.limit ?? 10, 1, 25);
    const params = new URLSearchParams({
      q: input.query,
      limit: String(limit),
      type: 'link',
      raw_json: '1',
      sort: input.sort ?? 'relevance',
      t: input.time ?? 'month',
    });
    let path: string;
    if (input.subreddit) {
      params.set('restrict_sr', '1');
      path = `/r/${encodeURIComponent(input.subreddit)}/search?${params.toString()}`;
    } else {
      path = `/search?${params.toString()}`;
    }
    const res = await this.call(credentials, { method: 'GET', path });
    const listing = ListingSchema.parse(res.json);
    const out: RedditThreadSummary[] = [];
    for (const child of listing.data.children) {
      if (child.kind !== 't3') continue;
      const post = PostDataSchema.safeParse(child.data);
      if (!post.success) continue;
      out.push(toThreadSummary(post.data));
    }
    return { rateLimit: res.rateLimit, data: out };
  }

  async getThread(
    credentials: RedditCredentials,
    input: { threadId: string; commentLimit?: number; maxDepth?: number },
  ): Promise<RedditCallResult<RedditThreadDetail>> {
    const commentLimit = clamp(input.commentLimit ?? 20, 1, 100);
    const maxDepth = clamp(input.maxDepth ?? 2, 0, 6);
    const id = stripFullnamePrefix(input.threadId);
    const res = await this.call(credentials, {
      method: 'GET',
      path: `/comments/${encodeURIComponent(id)}?limit=${commentLimit}&depth=${maxDepth + 1}&raw_json=1`,
    });
    const listings = z.array(ListingSchema).min(1).parse(res.json);
    const postChild = listings[0]!.data.children.find((c) => c.kind === 't3');
    const post = postChild ? PostDataSchema.safeParse(postChild.data) : null;
    const comments: RedditThreadComment[] = [];
    let more = false;
    if (listings[1]) {
      more = collectComments(listings[1].data.children, 0, maxDepth, commentLimit, comments);
    }
    return {
      rateLimit: res.rateLimit,
      data: {
        post: post?.success ? toThreadSummary(post.data) : null,
        comments,
        moreCommentsAvailable: more,
      },
    };
  }

  async getSubredditRules(
    credentials: RedditCredentials,
    subreddit: string,
  ): Promise<RedditCallResult<RedditSubredditRules>> {
    const res = await this.call(credentials, {
      method: 'GET',
      path: `/r/${encodeURIComponent(stripSubredditPrefix(subreddit))}/about/rules?raw_json=1`,
    });
    const parsed = RulesSchema.parse(res.json);
    return {
      rateLimit: res.rateLimit,
      data: {
        rules: parsed.rules.map((r) => ({
          shortName: r.short_name ?? '',
          description: r.description ?? '',
          appliesTo: r.kind ?? null,
          violationReason: r.violation_reason ?? null,
        })),
        siteRules: parsed.site_rules,
      },
    };
  }

  async listThingStats(
    credentials: RedditCredentials,
    fullnames: readonly string[],
  ): Promise<RedditCallResult<RedditThingStats[]>> {
    if (fullnames.length === 0) {
      return { rateLimit: emptyRateLimit(), data: [] };
    }
    const res = await this.call(credentials, {
      method: 'GET',
      path: `/api/info?id=${encodeURIComponent(fullnames.join(','))}&raw_json=1`,
    });
    const listing = ListingSchema.parse(res.json);
    const out: RedditThingStats[] = [];
    for (const child of listing.data.children) {
      const stats = StatsDataSchema.safeParse(child.data);
      if (!stats.success) continue;
      out.push({
        fullname: stats.data.name,
        score: stats.data.score ?? stats.data.ups ?? null,
        removed: stats.data.removed === true || stats.data.banned_by != null,
        author: stats.data.author ?? null,
      });
    }
    return { rateLimit: res.rateLimit, data: out };
  }

  private readCreatedThing(json: unknown, rateLimit: RedditRateLimit): RedditCreatedThing {
    const envelope = JsonEnvelopeSchema.safeParse(json);
    if (!envelope.success) return { fullname: null, id: null };
    const thing = envelope.data.json.data?.things?.[0];
    if (thing) {
      const created = CommentDataSchema.safeParse(thing.data);
      if (created.success) {
        return {
          fullname: created.data.name ?? `${thing.kind}_${created.data.id}`,
          id: created.data.id,
        };
      }
    }
    const direct = envelope.data.json.data;
    if (direct?.name) return { fullname: direct.name, id: direct.id ?? null };
    this.logger.debug(
      `reddit write returned no created thing (rate limit remaining=${rateLimit.remaining ?? 'unknown'})`,
    );
    return { fullname: null, id: null };
  }

  private assertWriteBudget(credentials: RedditCredentials): void {
    const key = credentials.cacheKey;
    const budget = this.budgets.get(key);
    if (!budget) return;
    const { remaining, reset } = budget.rateLimit;
    if (remaining === null || remaining > 0) return;
    const resetSeconds = reset !== null && reset > 0 ? reset : DEFAULT_DEFERRAL_SECONDS;
    const windowEndsAt = budget.observedAt + resetSeconds * 1000;
    const waitMs = windowEndsAt - Date.now();
    if (waitMs <= 0) {
      this.budgets.delete(key);
      return;
    }
    throw new RedditApiError({
      message: `reddit_ratelimit_exhausted: no requests left in the current window, retry in ${Math.ceil(waitMs / 1000)}s`,
      kind: 'deferred',
      status: 429,
      code: 'RATELIMIT',
      retryAfterSeconds: Math.ceil(waitMs / 1000),
    });
  }

  private async call(
    credentials: RedditCredentials,
    req: { method: 'GET' | 'POST'; path: string; form?: Record<string, string> },
  ): Promise<{ json: unknown; rateLimit: RedditRateLimit }> {
    const token = await this.accessToken(credentials);
    const headers: Record<string, string> = {
      authorization: `Bearer ${token}`,
      'user-agent': redditUserAgent(credentials.username),
      accept: 'application/json',
    };
    let body: string | undefined;
    if (req.form) {
      headers['content-type'] = 'application/x-www-form-urlencoded';
      body = new URLSearchParams(req.form).toString();
    }
    const res = await this.transport({
      method: req.method,
      url: `${REDDIT_API_BASE}${req.path}`,
      headers,
      ...(body === undefined ? {} : { body }),
    });
    const rateLimit = parseRedditRateLimit(res.headers);
    this.budgets.set(credentials.cacheKey, { rateLimit, observedAt: Date.now() });

    if (res.status === 401) this.tokens.delete(credentials.cacheKey);

    const statusFailure = classifyRedditStatus(res.status, res.headers);
    if (statusFailure) {
      throw new RedditApiError({
        message: `reddit_http_${res.status}: ${truncate(res.body, 300)}`,
        kind: statusFailure.kind,
        status: res.status,
        retryAfterSeconds: statusFailure.retryAfterSeconds,
      });
    }

    const json = parseJson(res.body);
    const envelope = JsonEnvelopeSchema.safeParse(json);
    if (envelope.success) {
      const failure = classifyRedditJsonErrors(
        envelope.data.json.errors,
        envelope.data.json.ratelimit ?? null,
      );
      if (failure) {
        throw new RedditApiError({
          message: `reddit_${failure.code}: ${failure.detail || 'rejected by Reddit'}`,
          kind: failure.kind,
          status: res.status,
          code: failure.code,
          retryAfterSeconds: failure.retryAfterSeconds,
        });
      }
    }
    return { json, rateLimit };
  }

  private async accessToken(credentials: RedditCredentials): Promise<string> {
    const key = credentials.cacheKey;
    const cached = this.tokens.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.token;

    const basic = Buffer.from(`${credentials.clientId}:${credentials.clientSecret}`).toString(
      'base64',
    );
    const res = await this.transport({
      method: 'POST',
      url: REDDIT_TOKEN_URL,
      headers: {
        authorization: `Basic ${basic}`,
        'content-type': 'application/x-www-form-urlencoded',
        'user-agent': redditUserAgent(credentials.username),
        accept: 'application/json',
      },
      body: new URLSearchParams({
        grant_type: 'password',
        username: credentials.username,
        password: credentials.password,
      }).toString(),
    });
    if (res.status === 401 || res.status === 400) {
      throw new RedditApiError({
        message: 'reddit_auth_failed: Reddit rejected the script app credentials',
        kind: 'terminal',
        status: res.status,
      });
    }
    if (res.status === 429) {
      throw new RedditApiError({
        message: 'reddit_auth_ratelimited: too many token requests',
        kind: 'deferred',
        status: 429,
        retryAfterSeconds: deferralSecondsFromHeaders(res.headers),
      });
    }
    if (res.status >= 500) {
      throw new RedditApiError({
        message: `reddit_auth_unavailable_${res.status}`,
        kind: 'retry',
        status: res.status,
      });
    }
    const parsed = TokenResponseSchema.safeParse(parseJson(res.body));
    if (!parsed.success) {
      throw new RedditApiError({
        message: 'reddit_auth_failed: token response was not understood',
        kind: 'terminal',
        status: res.status,
      });
    }
    const lifetimeMs = Math.max((parsed.data.expires_in ?? 3600) * 1000, TOKEN_EXPIRY_SAFETY_MS * 2);
    this.tokens.set(key, {
      token: parsed.data.access_token,
      expiresAt: Date.now() + lifetimeMs - TOKEN_EXPIRY_SAFETY_MS,
    });
    return parsed.data.access_token;
  }

  private async transport(req: RedditHttpRequest): Promise<RedditHttpResponse> {
    try {
      return await this.http.request(req);
    } catch (err) {
      if (err instanceof RedditApiError) throw err;
      throw new RedditApiError({
        message: `reddit_transport_failed: ${err instanceof Error ? err.message : String(err)}`,
        kind: 'retry',
        status: 0,
      });
    }
  }
}

function collectComments(
  children: Array<{ kind: string; data: Record<string, unknown> }>,
  depth: number,
  maxDepth: number,
  limit: number,
  out: RedditThreadComment[],
): boolean {
  let more = false;
  for (const child of children) {
    if (out.length >= limit) return true;
    if (child.kind === 'more') {
      more = true;
      continue;
    }
    if (child.kind !== 't1') continue;
    const parsed = CommentDataSchema.safeParse(child.data);
    if (!parsed.success) continue;
    out.push({
      id: parsed.data.id,
      fullname: parsed.data.name ?? `t1_${parsed.data.id}`,
      author: parsed.data.author ?? null,
      body: parsed.data.body ?? '',
      score: parsed.data.score ?? null,
      createdUtc: parsed.data.created_utc ?? null,
      parentFullname: parsed.data.parent_id ?? null,
      depth,
    });
    if (depth >= maxDepth) {
      if (hasReplies(parsed.data.replies)) more = true;
      continue;
    }
    const nested = readNestedChildren(parsed.data.replies);
    if (nested.length > 0 && collectComments(nested, depth + 1, maxDepth, limit, out)) {
      more = true;
    }
  }
  return more;
}

function readNestedChildren(
  replies: unknown,
): Array<{ kind: string; data: Record<string, unknown> }> {
  const parsed = ListingSchema.safeParse(replies);
  return parsed.success ? parsed.data.data.children : [];
}

function hasReplies(replies: unknown): boolean {
  return readNestedChildren(replies).length > 0;
}

function toThreadSummary(data: z.infer<typeof PostDataSchema>): RedditThreadSummary {
  return {
    id: data.id,
    fullname: data.name ?? `t3_${data.id}`,
    title: data.title ?? '',
    author: data.author ?? null,
    subreddit: data.subreddit ?? null,
    permalink: data.permalink ?? null,
    url: data.url ?? null,
    score: data.score ?? null,
    upvoteRatio: data.upvote_ratio ?? null,
    numComments: data.num_comments ?? null,
    createdUtc: data.created_utc ?? null,
    selftext: data.selftext ?? '',
    flair: data.link_flair_text ?? null,
    over18: data.over_18 === true,
    locked: data.locked === true,
    archived: data.archived === true,
  };
}

export function stripFullnamePrefix(value: string): string {
  return value.replace(/^t\d_/, '');
}

export function stripSubredditPrefix(value: string): string {
  return value.replace(/^\/?r\//i, '').trim();
}

function deferralSecondsFromHeaders(headers: Record<string, string>): number {
  const reset = numericHeader(headers['x-ratelimit-reset']);
  if (reset !== null && reset > 0) return Math.ceil(reset);
  const retryAfter = numericHeader(headers['retry-after']);
  if (retryAfter !== null && retryAfter > 0) return Math.ceil(retryAfter);
  return DEFAULT_DEFERRAL_SECONDS;
}

function numericHeader(value: string | undefined): number | null {
  if (value === undefined) return null;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function emptyRateLimit(): RedditRateLimit {
  return { remaining: null, reset: null, used: null };
}

function parseJson(body: string): unknown {
  try {
    return JSON.parse(body) as unknown;
  } catch {
    return null;
  }
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(Math.trunc(value), min), max);
}
