import { Injectable } from '@nestjs/common';
import {
  SocialGrantRevokedError,
  type SocialAccountIdentity,
  type SocialOAuthAdapter,
  type SocialOAuthClient,
  type SocialTokenSet,
} from './social-oauth.ts';
import type { SocialPlatform } from './social-platform.ts';

const AUTHORIZE_ENDPOINT = 'https://www.linkedin.com/oauth/v2/authorization';
const TOKEN_ENDPOINT = 'https://www.linkedin.com/oauth/v2/accessToken';
const USERINFO_ENDPOINT = 'https://api.linkedin.com/v2/userinfo';

export const LINKEDIN_SCOPES = ['openid', 'profile', 'w_member_social'] as const;

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
