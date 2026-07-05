export const SLACK_MIRRORED_EVENT_TYPES: readonly string[] = [
  'conversation.created',
  'conversation.message.received',
  'conversation.message.sent',
  'conversation.status_changed',
  'conversation.assigned',
  'conversation.released',
  'conversation.taken_over',
  'conversation.handover_requested',
  'conversation.handover_resolved',
];

export const SLACK_BOT_SCOPES = [
  'chat:write',
  'channels:read',
  'channels:history',
  'users:read',
  'users:read.email',
] as const;

export interface SlackAppConfig {
  clientId: string;
  clientSecret: string;
}

/**
 * The Slack app itself is deployment-level: cloud ships one app, self-hosters
 * register their own from the manifest in skill://slack/connect-slack and set
 * these env vars. Returns null when the deployment has no Slack app.
 */
export function readSlackAppConfig(): SlackAppConfig | null {
  const clientId = process.env.SLACK_CLIENT_ID;
  const clientSecret = process.env.SLACK_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

export function readSlackSigningSecret(): string | null {
  return process.env.SLACK_SIGNING_SECRET || null;
}

export function readWebBaseUrl(): string {
  return (process.env.MUNIN_WEB_URL ?? 'http://localhost:3000').replace(/\/+$/, '');
}
