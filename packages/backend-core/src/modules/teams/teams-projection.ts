import type {
  AuthorKind,
  ConversationSnapshot,
  MessageSnapshot,
  ParentState,
} from '../operator-bridge/bridge-snapshot.ts';
import type { TeamsActivity } from './teams-api.client.ts';
import {
  TEAMS_VERB_CLAIM,
  TEAMS_VERB_CLOSE,
  TEAMS_VERB_RELEASE,
  TEAMS_VERB_REOPEN,
} from './teams.constants.ts';

const MAX_BODY_CHARS = 20_000;
const ADAPTIVE_CARD_TYPE = 'application/vnd.microsoft.card.adaptive';

export function escapeTeamsHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function linkHref(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? escapeTeamsHtml(parsed.href) : null;
  } catch {
    return null;
  }
}

function escapeCardText(text: string): string {
  return text.replace(/([\\*_~`[\]])/g, '\\$1');
}

function truncate(text: string, max = MAX_BODY_CHARS): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}… (truncated)`;
}

function htmlBody(text: string): string {
  return escapeTeamsHtml(truncate(text)).replace(/\r?\n/g, '<br>');
}

export function authorLabel(kind: AuthorKind, name: string | null): string {
  switch (kind) {
    case 'end_user':
      return `👤 <b>${escapeTeamsHtml(name ?? 'Customer')}</b> (customer)`;
    case 'agent':
      return `🤖 <b>${escapeTeamsHtml(name ?? 'AI agent')}</b>`;
    case 'user':
      return `🧑‍💻 <b>${escapeTeamsHtml(name ?? 'Teammate')}</b> (teammate)`;
    case 'system':
      return '⚙️ <b>System</b>';
  }
}

export function messageHtml(msg: MessageSnapshot): string {
  const label = authorLabel(msg.authorKind, msg.authorName);
  const body = msg.noSpeech ? '<i>No speech transcribed</i>' : htmlBody(msg.body);
  const attachments = (msg.attachments ?? []).map((a) => {
    const name = escapeTeamsHtml(a.name ?? 'attachment');
    const href = a.url ? linkHref(a.url) : null;
    return href ? `📎 <a href="${href}">${name}</a>` : `📎 ${name}`;
  });
  const lines = [msg.internal ? `🔒 <i>Internal note</i> — ${label}` : label, body, ...attachments];
  return lines.join('<br>');
}

export function htmlActivity(html: string): TeamsActivity {
  return { type: 'message', textFormat: 'xml', text: html };
}

function sourceLabel(conv: ConversationSnapshot): string {
  return conv.channelName ? `${conv.channelType} (${conv.channelName})` : conv.channelType;
}

function contactValue(conv: ConversationSnapshot): string | null {
  const reachable = conv.contactEmail ?? conv.contactPhone;
  if (!conv.contactName && !reachable) return null;
  if (conv.contactName && reachable) return `${conv.contactName} (${reachable})`;
  return conv.contactName ?? reachable;
}

export function threadHeadline(conv: ConversationSnapshot): string {
  return conv.subject
    ? `💬 ${conv.subject} — #${conv.displayId}`
    : `💬 New conversation #${conv.displayId}`;
}

export function parentStateLine(state: ParentState): string {
  if (state.status === 'closed') return '✅ Conversation is resolved.';
  if (state.status === 'spam') return '🚫 Marked as spam.';
  const parts = [`Status: ${state.status}`];
  if (state.claimedBy) parts.push(`taken over by ${state.claimedBy}`);
  if (state.assignedTo) parts.push(`assigned to ${state.assignedTo}`);
  if (state.needsHumanAttention) parts.push('🚨 needs attention');
  return parts.join(' · ');
}

function executeAction(title: string, verb: string, conversationId: string): Record<string, unknown> {
  return { type: 'Action.Execute', title, verb, data: { conversationId } };
}

export function threadParentActivity(
  conv: ConversationSnapshot,
  state: ParentState,
  conversationId: string,
): TeamsActivity {
  const resolved = state.status === 'closed' || state.status === 'spam';
  const buttons = resolved
    ? [executeAction('Reopen', TEAMS_VERB_REOPEN, conversationId)]
    : [
        state.claimedBy
          ? executeAction('Release', TEAMS_VERB_RELEASE, conversationId)
          : executeAction('Take over', TEAMS_VERB_CLAIM, conversationId),
        executeAction('Close', TEAMS_VERB_CLOSE, conversationId),
      ];
  const facts = [{ title: 'Via', value: escapeCardText(sourceLabel(conv)) }];
  const contact = contactValue(conv);
  if (contact) facts.unshift({ title: 'From', value: escapeCardText(contact) });
  const headline = threadHeadline(conv);
  const card = {
    type: 'AdaptiveCard',
    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
    version: '1.5',
    body: [
      {
        type: 'TextBlock',
        text: escapeCardText(headline),
        weight: 'Bolder',
        size: 'Medium',
        wrap: true,
      },
      { type: 'FactSet', facts },
      { type: 'TextBlock', text: escapeCardText(parentStateLine(state)), wrap: true, isSubtle: true },
    ],
    actions: [
      ...buttons,
      { type: 'Action.OpenUrl', title: 'Open in Munin', url: conv.dashboardUrl },
    ],
  };
  return {
    type: 'message',
    summary: headline,
    attachments: [{ contentType: ADAPTIVE_CARD_TYPE, content: card }],
  };
}

export function statusChangedHtml(status: string): string {
  switch (status) {
    case 'closed':
      return '✅ <b>Conversation is resolved.</b>';
    case 'open':
      return '↩️ Conversation reopened';
    case 'snoozed':
      return '💤 Conversation snoozed';
    case 'spam':
      return '🚫 Marked as spam';
    default:
      return `ℹ️ Status changed to <b>${escapeTeamsHtml(status)}</b>`;
  }
}

export function assignedHtml(assigneeName: string | null): string {
  if (!assigneeName) return '👤 Unassigned';
  return `👤 Assigned to <b>${escapeTeamsHtml(assigneeName)}</b>`;
}

export function takenOverHtml(holderName: string): string {
  return `✋ <b>${escapeTeamsHtml(holderName)}</b> took over`;
}

export function releasedHtml(holderName: string): string {
  return `🚪 <b>${escapeTeamsHtml(holderName)}</b> released the conversation`;
}

export function handoverRequestedHtml(reason: string | null): string {
  const suffix = reason ? ` — ${escapeTeamsHtml(reason)}` : '';
  return `🚨 <b>Human attention requested</b>${suffix}`;
}

export function handoverResolvedHtml(): string {
  return '🤝 Handover resolved — a human replied';
}

export function escalationAlertHtml(conv: ConversationSnapshot, reason: string | null): string {
  const lines = [
    `🚨 <b>Human attention needed</b> — conversation #${conv.displayId} via ${escapeTeamsHtml(sourceLabel(conv))}`,
  ];
  if (reason) lines.push(`<b>Reason:</b> ${escapeTeamsHtml(reason)}`);
  const contact = contactValue(conv);
  if (contact) lines.push(`<b>From:</b> ${escapeTeamsHtml(contact)}`);
  const href = linkHref(conv.dashboardUrl);
  if (href) lines.push(`<a href="${href}">Open in Munin</a>`);
  return lines.join('<br>');
}

export function testMessageHtml(orgName: string | null): string {
  const scope = orgName ? ` for <b>${escapeTeamsHtml(orgName)}</b>` : '';
  return `👋 Munin is connected${scope}. New conversations will mirror into this channel as threads.`;
}

export function mentionActivity(input: {
  memberId: string;
  memberName: string;
  html: string;
}): TeamsActivity {
  const tag = `<at>${escapeTeamsHtml(input.memberName)}</at>`;
  return {
    type: 'message',
    textFormat: 'xml',
    text: `${tag} ${input.html}`,
    entities: [
      {
        type: 'mention',
        text: tag,
        mentioned: { id: input.memberId, name: input.memberName },
      },
    ],
  };
}

export const REPLY_NOT_LINKED_HTML =
  '⛔ Your reply was <b>not sent to the customer</b> — your Teams account is not linked to a member of this Munin org. Ask an admin to invite you with your work email, or reply from the Munin dashboard.';

export const ATTACHMENTS_NOT_SENT_HTML =
  '⛔ Attachments are not forwarded to customers yet — your file was <b>not sent</b>. Add the content as text, or send it from the dashboard.';

export function attachmentsDroppedHtml(count: number): string {
  return `⚠️ Your message was sent <b>without</b> the ${count} attached file${count === 1 ? '' : 's'} — attachments are not forwarded to customers yet.`;
}

export interface InvokeResponse {
  status: number;
  body: Record<string, unknown>;
}

export function invokeMessage(text: string): InvokeResponse {
  return {
    status: 200,
    body: { statusCode: 200, type: 'application/vnd.microsoft.activity.message', value: text },
  };
}
