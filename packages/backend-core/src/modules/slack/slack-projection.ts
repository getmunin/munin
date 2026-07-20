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

export interface MessageSnapshot {
  authorKind: AuthorKind;
  authorName: string | null;
  internal: boolean;
  body: string;
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
  if (msg.internal) return `:lock: _Internal note_ — ${label}\n${quoted}`;
  return `${label}\n${quoted}`;
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

export function testMessageText(orgName: string | null): string {
  const scope = orgName ? ` for *${escapeSlackText(orgName)}*` : '';
  return `:wave: Munin is connected${scope}. New conversations will mirror into this channel as threads.`;
}
