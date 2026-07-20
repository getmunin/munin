/**
 * Provider-neutral projection of conversation events into operator-surface
 * message text. Kept free of Slack API and DB concerns so a future bridge
 * (Teams, …) can lift this layer and only swap the rendering/transport —
 * the mrkdwn dialect is the one Slack-specific ingredient.
 */

export type AuthorKind = 'user' | 'agent' | 'end_user' | 'system';

export interface ConversationSnapshot {
  displayId: number;
  subject: string | null;
  channelType: string;
  channelName: string | null;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  dashboardUrl: string;
}

export interface MessageAttachment {
  name: string | null;
  url: string | null;
}

export interface MessageSnapshot {
  authorKind: AuthorKind;
  authorName: string | null;
  internal: boolean;
  body: string;
  attachments?: MessageAttachment[];
}

/**
 * conv_messages.attachments is loosely-typed jsonb; read `{url, name}`-shaped
 * entries best-effort and ignore the rest rather than assuming a schema.
 */
export function parseMessageAttachments(raw: unknown[]): MessageAttachment[] {
  return raw.flatMap((entry) => {
    if (typeof entry !== 'object' || entry === null) return [];
    const record = entry as Record<string, unknown>;
    const url = typeof record.url === 'string' ? record.url : null;
    const name =
      typeof record.name === 'string'
        ? record.name
        : typeof record.filename === 'string'
          ? record.filename
          : null;
    return url || name ? [{ name, url }] : [];
  });
}

const MAX_BODY_CHARS = 2900;

export function escapeSlackText(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function truncate(text: string, max = MAX_BODY_CHARS): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}… _(truncated)_`;
}

export function authorLabel(kind: AuthorKind, name: string | null): string {
  switch (kind) {
    case 'end_user':
      return `:bust_in_silhouette: *${escapeSlackText(name ?? 'Customer')}* (customer)`;
    case 'agent':
      return ':robot_face: *AI agent*';
    case 'user':
      return `:technologist: *${escapeSlackText(name ?? 'Teammate')}* (teammate)`;
    case 'system':
      return ':gear: *System*';
  }
}

function contactLine(conv: ConversationSnapshot): string | null {
  const reachable = conv.contactEmail ?? conv.contactPhone;
  if (!conv.contactName && !reachable) return null;
  const name = conv.contactName ?? reachable!;
  const detail = conv.contactName && reachable ? ` (${escapeSlackText(reachable)})` : '';
  return `*From:* ${escapeSlackText(name)}${detail}`;
}

function sourceLabel(conv: ConversationSnapshot): string {
  const channel = conv.channelName ? ` (${escapeSlackText(conv.channelName)})` : '';
  return `${escapeSlackText(conv.channelType)}${channel}`;
}

export function threadParentText(conv: ConversationSnapshot): string {
  const lines = [
    `:speech_balloon: *New conversation #${conv.displayId}* — via ${sourceLabel(conv)}`,
  ];
  const contact = contactLine(conv);
  if (contact) lines.push(contact);
  if (conv.subject) lines.push(`*Subject:* ${escapeSlackText(conv.subject)}`);
  lines.push(`<${conv.dashboardUrl}|Open in Munin>`);
  return lines.join('\n');
}

export function messageText(msg: MessageSnapshot): string {
  const quoted = truncate(escapeSlackText(msg.body))
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n');
  const label = authorLabel(msg.authorKind, msg.authorName);
  const attachmentLines = (msg.attachments ?? []).map((a) => {
    const name = escapeSlackText(a.name ?? 'attachment');
    return a.url ? `:paperclip: <${a.url}|${name}>` : `:paperclip: ${name}`;
  });
  const suffix = attachmentLines.length > 0 ? `\n${attachmentLines.join('\n')}` : '';
  if (msg.internal) return `:lock: _Internal note_ — ${label}\n${quoted}${suffix}`;
  return `${label}\n${quoted}${suffix}`;
}

export function statusChangedText(status: string): string {
  const emoji: Record<string, string> = {
    open: ':leftwards_arrow_with_hook:',
    snoozed: ':zzz:',
    closed: ':white_check_mark:',
    spam: ':no_entry_sign:',
  };
  return `${emoji[status] ?? ':information_source:'} Status changed to *${escapeSlackText(status)}*`;
}

export function assignedText(assigneeName: string | null): string {
  if (!assigneeName) return ':bust_in_silhouette: Unassigned';
  return `:bust_in_silhouette: Assigned to *${escapeSlackText(assigneeName)}*`;
}

export function takenOverText(holderName: string): string {
  return `:raised_hand: Claimed by *${escapeSlackText(holderName)}*`;
}

export function releasedText(holderName: string): string {
  return `:door: Released by *${escapeSlackText(holderName)}*`;
}

export function handoverRequestedText(reason: string | null): string {
  const suffix = reason ? ` — ${escapeSlackText(reason)}` : '';
  return `:rotating_light: *Human attention requested*${suffix}`;
}

export function handoverResolvedText(): string {
  return ':handshake: Handover resolved — a human replied';
}

export function escalationAlertText(
  conv: ConversationSnapshot,
  reason: string | null,
  mention: string | null,
): string {
  const lines = [
    `:rotating_light: ${mention ? `${mention} ` : ''}*Human attention needed* — conversation #${conv.displayId} via ${sourceLabel(conv)}`,
  ];
  if (reason) lines.push(`*Reason:* ${escapeSlackText(reason)}`);
  const contact = contactLine(conv);
  if (contact) lines.push(contact);
  lines.push(`<${conv.dashboardUrl}|Open in Munin>`);
  return lines.join('\n');
}

export interface ParentState {
  status: string;
  needsHumanAttention: boolean;
  claimedBy: string | null;
  assignedTo: string | null;
}

export interface SlackBlock {
  type: string;
  [key: string]: unknown;
}

export const CLAIM_ACTION_ID = 'munin_claim';
export const CLOSE_ACTION_ID = 'munin_close';
export const REOPEN_ACTION_ID = 'munin_reopen';

export function parentStateLine(state: ParentState): string {
  const parts = [`*Status:* ${escapeSlackText(state.status)}`];
  if (state.claimedBy) parts.push(`claimed by *${escapeSlackText(state.claimedBy)}*`);
  if (state.assignedTo) parts.push(`assigned to *${escapeSlackText(state.assignedTo)}*`);
  if (state.needsHumanAttention) parts.push(':rotating_light: needs attention');
  return parts.join(' · ');
}

function actionButton(actionId: string, label: string, value: string): Record<string, unknown> {
  return {
    type: 'button',
    action_id: actionId,
    text: { type: 'plain_text', text: label },
    value,
  };
}

export function threadParentBlocks(
  conv: ConversationSnapshot,
  state: ParentState,
  conversationId: string,
): SlackBlock[] {
  const resolved = state.status === 'closed' || state.status === 'spam';
  const buttons = resolved
    ? [actionButton(REOPEN_ACTION_ID, 'Reopen', conversationId)]
    : [
        actionButton(CLAIM_ACTION_ID, 'Claim', conversationId),
        actionButton(CLOSE_ACTION_ID, 'Close', conversationId),
      ];
  return [
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `${threadParentText(conv)}\n${parentStateLine(state)}` },
    },
    { type: 'actions', elements: buttons },
  ];
}

export function testMessageText(orgName: string | null): string {
  const scope = orgName ? ` for *${escapeSlackText(orgName)}*` : '';
  return `:wave: Munin is connected${scope}. New conversations will mirror into this channel as threads.`;
}
