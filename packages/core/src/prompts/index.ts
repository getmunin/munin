import {
  SYSTEM_PROMPT_SLUG,
  SYSTEM_PROMPT_TITLE,
  DEFAULT_SYSTEM_PROMPT,
} from './system.ts';
import {
  CHANNEL_CHAT_SLUG,
  CHANNEL_CHAT_TITLE,
  DEFAULT_CHANNEL_CHAT_PROMPT,
} from './channel-chat.ts';
import {
  CHANNEL_EMAIL_SLUG,
  CHANNEL_EMAIL_TITLE,
  DEFAULT_CHANNEL_EMAIL_PROMPT,
} from './channel-email.ts';
import {
  CHANNEL_SMS_SLUG,
  CHANNEL_SMS_TITLE,
  DEFAULT_CHANNEL_SMS_PROMPT,
} from './channel-sms.ts';
import {
  CHANNEL_DEFAULT_SLUG,
  CHANNEL_DEFAULT_TITLE,
  DEFAULT_CHANNEL_DEFAULT_PROMPT,
} from './channel-default.ts';
import {
  VOICE_SYSTEM_PROMPT_SLUG,
  VOICE_SYSTEM_PROMPT_TITLE,
  DEFAULT_VOICE_SYSTEM_PROMPT,
} from './voice-system.ts';
import {
  VOICE_OPENER_COLD_SLUG,
  VOICE_OPENER_COLD_TITLE,
  DEFAULT_VOICE_OPENER_COLD,
} from './voice-opener-cold.ts';
import {
  VOICE_OPENER_CONTINUATION_SLUG,
  VOICE_OPENER_CONTINUATION_TITLE,
  DEFAULT_VOICE_OPENER_CONTINUATION,
} from './voice-opener-continuation.ts';

export {
  SYSTEM_PROMPT_SLUG,
  SYSTEM_PROMPT_TITLE,
  DEFAULT_SYSTEM_PROMPT,
  CHANNEL_CHAT_SLUG,
  CHANNEL_CHAT_TITLE,
  DEFAULT_CHANNEL_CHAT_PROMPT,
  CHANNEL_EMAIL_SLUG,
  CHANNEL_EMAIL_TITLE,
  DEFAULT_CHANNEL_EMAIL_PROMPT,
  CHANNEL_SMS_SLUG,
  CHANNEL_SMS_TITLE,
  DEFAULT_CHANNEL_SMS_PROMPT,
  CHANNEL_DEFAULT_SLUG,
  CHANNEL_DEFAULT_TITLE,
  DEFAULT_CHANNEL_DEFAULT_PROMPT,
  VOICE_SYSTEM_PROMPT_SLUG,
  VOICE_SYSTEM_PROMPT_TITLE,
  DEFAULT_VOICE_SYSTEM_PROMPT,
  VOICE_OPENER_COLD_SLUG,
  VOICE_OPENER_COLD_TITLE,
  DEFAULT_VOICE_OPENER_COLD,
  VOICE_OPENER_CONTINUATION_SLUG,
  VOICE_OPENER_CONTINUATION_TITLE,
  DEFAULT_VOICE_OPENER_CONTINUATION,
};

export const AGENT_RUNTIME_PROMPT_SPACE_SLUG = 'agent-runtime';
export const COMPANY_PROFILE_SPACE_SLUG = 'website-import';
export const CHANNEL_PROMPT_PREFIX = 'channel-';
export const COMPANY_PROFILE_SLUG = 'company-profile';

export {
  createPromptCache,
  type KbDocLocation,
  type KbDocReader,
  type PromptCache,
  type PromptCacheEntry,
  type PromptCacheOptions,
} from './cache.ts';

export interface SeedablePrompt {
  slug: string;
  title: string;
  body: string;
}

export const SEEDABLE_PROMPTS: readonly SeedablePrompt[] = [
  { slug: SYSTEM_PROMPT_SLUG, title: SYSTEM_PROMPT_TITLE, body: DEFAULT_SYSTEM_PROMPT },
  { slug: CHANNEL_CHAT_SLUG, title: CHANNEL_CHAT_TITLE, body: DEFAULT_CHANNEL_CHAT_PROMPT },
  { slug: CHANNEL_EMAIL_SLUG, title: CHANNEL_EMAIL_TITLE, body: DEFAULT_CHANNEL_EMAIL_PROMPT },
  { slug: CHANNEL_SMS_SLUG, title: CHANNEL_SMS_TITLE, body: DEFAULT_CHANNEL_SMS_PROMPT },
  {
    slug: CHANNEL_DEFAULT_SLUG,
    title: CHANNEL_DEFAULT_TITLE,
    body: DEFAULT_CHANNEL_DEFAULT_PROMPT,
  },
  {
    slug: VOICE_SYSTEM_PROMPT_SLUG,
    title: VOICE_SYSTEM_PROMPT_TITLE,
    body: DEFAULT_VOICE_SYSTEM_PROMPT,
  },
  {
    slug: VOICE_OPENER_COLD_SLUG,
    title: VOICE_OPENER_COLD_TITLE,
    body: DEFAULT_VOICE_OPENER_COLD,
  },
  {
    slug: VOICE_OPENER_CONTINUATION_SLUG,
    title: VOICE_OPENER_CONTINUATION_TITLE,
    body: DEFAULT_VOICE_OPENER_CONTINUATION,
  },
];

export function getSeedablePrompt(slug: string): SeedablePrompt | undefined {
  return SEEDABLE_PROMPTS.find((p) => p.slug === slug);
}

export function isSystemRuntimeDoc(
  spaceSlug: string | null | undefined,
  docSlug: string | null | undefined,
): boolean {
  if (!spaceSlug || !docSlug) return false;
  if (spaceSlug !== AGENT_RUNTIME_PROMPT_SPACE_SLUG) return false;
  if (SEEDABLE_PROMPTS.some((p) => p.slug === docSlug)) return true;
  return docSlug.startsWith(CHANNEL_PROMPT_PREFIX);
}
