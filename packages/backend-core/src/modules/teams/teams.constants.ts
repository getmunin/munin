import { readApiBaseUrl } from '@getmunin/core';
import { MIRRORED_CONVERSATION_EVENT_TYPES } from '../operator-bridge/bridge-events.ts';

export const TEAMS_MIRRORED_EVENT_TYPES: readonly string[] = MIRRORED_CONVERSATION_EVENT_TYPES;

export const BOT_FRAMEWORK_OPENID_URL =
  'https://login.botframework.com/v1/.well-known/openidconfiguration';
export const BOT_FRAMEWORK_ISSUER = 'https://api.botframework.com';
export const BOT_FRAMEWORK_SCOPE = 'https://api.botframework.com/.default';
export const TEAMS_CHANNEL_ID = 'msteams';

const ALLOWED_SERVICE_URL_HOSTS: readonly RegExp[] = [
  /^smba\.trafficmanager\.net$/,
  /^[a-z0-9-]+\.smba\.trafficmanager\.net$/,
  /^smba\.infra\.gcc\.teams\.microsoft\.com$/,
  /^smba\.infra\.gov\.teams\.microsoft\.us$/,
  /^smba\.infra\.dod\.teams\.microsoft\.us$/,
];

export function isAllowedServiceUrl(raw: unknown): raw is string {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 512) return false;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return false;
  return ALLOWED_SERVICE_URL_HOSTS.some((re) => re.test(url.hostname));
}

export function normalizeServiceUrl(raw: string): string {
  return raw.endsWith('/') ? raw : `${raw}/`;
}

export function teamsMessagingEndpoint(): string {
  return `${readApiBaseUrl()}/v1/teams/messages`;
}

export const TEAMS_VERB_CLAIM = 'munin_claim';
export const TEAMS_VERB_RELEASE = 'munin_release';
export const TEAMS_VERB_CLOSE = 'munin_close';
export const TEAMS_VERB_REOPEN = 'munin_reopen';

export const TEAMS_CONVERSATION_VERBS: readonly string[] = [
  TEAMS_VERB_CLAIM,
  TEAMS_VERB_RELEASE,
  TEAMS_VERB_CLOSE,
  TEAMS_VERB_REOPEN,
];

export const TEAMS_CREDENTIAL_TARGET = 'teams_bot';

export function threadConversationId(channelId: string, rootActivityId: string): string {
  return `${channelId};messageid=${rootActivityId}`;
}

export function parseThreadConversationId(
  conversationId: string,
): { channelId: string; rootActivityId: string | null } {
  const marker = ';messageid=';
  const at = conversationId.indexOf(marker);
  if (at < 0) return { channelId: conversationId, rootActivityId: null };
  const rootActivityId = conversationId.slice(at + marker.length);
  return {
    channelId: conversationId.slice(0, at),
    rootActivityId: rootActivityId.length > 0 ? rootActivityId : null,
  };
}
