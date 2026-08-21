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
      return `:robot_face: *${escapeSlackText(name ?? 'AI agent')}*`;
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
  const headline = conv.subject
    ? `:speech_balloon: *${escapeSlackText(conv.subject)}* — #${conv.displayId} via ${sourceLabel(conv)}`
    : `:speech_balloon: *New conversation #${conv.displayId}* — via ${sourceLabel(conv)}`;
  const lines = [headline];
  const contact = contactLine(conv);
  if (contact) lines.push(contact);
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

export interface SpeakerIdentity {
  username: string;
  iconEmoji?: string;
  avatarKey?: string;
}

export function avatarKey(name: string | null): string {
  const initial = (name ?? '').match(/[A-Za-z]/)?.[0];
  return initial ? initial.toUpperCase() : 'default';
}

export function speakerIdentity(kind: AuthorKind, name: string | null): SpeakerIdentity {
  switch (kind) {
    case 'end_user':
      return { username: name ?? 'Customer', avatarKey: avatarKey(name) };
    case 'agent':
    case 'system':
      return { username: name ?? 'Munin' };
    case 'user':
      return { username: name ?? 'Teammate', avatarKey: `${avatarKey(name)}-dark` };
  }
}

export function messageBodyText(msg: MessageSnapshot): string {
  const rawBody = truncate(escapeSlackText(msg.body));
  const body = msg.authorKind === 'system' ? `:gear: *${rawBody}*` : rawBody;
  const attachmentLines = (msg.attachments ?? []).map((a) => {
    const name = escapeSlackText(a.name ?? 'attachment');
    return a.url ? `:paperclip: <${a.url}|${name}>` : `:paperclip: ${name}`;
  });
  const suffix = attachmentLines.length > 0 ? `\n${attachmentLines.join('\n')}` : '';
  if (msg.internal) return `:lock: _Internal note_\n${body}${suffix}`;
  return `${body}${suffix}`;
}

export function statusChangedText(status: string): string {
  switch (status) {
    case 'closed':
      return ':white_check_mark: *Conversation is resolved.*';
    case 'open':
      return ':leftwards_arrow_with_hook: Conversation reopened';
    case 'snoozed':
      return ':zzz: Conversation snoozed';
    case 'spam':
      return ':no_entry_sign: Marked as spam';
    default:
      return `:information_source: Status changed to *${escapeSlackText(status)}*`;
  }
}

export function assignedText(assigneeName: string | null): string {
  if (!assigneeName) return ':bust_in_silhouette: Unassigned';
  return `:bust_in_silhouette: Assigned to *${escapeSlackText(assigneeName)}*`;
}

export function takenOverText(holderName: string): string {
  return `:raised_hand: *${escapeSlackText(holderName)}* took over`;
}

export function releasedText(holderName: string): string {
  return `:door: *${escapeSlackText(holderName)}* released the conversation`;
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
export const RELEASE_ACTION_ID = 'munin_release';

export function parentStateLine(state: ParentState): string {
  if (state.status === 'closed') return ':white_check_mark: *Conversation is resolved.*';
  if (state.status === 'spam') return ':no_entry_sign: *Marked as spam.*';
  const parts = [`*Status:* ${escapeSlackText(state.status)}`];
  if (state.claimedBy) parts.push(`taken over by *${escapeSlackText(state.claimedBy)}*`);
  if (state.assignedTo) parts.push(`assigned to *${escapeSlackText(state.assignedTo)}*`);
  if (state.needsHumanAttention) parts.push(':rotating_light: needs attention');
  return parts.join(' · ');
}

function actionButton(
  actionId: string,
  label: string,
  value: string,
  style?: 'primary' | 'danger',
): Record<string, unknown> {
  return {
    type: 'button',
    action_id: actionId,
    text: { type: 'plain_text', text: label },
    value,
    ...(style ? { style } : {}),
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
        state.claimedBy
          ? actionButton(RELEASE_ACTION_ID, 'Release', conversationId)
          : actionButton(CLAIM_ACTION_ID, 'Take over', conversationId),
        actionButton(CLOSE_ACTION_ID, 'Close', conversationId, 'danger'),
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

export const ROUTE_DEFAULT_ACTION_ID = 'munin_route_default';
export const ROUTE_ESCALATIONS_ACTION_ID = 'munin_route_escalations';
export const ROUTE_DISMISS_ACTION_ID = 'munin_route_dismiss';

export function routePromptText(orgName: string | null): string {
  const scope = orgName ? ` for *${escapeSlackText(orgName)}*` : '';
  return `:wave: Munin joined this channel. Should conversations${scope} mirror in here?`;
}

export function routePromptBlocks(integrationId: string, orgName: string | null): SlackBlock[] {
  return [
    { type: 'section', text: { type: 'mrkdwn', text: routePromptText(orgName) } },
    {
      type: 'actions',
      elements: [
        actionButton(ROUTE_DEFAULT_ACTION_ID, 'Mirror all conversations', integrationId),
        actionButton(ROUTE_ESCALATIONS_ACTION_ID, 'Escalation alerts only', integrationId),
        actionButton(ROUTE_DISMISS_ACTION_ID, 'Not now', integrationId),
      ],
    },
  ];
}

export function routeConfirmedText(
  purpose: 'default' | 'escalations',
  slackUserId: string,
): string {
  return purpose === 'default'
    ? `:white_check_mark: This channel now receives all mirrored conversations — set by <@${slackUserId}>.`
    : `:white_check_mark: This channel now receives handover escalation alerts — set by <@${slackUserId}>.`;
}

export function routeDismissedText(): string {
  return 'Ok — routing can be configured any time from the dashboard (Settings → Integrations) or with slack_set_routing.';
}

export const APPROVAL_APPROVE_ACTION_ID = 'munin_approval_approve';
export const APPROVAL_DISMISS_ACTION_ID = 'munin_approval_dismiss';

const APPROVAL_SUBJECT_TYPES = [
  'crm_merge_proposal',
  'outreach_proposal',
  'kb_curation_candidate',
] as const;

export type ApprovalSubjectType = (typeof APPROVAL_SUBJECT_TYPES)[number];

export function encodeApprovalValue(
  subjectType: ApprovalSubjectType,
  subjectId: string,
  fingerprint?: string | null,
): string {
  return `${subjectType}:${subjectId}${fingerprint ? `#${fingerprint}` : ''}`;
}

export function parseApprovalValue(
  value: string,
): { subjectType: ApprovalSubjectType; subjectId: string; fingerprint: string | null } | null {
  const hash = value.indexOf('#');
  const fingerprint = hash >= 0 ? value.slice(hash + 1) : null;
  const head = hash >= 0 ? value.slice(0, hash) : value;
  const sep = head.indexOf(':');
  if (sep <= 0) return null;
  const subjectType = head.slice(0, sep) as ApprovalSubjectType;
  const subjectId = head.slice(sep + 1);
  if (!APPROVAL_SUBJECT_TYPES.includes(subjectType) || subjectId.length === 0) return null;
  return { subjectType, subjectId, fingerprint: fingerprint || null };
}

export interface MergeProposalApprovalSnapshot {
  contactALabel: string;
  contactBLabel: string;
  keeperLabel: string;
  confidence: string;
  dashboardUrl: string;
}

export function mergeProposalApprovalText(snap: MergeProposalApprovalSnapshot): string {
  return [
    ':busts_in_silhouette: *Duplicate contacts — merge proposed*',
    `*A:* ${escapeSlackText(snap.contactALabel)}`,
    `*B:* ${escapeSlackText(snap.contactBLabel)}`,
    `*Keep:* ${escapeSlackText(snap.keeperLabel)} · ${escapeSlackText(snap.confidence)} confidence`,
    `<${snap.dashboardUrl}|Review in Munin>`,
  ].join('\n');
}

export interface OutreachProposalApprovalSnapshot {
  kind: string;
  campaignName: string;
  contactLabel: string;
  draftSubject: string | null;
  draftBody: string;
  dashboardUrl: string;
}

const TRUNCATION_MARKER = '> … _(truncated — open the full draft in Munin)_';

function quotedBodyLines(body: string, budget: number): string[] {
  const lines: string[] = [];
  let used = 0;
  for (const line of body.split('\n')) {
    const quoted = `> ${line}`;
    if (used + quoted.length + 1 > budget) {
      const room = budget - used - TRUNCATION_MARKER.length - 2;
      if (room > 0) lines.push(`> ${line.slice(0, room).replace(/&[a-z]*$/, '')}`);
      lines.push(TRUNCATION_MARKER);
      return lines;
    }
    used += quoted.length + 1;
    lines.push(quoted);
  }
  return lines;
}

export function outreachProposalApprovalText(snap: OutreachProposalApprovalSnapshot): string {
  const header = [
    `:outbox_tray: *Outreach draft awaiting approval* — ${escapeSlackText(snap.kind)} for *${escapeSlackText(snap.campaignName)}*`,
    `*To:* ${escapeSlackText(snap.contactLabel)}`,
  ];
  if (snap.draftSubject) header.push(`*Subject:* ${escapeSlackText(snap.draftSubject)}`);
  const footer = `<${snap.dashboardUrl}|Review in Munin>`;
  const overhead = [...header, footer].reduce((total, line) => total + line.length + 1, 0);
  const body = quotedBodyLines(
    escapeSlackText(snap.draftBody),
    Math.max(TRUNCATION_MARKER.length, MAX_BODY_CHARS - overhead),
  );
  return [...header, ...body, footer].join('\n');
}

export function outreachCampaignParentText(
  campaignName: string,
  pendingCount: number,
  dashboardUrl: string,
): string {
  if (pendingCount === 0) {
    return `:white_check_mark: *All outreach drafts handled — ${escapeSlackText(campaignName)}*`;
  }
  const noun = pendingCount === 1 ? 'draft' : 'drafts';
  return [
    `:outbox_tray: *Outreach drafts awaiting approval — ${escapeSlackText(campaignName)}*`,
    `${pendingCount} ${noun} pending · <${dashboardUrl}|Review all in Munin>`,
  ].join('\n');
}

export function outreachCampaignParentMovedText(campaignName: string): string {
  return `:outbox_tray: *Outreach drafts — ${escapeSlackText(campaignName)}* — continued in a newer thread below`;
}

export interface KbCandidateApprovalSnapshot {
  title: string;
  proposedTargetSpaceSlug: string | null;
  sourceConversationId: string | null;
  revisesDocumentTitle?: string | null;
  dashboardUrl: string;
}

export function kbCandidateApprovalText(snap: KbCandidateApprovalSnapshot): string {
  const revises = snap.revisesDocumentTitle;
  if (revises !== null && revises !== undefined) {
    const lines = [`:books: *KB change awaiting review* — *${escapeSlackText(snap.title)}*`];
    lines.push(`*Revises:* ${escapeSlackText(revises)}`);
    lines.push('_Publishing writes a new version of that document — review the diff in Munin._');
    lines.push(`<${snap.dashboardUrl}|Review in Munin>`);
    return lines.join('\n');
  }
  const lines = [`:books: *KB draft awaiting review* — *${escapeSlackText(snap.title)}*`];
  lines.push(
    snap.proposedTargetSpaceSlug
      ? `*Proposed space:* ${escapeSlackText(snap.proposedTargetSpaceSlug)}`
      : '_No target space proposed — pick one when publishing._',
  );
  if (snap.sourceConversationId) lines.push('_Drafted from a resolved conversation._');
  lines.push(`<${snap.dashboardUrl}|Review in Munin>`);
  return lines.join('\n');
}

export interface CmsEntryPublishedSnapshot {
  title: string;
  collectionSlug: string | null;
  locale: string | null;
  url: string | null;
}

export function cmsEntryPublishedText(snap: CmsEntryPublishedSnapshot): string {
  const lines = [`:rocket: *Published* — *${escapeSlackText(snap.title)}*`];
  const meta = [snap.collectionSlug, snap.locale].filter((v): v is string => !!v);
  if (meta.length > 0) lines.push(`_${escapeSlackText(meta.join(' · '))}_`);
  if (snap.url) lines.push(`<${snap.url}|Read it live>`);
  return lines.join('\n');
}

export type ApprovalOutcome = 'applied' | 'sent' | 'published' | 'dismissed' | 'withdrawn';

export function approvalResolvedLine(
  outcome: ApprovalOutcome,
  decidedByName: string | null,
): string {
  const by = decidedByName ? ` by *${escapeSlackText(decidedByName)}*` : '';
  switch (outcome) {
    case 'applied':
      return `:white_check_mark: *Merge applied*${by}`;
    case 'sent':
      return `:white_check_mark: *Approved — email sent*${by}`;
    case 'published':
      return `:white_check_mark: *Published to the knowledge base*${by}`;
    case 'dismissed':
      return `:no_entry_sign: *Dismissed*${by}`;
    case 'withdrawn':
      return `:leftwards_arrow_with_hook: *Withdrawn by the agent*${by}`;
  }
}

export interface ApprovalResolution {
  outcome: ApprovalOutcome;
  decidedByName: string | null;
}

export function approvalBlocks(
  text: string,
  value: string,
  opts: { approveLabel: string | null },
  resolution: ApprovalResolution | null,
): SlackBlock[] {
  if (resolution) {
    return [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `${text}\n${approvalResolvedLine(resolution.outcome, resolution.decidedByName)}`,
        },
      },
    ];
  }
  const buttons = [
    ...(opts.approveLabel
      ? [actionButton(APPROVAL_APPROVE_ACTION_ID, opts.approveLabel, value, 'primary')]
      : []),
    actionButton(APPROVAL_DISMISS_ACTION_ID, 'Dismiss', value, 'danger'),
  ];
  return [
    { type: 'section', text: { type: 'mrkdwn', text } },
    { type: 'actions', elements: buttons },
  ];
}
