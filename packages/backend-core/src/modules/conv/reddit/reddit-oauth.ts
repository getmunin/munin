import { signHmac, verifyHmac } from '@getmunin/core';
import { authorizationServerUrl } from '../../../oauth/oauth.constants.ts';

export const REDDIT_AUTHORIZE_URL = 'https://www.reddit.com/api/v1/authorize';

export const REDDIT_OAUTH_SCOPES = ['identity', 'read', 'submit', 'privatemessages'] as const;

export const REDDIT_CONNECT_STATE_TTL_MS = 10 * 60 * 1000;

export interface RedditConnectState {
  orgId: string;
  channelId: string;
  exp: number;
}

export function redditOAuthRedirectUri(): string {
  return `${authorizationServerUrl()}/v1/conversations/channels/reddit/oauth/callback`;
}

export function signRedditConnectState(state: RedditConnectState, secret: string): string {
  const payload = Buffer.from(JSON.stringify(state)).toString('base64url');
  return `${payload}.${signHmac(payload, secret)}`;
}

export function verifyRedditConnectState(raw: unknown, secret: string): RedditConnectState | null {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 4096) return null;
  const dot = raw.lastIndexOf('.');
  if (dot <= 0) return null;
  const payload = raw.slice(0, dot);
  if (!verifyHmac(payload, secret, raw.slice(dot + 1))) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  const state = parsed as Partial<RedditConnectState>;
  if (typeof state.orgId !== 'string' || state.orgId.length === 0) return null;
  if (typeof state.channelId !== 'string' || state.channelId.length === 0) return null;
  if (typeof state.exp !== 'number' || state.exp < Date.now()) return null;
  return { orgId: state.orgId, channelId: state.channelId, exp: state.exp };
}

export function buildRedditAuthorizeUrl(input: { clientId: string; state: string }): string {
  const url = new URL(REDDIT_AUTHORIZE_URL);
  url.searchParams.set('client_id', input.clientId);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('state', input.state);
  url.searchParams.set('redirect_uri', redditOAuthRedirectUri());
  url.searchParams.set('duration', 'permanent');
  url.searchParams.set('scope', REDDIT_OAUTH_SCOPES.join(' '));
  return url.toString();
}
