/**
 * Built-in prompt defaults. Each prompt lives in its own file so PR diffs and
 * git-blame stay scoped. This index assembles the seedable registry that
 * agent-host writes to the `agent-runtime` KB space on first boot.
 *
 * Adding a new prompt: drop a new file alongside the others exporting
 * `<NAME>_SLUG`, `<NAME>_TITLE`, `DEFAULT_<NAME>`; re-export here; append to
 * `SEEDABLE_PROMPTS`. No other plumbing needed.
 */

import {
  SYSTEM_PROMPT_SLUG,
  SYSTEM_PROMPT_TITLE,
  DEFAULT_SYSTEM_PROMPT,
} from './system.js';
import {
  CHANNEL_CHAT_SLUG,
  CHANNEL_CHAT_TITLE,
  DEFAULT_CHANNEL_CHAT_PROMPT,
} from './channel-chat.js';
import {
  CHANNEL_EMAIL_SLUG,
  CHANNEL_EMAIL_TITLE,
  DEFAULT_CHANNEL_EMAIL_PROMPT,
} from './channel-email.js';
import {
  CHANNEL_SMS_SLUG,
  CHANNEL_SMS_TITLE,
  DEFAULT_CHANNEL_SMS_PROMPT,
} from './channel-sms.js';
import {
  CHANNEL_DEFAULT_SLUG,
  CHANNEL_DEFAULT_TITLE,
  DEFAULT_CHANNEL_DEFAULT_PROMPT,
} from './channel-default.js';
import {
  VOICE_SYSTEM_PROMPT_SLUG,
  VOICE_SYSTEM_PROMPT_TITLE,
  DEFAULT_VOICE_SYSTEM_PROMPT,
} from './voice-system.js';
import {
  VOICE_OPENER_COLD_SLUG,
  VOICE_OPENER_COLD_TITLE,
  DEFAULT_VOICE_OPENER_COLD,
} from './voice-opener-cold.js';
import {
  VOICE_OPENER_CONTINUATION_SLUG,
  VOICE_OPENER_CONTINUATION_TITLE,
  DEFAULT_VOICE_OPENER_CONTINUATION,
} from './voice-opener-continuation.js';

// ── Slug / body / title constants ───────────────────────────────────
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

// ── Shared space / namespace constants ──────────────────────────────
export const AGENT_RUNTIME_PROMPT_SPACE_SLUG = 'agent-runtime';
export const COMPANY_PROFILE_SPACE_SLUG = 'imported-from-website';
export const CHANNEL_PROMPT_PREFIX = 'channel-';
export const COMPANY_PROFILE_SLUG = 'company-profile';

// ── Cache primitives ────────────────────────────────────────────────
export {
  createPromptCache,
  type KbDocLocation,
  type KbDocReader,
  type PromptCache,
  type PromptCacheEntry,
  type PromptCacheOptions,
} from './cache.js';

// ── Registry ────────────────────────────────────────────────────────
export interface SeedablePrompt {
  slug: string;
  title: string;
  body: string;
}

/**
 * Every prompt that `agent-host` seeds into the `agent-runtime` KB space on
 * first boot. Both runtimes use the same bodies as fallbacks when a KB
 * lookup returns nothing.
 */
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
