export type JobKind = 'skill' | 'task';
export type ModelTier = 'fast' | 'smart';

export function jobKindOf(uri: string): JobKind | null {
  if (uri.startsWith('skill://')) return 'skill';
  if (uri.startsWith('task://')) return 'task';
  return null;
}

export const KNOWN_SKILL_URIS: ReadonlySet<string> = new Set([
  'skill://kb/review-content',
  'skill://crm/clean-contact-data',
  'skill://crm/extract-contact-from-message',
  'skill://outreach/draft-first-touch-email',
  'skill://outreach/draft-reply-email',
  'skill://outreach/draft-followup-email',
  'skill://outreach/extract-outcome',
  'skill://conv/strip-email-signature',
  'skill://conv/set-topic-and-title',
  'skill://social/draft-companion-posts',
  'skill://journeys/decide-step',
]);

export const WEB_SCRAPE_SITE_TASK_URI = 'task://web/scrape-website';

export const KNOWN_TASK_URIS: ReadonlySet<string> = new Set([WEB_SCRAPE_SITE_TASK_URI]);

const TIER_BY_URI: ReadonlyMap<string, ModelTier> = new Map([
  ['skill://conv/strip-email-signature', 'fast'],
  ['skill://conv/set-topic-and-title', 'fast'],
  ['skill://journeys/decide-step', 'fast'],
]);

export function tierFor(uri: string): ModelTier {
  return TIER_BY_URI.get(uri) ?? 'smart';
}

const PRIORITY_BY_URI: ReadonlyMap<string, number> = new Map([
  [WEB_SCRAPE_SITE_TASK_URI, 100],
]);

export function priorityFor(uri: string): number {
  return PRIORITY_BY_URI.get(uri) ?? 0;
}

export const TOOLS_BY_URI: ReadonlyMap<string, readonly string[]> = new Map([
  ['skill://journeys/decide-step', ['journeys_submit_decision']],
  [
    'skill://kb/review-content',
    [
      'conv_list_conversations',
      'conv_get_conversation',
      'kb_search',
      'kb_list_documents',
      'kb_get_document',
      'kb_list_curation_decisions',
      'kb_propose_curation_candidate',
      'kb_propose_curation_revision',
      'outreach_get_proposal',
    ],
  ],
  [
    'skill://crm/clean-contact-data',
    ['crm_list_merge_proposals', 'crm_list_contacts', 'crm_propose_merge'],
  ],
  [
    'skill://crm/extract-contact-from-message',
    ['conv_get_conversation', 'crm_apply_conversation_identity'],
  ],
  [
    'skill://outreach/draft-first-touch-email',
    [
      'outreach_list_campaigns',
      'crm_list_contacts_in_segment',
      'outreach_list_proposals',
      'outreach_propose_first_touch',
      'kb_search',
    ],
  ],
  [
    'skill://outreach/draft-reply-email',
    [
      'conv_get_conversation',
      'outreach_get_campaign',
      'outreach_list_proposals',
      'outreach_propose_reply',
      'kb_search',
    ],
  ],
  [
    'skill://outreach/draft-followup-email',
    [
      'outreach_list_due_followups',
      'outreach_get_campaign',
      'conv_get_conversation',
      'outreach_propose_followup',
      'kb_search',
    ],
  ],
  [
    'skill://outreach/extract-outcome',
    ['conv_get_conversation', 'outreach_get_campaign', 'crm_get_contact', 'crm_update_contact'],
  ],
  ['skill://conv/strip-email-signature', ['conv_strip_message_signature']],
  [
    'skill://conv/set-topic-and-title',
    ['conv_get_conversation', 'conv_list_topics', 'conv_create_topic', 'conv_set_topic', 'conv_set_subject'],
  ],
  [
    'skill://social/draft-companion-posts',
    ['cms_get_entry', 'social_list_platforms', 'social_propose_post_set'],
  ],
]);

export function allowedToolsFor(uri: string): readonly string[] | undefined {
  return TOOLS_BY_URI.get(uri);
}

export type PinnedToolArgs = Readonly<Record<string, Readonly<Record<string, string>>>>;

export const PAYLOAD_BOUND_ARGS_BY_URI: ReadonlyMap<string, PinnedToolArgs> = new Map<string, PinnedToolArgs>([
  [
    'skill://crm/extract-contact-from-message',
    {
      conv_get_conversation: { id: 'conversationId' },
      crm_apply_conversation_identity: { conversationId: 'conversationId' },
    },
  ],
  [
    'skill://conv/strip-email-signature',
    { conv_strip_message_signature: { messageId: 'messageId' } },
  ],
  [
    'skill://journeys/decide-step',
    { journeys_submit_decision: { stepRunId: 'stepRunId' } },
  ],
]);

export type PinnedToolArgsResolution =
  | { ok: true; pinned: PinnedToolArgs | undefined }
  | { ok: false; missing: string };

export function pinnedToolArgsFor(uri: string, payload: unknown): PinnedToolArgsResolution {
  const bindings = PAYLOAD_BOUND_ARGS_BY_URI.get(uri);
  if (!bindings) return { ok: true, pinned: undefined };
  const source: Record<string, unknown> =
    payload !== null && typeof payload === 'object' ? { ...payload } : {};
  const pinned: Record<string, Record<string, string>> = {};
  for (const [tool, args] of Object.entries(bindings)) {
    const values: Record<string, string> = {};
    for (const [arg, payloadKey] of Object.entries(args)) {
      const value = source[payloadKey];
      if (typeof value !== 'string' || value.length === 0) return { ok: false, missing: payloadKey };
      values[arg] = value;
    }
    pinned[tool] = values;
  }
  return { ok: true, pinned };
}
