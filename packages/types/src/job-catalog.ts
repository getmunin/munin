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
  'skill://cms/review-stale-entries',
  'skill://outreach/draft-initial-email',
  'skill://outreach/draft-reply-email',
  'skill://conv/strip-email-signature',
  'skill://conv/set-topic-and-title',
]);

export const WEB_SCRAPE_SITE_TASK_URI = 'task://web/scrape-website';

export const KNOWN_TASK_URIS: ReadonlySet<string> = new Set([WEB_SCRAPE_SITE_TASK_URI]);

const TIER_BY_URI: ReadonlyMap<string, ModelTier> = new Map([
  ['skill://conv/strip-email-signature', 'fast'],
  ['skill://conv/set-topic-and-title', 'fast'],
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

const TOOL_PREFIXES_BY_URI: ReadonlyMap<string, readonly string[]> = new Map([
  [
    'skill://kb/review-content',
    [
      'conv_list_conversations',
      'conv_get_conversation',
      'kb_search',
      'kb_list_documents',
      'kb_propose_curation_candidate',
    ],
  ],
  [
    'skill://crm/clean-contact-data',
    ['crm_list_merge_proposals', 'crm_list_contacts', 'crm_propose_merge'],
  ],
  [
    'skill://crm/extract-contact-from-message',
    ['conv_get_conversation', 'crm_find_contact', 'crm_create_contact', 'crm_update_contact'],
  ],
  [
    'skill://outreach/draft-initial-email',
    [
      'outreach_list_campaigns',
      'crm_list_contacts_in_segment',
      'outreach_list_proposals',
      'outreach_propose_initial',
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
    'skill://cms/review-stale-entries',
    [
      'cms_list_collections',
      'cms_list_entries',
      'cms_list_inbound_references',
      'cms_list_assets',
      'cms_search',
      'cms_list_versions',
    ],
  ],
  ['skill://conv/strip-email-signature', ['conv_strip_message_signature']],
  [
    'skill://conv/set-topic-and-title',
    ['conv_get_conversation', 'conv_list_topics', 'conv_create_topic', 'conv_set_topic', 'conv_set_subject'],
  ],
]);

export function toolPrefixesFor(uri: string): readonly string[] | undefined {
  return TOOL_PREFIXES_BY_URI.get(uri);
}
