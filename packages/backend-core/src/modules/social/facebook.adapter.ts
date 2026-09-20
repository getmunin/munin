import { Injectable } from '@nestjs/common';
import {
  SocialGrantRevokedError,
  type SocialAuthorTarget,
  type SocialMediaRef,
  type SocialMediaUpload,
  type SocialOAuthAdapter,
  type SocialOAuthClient,
  type SocialPublishRequest,
  type SocialPublishResult,
  type SocialTokenSet,
} from './social-oauth.ts';
import type { SocialAuthorKind, SocialPlatform } from './social-platform.ts';

const DEFAULT_API_VERSION = 'v23.0';
const DIALOG_HOST = 'https://www.facebook.com';
const GRAPH_HOST = 'https://graph.facebook.com';
const PAGE_LIST_PAGES_MAX = 5;
const PUBLISH_TASK = 'CREATE_CONTENT';

export const FACEBOOK_SCOPES = [
  'pages_show_list',
  'pages_manage_posts',
  'pages_manage_engagement',
  'pages_read_engagement',
] as const;

export function apiVersion(): string {
  const configured = process.env.MUNIN_FACEBOOK_API_VERSION;
  return configured && /^v\d+\.\d+$/.test(configured) ? configured : DEFAULT_API_VERSION;
}

export function graphUrl(path: string): string {
  return `${GRAPH_HOST}/${apiVersion()}${path}`;
}

interface GraphError {
  message?: unknown;
  type?: unknown;
  code?: unknown;
  error_subcode?: unknown;
}

export function readGraphError(body: string): GraphError | null {
  try {
    const parsed = JSON.parse(body) as { error?: unknown };
    const error = parsed.error;
    if (!error || typeof error !== 'object') return null;
    return error;
  } catch {
    return null;
  }
}

export function graphErrorDetail(body: string): string {
  const error = readGraphError(body);
  const message = error && typeof error.message === 'string' ? error.message : body;
  return message.slice(0, 200);
}

export function isRevokedTokenError(body: string): boolean {
  const error = readGraphError(body);
  if (!error) return false;
  if (error.type === 'OAuthException') return true;
  return error.code === 190 || error.code === 102;
}

export function composeMessage(body: string, linkUrl: string | null): string {
  if (!linkUrl || body.includes(linkUrl)) return body;
  return `${body}\n\n${linkUrl}`;
}

export function composeCommentText(linkUrl: string, commentText: string | null): string {
  const trimmed = commentText?.trim() ?? '';
  if (!trimmed) return linkUrl;
  if (trimmed.includes(linkUrl)) return trimmed;
  return `${trimmed}\n\n${linkUrl}`;
}

export function permalinkFor(externalPostId: string): string | null {
  const [pageId, postId] = externalPostId.split('_');
  if (!pageId || !postId || !/^\d+$/.test(pageId) || !/^\d+$/.test(postId)) return null;
  return `https://www.facebook.com/${pageId}/posts/${postId}`;
}

interface PageEntry {
  id?: unknown;
  name?: unknown;
  access_token?: unknown;
  tasks?: unknown;
}

export function readPageEntries(body: unknown): {
  targets: SocialAuthorTarget[];
  next: string | null;
} {
  const page = body as { data?: unknown; paging?: { next?: unknown } } | null;
  const data = page?.data;
  if (!Array.isArray(data)) {
    throw new Error('Facebook returned no Page list');
  }
  const targets: SocialAuthorTarget[] = [];
  for (const raw of data) {
    const entry = raw as PageEntry;
    if (typeof entry.id !== 'string' || typeof entry.access_token !== 'string') continue;
    const tasks = Array.isArray(entry.tasks) ? entry.tasks : [];
    if (!tasks.includes(PUBLISH_TASK)) continue;
    targets.push({
      externalAccountId: entry.id,
      displayName: typeof entry.name === 'string' && entry.name.length > 0 ? entry.name : null,
      accessToken: entry.access_token,
    });
  }
  const next = page?.paging?.next;
  return { targets, next: typeof next === 'string' && next.length > 0 ? next : null };
}

export function readTokenResponse(body: unknown): SocialTokenSet {
  if (!body || typeof body !== 'object') {
    throw new Error('Facebook returned a token response that was not an object');
  }
  const token = body as { access_token?: unknown; expires_in?: unknown };
  if (typeof token.access_token !== 'string' || token.access_token.length === 0) {
    throw new Error('Facebook returned no access token');
  }
  return {
    accessToken: token.access_token,
    expiresInSeconds:
      typeof token.expires_in === 'number' && Number.isFinite(token.expires_in)
        ? token.expires_in
        : undefined,
  };
}

export function readPostId(body: unknown): string {
  const id = (body as { id?: unknown } | null)?.id;
  if (typeof id !== 'string' || id.length === 0) {
    throw new Error('Facebook accepted the post but returned no post id');
  }
  return id;
}

@Injectable()
export class FacebookAdapter implements SocialOAuthAdapter {
  readonly platform: SocialPlatform = 'facebook';
  readonly displayName = 'Facebook';
  readonly authorizationScopes = FACEBOOK_SCOPES;
  readonly authorKind: SocialAuthorKind = 'org_page';
  readonly accessTokenNeverExpires = true;

  authorizeUrl(args: { state: string; redirectUri: string; clientId: string }): string {
    const url = new URL(`${DIALOG_HOST}/${apiVersion()}/dialog/oauth`);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', args.clientId);
    url.searchParams.set('redirect_uri', args.redirectUri);
    url.searchParams.set('state', args.state);
    url.searchParams.set('scope', this.authorizationScopes.join(','));
    return url.toString();
  }

  async exchangeCode(args: {
    code: string;
    redirectUri: string;
    client: SocialOAuthClient;
  }): Promise<SocialTokenSet> {
    const shortLived = await this.getToken({
      client_id: args.client.clientId,
      client_secret: args.client.clientSecret,
      redirect_uri: args.redirectUri,
      code: args.code,
    });
    return this.getToken({
      grant_type: 'fb_exchange_token',
      client_id: args.client.clientId,
      client_secret: args.client.clientSecret,
      fb_exchange_token: shortLived.accessToken,
    });
  }

  refresh(): Promise<SocialTokenSet> {
    return Promise.reject(
      new SocialGrantRevokedError(
        'a Page access token cannot be renewed without the person authorizing again',
      ),
    );
  }

  async listTargets(args: { accessToken: string }): Promise<SocialAuthorTarget[]> {
    const first = new URL(graphUrl('/me/accounts'));
    first.searchParams.set('fields', 'id,name,access_token,tasks');
    first.searchParams.set('limit', '100');

    const targets: SocialAuthorTarget[] = [];
    let url: string | null = first.toString();
    for (let page = 0; url && page < PAGE_LIST_PAGES_MAX; page += 1) {
      const body: unknown = await this.get(url, args.accessToken);
      const read = readPageEntries(body);
      targets.push(...read.targets);
      url = read.next;
    }
    return targets;
  }

  async publish(args: SocialPublishRequest): Promise<SocialPublishResult> {
    const bodyLink = args.linkPlacement === 'body' ? args.linkUrl : null;
    const params: Record<string, string> = {
      message: composeMessage(args.body, args.media ? bodyLink : null),
    };
    if (args.media) {
      params['attached_media'] = JSON.stringify([{ media_fbid: args.media.id }]);
    } else if (bodyLink) {
      params['link'] = bodyLink;
    }

    const externalPostId = readPostId(
      await this.post(graphUrl(`/${args.externalAccountId}/feed`), args.accessToken, params),
    );

    let commentExternalId: string | null = null;
    let commentError: string | null = null;
    if (args.linkPlacement === 'comment' && args.linkUrl) {
      try {
        const comment = await this.post(
          graphUrl(`/${externalPostId}/comments`),
          args.accessToken,
          { message: composeCommentText(args.linkUrl, args.linkCommentText) },
        );
        commentExternalId = readPostId(comment);
      } catch (err) {
        commentError = err instanceof Error ? err.message : 'the comment was refused';
      }
    }

    return {
      externalPostId,
      permalink: permalinkFor(externalPostId),
      commentExternalId,
      commentError,
    };
  }

  async uploadMedia(args: {
    accessToken: string;
    externalAccountId: string;
    media: SocialMediaUpload;
  }): Promise<SocialMediaRef> {
    if (args.media.kind !== 'image') {
      throw new Error('Facebook posts take an image, not a video');
    }
    const form = new FormData();
    form.set('published', 'false');
    form.set('access_token', args.accessToken);
    if (args.media.altText) form.set('alt_text_custom', args.media.altText);
    form.set(
      'source',
      new Blob([new Uint8Array(args.media.bytes)], { type: args.media.contentType }),
      'upload',
    );

    const res = await fetch(graphUrl(`/${args.externalAccountId}/photos`), {
      method: 'POST',
      body: form,
    });
    const text = await res.text();
    if (!res.ok) {
      if (isRevokedTokenError(text)) throw new SocialGrantRevokedError(graphErrorDetail(text));
      throw new Error(`Facebook refused the photo upload (${res.status}): ${graphErrorDetail(text)}`);
    }
    return { kind: 'image', id: readPostId(JSON.parse(text)), altText: args.media.altText };
  }

  private async getToken(params: Record<string, string>): Promise<SocialTokenSet> {
    const url = new URL(graphUrl('/oauth/access_token'));
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    const res = await fetch(url, { headers: { accept: 'application/json' } });
    const text = await res.text();
    if (!res.ok) {
      if (isRevokedTokenError(text)) throw new SocialGrantRevokedError(graphErrorDetail(text));
      throw new Error(`Facebook rejected the token request (${res.status})`);
    }
    return readTokenResponse(JSON.parse(text));
  }

  private async get(url: string, accessToken: string): Promise<unknown> {
    const res = await fetch(url, {
      headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json' },
    });
    const text = await res.text();
    if (!res.ok) {
      if (isRevokedTokenError(text)) throw new SocialGrantRevokedError(graphErrorDetail(text));
      throw new Error(`Facebook rejected the read (${res.status}): ${graphErrorDetail(text)}`);
    }
    return JSON.parse(text);
  }

  private async post(
    url: string,
    accessToken: string,
    params: Record<string, string>,
  ): Promise<unknown> {
    const form = new URLSearchParams(params);
    form.set('access_token', accessToken);
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: form.toString(),
    });
    const text = await res.text();
    if (!res.ok) {
      if (isRevokedTokenError(text)) throw new SocialGrantRevokedError(graphErrorDetail(text));
      throw new Error(`Facebook refused the post (${res.status}): ${graphErrorDetail(text)}`);
    }
    return JSON.parse(text);
  }
}
