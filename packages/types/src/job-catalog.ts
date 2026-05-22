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
]);

export const WEB_SCRAPE_SITE_TASK_URI = 'task://web/scrape-website';

const TIER_BY_URI: ReadonlyMap<string, ModelTier> = new Map([
  ['skill://conv/strip-email-signature', 'fast'],
]);

export function tierFor(uri: string): ModelTier {
  return TIER_BY_URI.get(uri) ?? 'smart';
}

const TOOL_PREFIXES_BY_URI: ReadonlyMap<string, readonly string[]> = new Map([
  ['skill://kb/review-content', ['conv_', 'kb_']],
  ['skill://crm/clean-contact-data', ['conv_', 'crm_']],
  ['skill://crm/extract-contact-from-message', ['conv_', 'crm_']],
  ['skill://outreach/draft-initial-email', ['conv_', 'kb_', 'crm_', 'outreach_']],
  ['skill://outreach/draft-reply-email', ['conv_', 'kb_', 'crm_', 'outreach_']],
  ['skill://cms/review-stale-entries', ['cms_']],
  ['skill://conv/strip-email-signature', ['conv_strip_message_signature']],
]);

export function toolPrefixesFor(uri: string): readonly string[] | undefined {
  return TOOL_PREFIXES_BY_URI.get(uri);
}
