import type { SocialPlatform } from './social-platform.ts';

export const COMPANION_JOB_URI = 'skill://social/draft-companion-posts';

export const AUTO_DRAFT_SETTING_KEY = 'socialDraftOnPublish';

export function draftsOnPublish(settings: Record<string, unknown>): boolean {
  return settings[AUTO_DRAFT_SETTING_KEY] === true;
}

export interface CompanionPromptInput {
  entryId: string;
  collectionSlug: string;
  locale: string;
  title: string;
  url: string;
  platform: SocialPlatform;
}

export function buildCompanionPrompt(input: CompanionPromptInput): string {
  return (
    `An article was just published and needs companion ${input.platform} posts drafted for review. ` +
    `Entry ${input.entryId} ("${input.title}") in collection ${input.collectionSlug}, locale ${input.locale}. ` +
    `Follow skill://social/draft-companion-posts exactly.\n\n` +
    `Read the article first with cms_get_entry(${input.entryId}). Three or four variants written from ` +
    `the title alone are four ways of saying nothing; the angles have to come out of what the piece ` +
    `actually argues.\n\n` +
    `Call social_list_platforms and write to the limit it reports for ${input.platform}. ` +
    `Then call social_propose_post_set once, with:\n` +
    `- platform: ${input.platform}\n` +
    `- linkUrl: ${input.url}\n` +
    `- sourceRef: { "type": "cms_entry", "id": "${input.entryId}" }\n` +
    `- variants: one per angle, each with its own variantLabel\n\n` +
    `Pass linkUrl exactly as given, with no tracking parameters of your own — Munin tags it per ` +
    `variant, and a parameter you add defeats the per-angle click figures. ` +
    `Nothing you store here is published: a person reads the set and picks one, under their own name.`
  );
}
