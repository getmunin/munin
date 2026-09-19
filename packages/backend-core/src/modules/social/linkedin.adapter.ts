import { Injectable } from '@nestjs/common';
import {
  SocialGrantRevokedError,
  type SocialAccountIdentity,
  type SocialMediaRef,
  type SocialMediaUpload,
  type SocialOAuthAdapter,
  type SocialOAuthClient,
  type SocialPublishRequest,
  type SocialPublishResult,
  type SocialTokenSet,
} from './social-oauth.ts';
import type { SocialPlatform } from './social-platform.ts';

const AUTHORIZE_ENDPOINT = 'https://www.linkedin.com/oauth/v2/authorization';
const TOKEN_ENDPOINT = 'https://www.linkedin.com/oauth/v2/accessToken';
const USERINFO_ENDPOINT = 'https://api.linkedin.com/v2/userinfo';
const POSTS_ENDPOINT = 'https://api.linkedin.com/rest/posts';
const IMAGES_ENDPOINT = 'https://api.linkedin.com/rest/images';
const VIDEOS_ENDPOINT = 'https://api.linkedin.com/rest/videos';
const SOCIAL_ACTIONS_ENDPOINT = 'https://api.linkedin.com/rest/socialActions';
const LEGACY_SOCIAL_ACTIONS_ENDPOINT = 'https://api.linkedin.com/v2/socialActions';
const DEFAULT_API_VERSION = '202609';

export const LINKEDIN_SCOPES = ['openid', 'profile', 'w_member_social'] as const;

const COMMENTARY_RESERVED = /[\\|{}@[\]()<>#*_~]/g;

export function apiVersion(): string {
  const configured = process.env.MUNIN_LINKEDIN_API_VERSION;
  return configured && /^\d{6}$/.test(configured) ? configured : DEFAULT_API_VERSION;
}

export function escapeCommentary(text: string): string {
  return text.replace(COMMENTARY_RESERVED, (char) => `\\${char}`);
}

export function composeCommentary(body: string, linkUrl: string | null): string {
  const escaped = escapeCommentary(body);
  if (!linkUrl || body.includes(linkUrl)) return escaped;
  return `${escaped}\n\n${escapeCommentary(linkUrl)}`;
}

export function composeCommentText(linkUrl: string, commentText: string | null): string {
  const trimmed = commentText?.trim() ?? '';
  if (!trimmed) return linkUrl;
  if (trimmed.includes(linkUrl)) return trimmed;
  return `${trimmed}\n\n${linkUrl}`;
}

export function commentRouteExhausted(status: number): boolean {
  return status !== 403 && status !== 404 && status !== 426;
}

export function readCommentId(body: unknown, header: string | null): string | null {
  if (body && typeof body === 'object') {
    const id = (body as { id?: unknown }).id;
    if (typeof id === 'string' && id.length > 0) return id;
  }
  return header && header.length > 0 ? header : null;
}

export function readUploadValue(body: unknown, field: 'image' | 'video'): Record<string, unknown> {
  const value = (body as { value?: unknown } | null)?.value;
  if (!value || typeof value !== 'object') {
    throw new Error('LinkedIn returned no upload details');
  }
  const urn = (value as Record<string, unknown>)[field];
  if (typeof urn !== 'string' || urn.length === 0) {
    throw new Error(`LinkedIn returned no ${field} urn`);
  }
  return value as Record<string, unknown>;
}

export interface VideoUploadPart {
  firstByte: number;
  lastByte: number;
  uploadUrl: string;
}

export function readUploadInstructions(value: Record<string, unknown>): VideoUploadPart[] {
  const raw = value.uploadInstructions;
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error('LinkedIn returned no video upload instructions');
  }
  return raw.map((entry) => {
    const part = entry as Partial<VideoUploadPart>;
    if (
      typeof part.uploadUrl !== 'string' ||
      typeof part.firstByte !== 'number' ||
      typeof part.lastByte !== 'number'
    ) {
      throw new Error('LinkedIn returned a malformed video upload instruction');
    }
    return { firstByte: part.firstByte, lastByte: part.lastByte, uploadUrl: part.uploadUrl };
  });
}

export function permalinkFor(externalPostId: string): string | null {
  if (!/^urn:li:[a-zA-Z]+:\d+$/.test(externalPostId)) return null;
  return `https://www.linkedin.com/feed/update/${externalPostId}/`;
}

interface TokenResponse {
  access_token?: unknown;
  expires_in?: unknown;
  refresh_token?: unknown;
  refresh_token_expires_in?: unknown;
  scope?: unknown;
}

interface UserInfoResponse {
  sub?: unknown;
  name?: unknown;
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function readTokenResponse(body: unknown): SocialTokenSet {
  if (!body || typeof body !== 'object') {
    throw new Error('LinkedIn returned a token response that was not an object');
  }
  const token = body as TokenResponse;
  if (typeof token.access_token !== 'string' || token.access_token.length === 0) {
    throw new Error('LinkedIn returned no access token');
  }
  const scope = typeof token.scope === 'string' ? token.scope : '';
  return {
    accessToken: token.access_token,
    expiresInSeconds: numberOrUndefined(token.expires_in),
    refreshToken: typeof token.refresh_token === 'string' ? token.refresh_token : undefined,
    refreshTokenExpiresInSeconds: numberOrUndefined(token.refresh_token_expires_in),
    scopes: scope.length > 0 ? scope.split(/[\s,]+/).filter((s) => s.length > 0) : undefined,
  };
}

export function isRevokedTokenError(status: number, body: string): boolean {
  if (status !== 400 && status !== 401) return false;
  return /invalid_grant|invalid_request|revoked|expired/i.test(body);
}

@Injectable()
export class LinkedInAdapter implements SocialOAuthAdapter {
  readonly platform: SocialPlatform = 'linkedin';
  readonly displayName = 'LinkedIn';
  readonly authorizationScopes = LINKEDIN_SCOPES;

  authorizeUrl(args: { state: string; redirectUri: string; clientId: string }): string {
    const url = new URL(AUTHORIZE_ENDPOINT);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', args.clientId);
    url.searchParams.set('redirect_uri', args.redirectUri);
    url.searchParams.set('state', args.state);
    url.searchParams.set('scope', this.authorizationScopes.join(' '));
    return url.toString();
  }

  async exchangeCode(args: {
    code: string;
    redirectUri: string;
    client: SocialOAuthClient;
  }): Promise<SocialTokenSet> {
    return this.postToken(
      new URLSearchParams({
        grant_type: 'authorization_code',
        code: args.code,
        redirect_uri: args.redirectUri,
        client_id: args.client.clientId,
        client_secret: args.client.clientSecret,
      }),
    );
  }

  async refresh(args: {
    refreshToken: string;
    client: SocialOAuthClient;
  }): Promise<SocialTokenSet> {
    return this.postToken(
      new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: args.refreshToken,
        client_id: args.client.clientId,
        client_secret: args.client.clientSecret,
      }),
    );
  }

  async identify(args: { accessToken: string }): Promise<SocialAccountIdentity> {
    const res = await fetch(USERINFO_ENDPOINT, {
      headers: { authorization: `Bearer ${args.accessToken}` },
    });
    const text = await res.text();
    if (!res.ok) {
      if (isRevokedTokenError(res.status, text)) throw new SocialGrantRevokedError(text.slice(0, 200));
      throw new Error(`LinkedIn rejected the profile lookup (${res.status})`);
    }
    const body = JSON.parse(text) as UserInfoResponse;
    if (typeof body.sub !== 'string' || body.sub.length === 0) {
      throw new Error('LinkedIn returned no member id');
    }
    return {
      externalAccountId: body.sub,
      displayName: typeof body.name === 'string' && body.name.length > 0 ? body.name : null,
    };
  }

  async publish(args: SocialPublishRequest): Promise<SocialPublishResult> {
    const author = `urn:li:person:${args.externalAccountId}`;
    const bodyLink = args.linkPlacement === 'body' ? args.linkUrl : null;
    const res = await fetch(POSTS_ENDPOINT, {
      method: 'POST',
      headers: {
        ...this.restHeaders(args.accessToken),
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        author,
        commentary: composeCommentary(args.body, bodyLink),
        visibility: 'PUBLIC',
        distribution: {
          feedDistribution: 'MAIN_FEED',
          targetEntities: [],
          thirdPartyDistributionChannels: [],
        },
        ...(args.media
          ? {
              content: {
                media: {
                  id: args.media.id,
                  ...(args.media.altText ? { altText: args.media.altText } : {}),
                },
              },
            }
          : {}),
        lifecycleState: 'PUBLISHED',
        isReshareDisabledByAuthor: false,
      }),
    });
    const text = await res.text();
    if (!res.ok) {
      if (isRevokedTokenError(res.status, text)) throw new SocialGrantRevokedError(text.slice(0, 200));
      throw new Error(`LinkedIn refused the post (${res.status}): ${text.slice(0, 200)}`);
    }
    const externalPostId = res.headers.get('x-restli-id');
    if (!externalPostId) {
      throw new Error('LinkedIn accepted the post but returned no post id');
    }

    let commentExternalId: string | null = null;
    let commentError: string | null = null;
    if (args.linkPlacement === 'comment' && args.linkUrl) {
      try {
        commentExternalId = await this.comment({
          accessToken: args.accessToken,
          author,
          postUrn: externalPostId,
          text: composeCommentText(args.linkUrl, args.linkCommentText),
        });
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
    const owner = `urn:li:person:${args.externalAccountId}`;
    const id =
      args.media.kind === 'image'
        ? await this.uploadImage(args.accessToken, owner, args.media)
        : await this.uploadVideo(args.accessToken, owner, args.media);
    return { kind: args.media.kind, id, altText: args.media.altText };
  }

  private async uploadImage(
    accessToken: string,
    owner: string,
    media: SocialMediaUpload,
  ): Promise<string> {
    const value = readUploadValue(
      await this.action(accessToken, IMAGES_ENDPOINT, 'initializeUpload', {
        initializeUploadRequest: { owner },
      }),
      'image',
    );
    await this.putBytes(accessToken, String(value.uploadUrl), media.bytes);
    return String(value.image);
  }

  private async uploadVideo(
    accessToken: string,
    owner: string,
    media: SocialMediaUpload,
  ): Promise<string> {
    const value = readUploadValue(
      await this.action(accessToken, VIDEOS_ENDPOINT, 'initializeUpload', {
        initializeUploadRequest: { owner, fileSizeBytes: media.bytes.length },
      }),
      'video',
    );
    const video = String(value.video);
    const uploadedPartIds: string[] = [];
    for (const part of readUploadInstructions(value)) {
      const chunk = media.bytes.subarray(
        part.firstByte,
        Math.min(part.lastByte + 1, media.bytes.length),
      );
      const etag = await this.putBytes(accessToken, part.uploadUrl, chunk);
      if (!etag) {
        throw new Error('LinkedIn accepted a video part but returned no ETag');
      }
      uploadedPartIds.push(etag.replaceAll('"', ''));
    }
    await this.action(accessToken, VIDEOS_ENDPOINT, 'finalizeUpload', {
      finalizeUploadRequest: {
        video,
        uploadToken: typeof value.uploadToken === 'string' ? value.uploadToken : '',
        uploadedPartIds,
      },
    });
    return video;
  }

  private async comment(args: {
    accessToken: string;
    author: string;
    postUrn: string;
    text: string;
  }): Promise<string | null> {
    const payload = JSON.stringify({
      actor: args.author,
      object: args.postUrn,
      message: { text: args.text },
    });
    const path = `/${encodeURIComponent(args.postUrn)}/comments`;

    const versioned = await this.postComment(
      `${SOCIAL_ACTIONS_ENDPOINT}${path}`,
      this.restHeaders(args.accessToken),
      payload,
    );
    if (versioned.ok) return versioned.id;
    if (commentRouteExhausted(versioned.status)) {
      throw new Error(`LinkedIn refused the comment (${versioned.status}): ${versioned.detail}`);
    }

    const legacy = await this.postComment(
      `${LEGACY_SOCIAL_ACTIONS_ENDPOINT}${path}`,
      { authorization: `Bearer ${args.accessToken}` },
      payload,
    );
    if (legacy.ok) return legacy.id;
    throw new Error(
      `LinkedIn refused the comment (${versioned.status} versioned, ${legacy.status} legacy): ${legacy.detail}`,
    );
  }

  private async postComment(
    url: string,
    headers: Record<string, string>,
    payload: string,
  ): Promise<{ ok: true; id: string | null } | { ok: false; status: number; detail: string }> {
    const res = await fetch(url, {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: payload,
    });
    const text = await res.text();
    if (!res.ok) return { ok: false, status: res.status, detail: text.slice(0, 200) };
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
    return { ok: true, id: readCommentId(parsed, res.headers.get('x-restli-id')) };
  }

  private restHeaders(accessToken: string): Record<string, string> {
    return {
      authorization: `Bearer ${accessToken}`,
      'linkedin-version': apiVersion(),
      'x-restli-protocol-version': '2.0.0',
    };
  }

  private async action(
    accessToken: string,
    endpoint: string,
    action: string,
    body: Record<string, unknown>,
  ): Promise<unknown> {
    const res = await fetch(`${endpoint}?action=${action}`, {
      method: 'POST',
      headers: { ...this.restHeaders(accessToken), 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) {
      if (isRevokedTokenError(res.status, text)) throw new SocialGrantRevokedError(text.slice(0, 200));
      throw new Error(`LinkedIn refused ${action} (${res.status}): ${text.slice(0, 200)}`);
    }
    if (!text) return null;
    return JSON.parse(text);
  }

  private async putBytes(
    accessToken: string,
    uploadUrl: string,
    bytes: Buffer,
  ): Promise<string | null> {
    const res = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        authorization: `Bearer ${accessToken}`,
        'content-type': 'application/octet-stream',
      },
      body: new Uint8Array(bytes),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`LinkedIn refused the upload (${res.status}): ${text.slice(0, 200)}`);
    }
    return res.headers.get('etag');
  }

  private async postToken(params: URLSearchParams): Promise<SocialTokenSet> {
    const res = await fetch(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });
    const text = await res.text();
    if (!res.ok) {
      if (isRevokedTokenError(res.status, text)) throw new SocialGrantRevokedError(text.slice(0, 200));
      throw new Error(`LinkedIn rejected the token request (${res.status})`);
    }
    return readTokenResponse(JSON.parse(text));
  }
}
