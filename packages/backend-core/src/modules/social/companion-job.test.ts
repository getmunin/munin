import { describe, it, expect } from 'vitest';
import { KNOWN_SKILL_URIS, toolPrefixesFor } from '@getmunin/types';
import {
  buildCompanionPrompt,
  companionDedupeKey,
  COMPANION_JOB_URI,
  draftsOnPublish,
} from './companion-job.ts';

describe('draftsOnPublish', () => {
  it('stays off for a collection that never opted in', () => {
    expect(draftsOnPublish({})).toBe(false);
    expect(draftsOnPublish({ liveUrl: 'https://example.test/{slug}' })).toBe(false);
  });

  it('treats anything but the boolean true as off', () => {
    expect(draftsOnPublish({ socialDraftOnPublish: 'true' })).toBe(false);
    expect(draftsOnPublish({ socialDraftOnPublish: 1 })).toBe(false);
    expect(draftsOnPublish({ socialDraftOnPublish: false })).toBe(false);
    expect(draftsOnPublish({ socialDraftOnPublish: true })).toBe(true);
  });
});

describe('companion job registration', () => {
  it('is a known skill uri, or the curator refuses to enqueue it', () => {
    expect(KNOWN_SKILL_URIS.has(COMPANION_JOB_URI)).toBe(true);
  });

  it('declares a tool sandbox, or the run gets the full admin surface', () => {
    const prefixes = toolPrefixesFor(COMPANION_JOB_URI);
    expect(prefixes).toBeDefined();
    expect(prefixes).toContain('social_propose_post_set');
    expect(prefixes).toContain('cms_get_entry');
  });

  it('withholds every tool that decides a draft', () => {
    const prefixes = toolPrefixesFor(COMPANION_JOB_URI) ?? [];
    expect(prefixes).not.toContain('social_dismiss_post_draft');
    expect(prefixes).not.toContain('social_mark_draft_posted');
  });
});

describe('buildCompanionPrompt', () => {
  const input = {
    entryId: 'cme_1',
    collectionSlug: 'articles',
    locale: 'en',
    title: 'Nine in ten tickets',
    url: 'https://example.test/blog/nine-in-ten',
    platform: 'linkedin' as const,
  };

  it('names the entry so the agent reads the piece instead of the title', () => {
    const prompt = buildCompanionPrompt(input);
    expect(prompt).toContain('cms_get_entry(cme_1)');
    expect(prompt).toContain('Nine in ten tickets');
  });

  it('hands over the link untagged and says why not to tag it', () => {
    const prompt = buildCompanionPrompt(input);
    expect(prompt).toContain('https://example.test/blog/nine-in-ten');
    expect(prompt).not.toContain('utm_');
    expect(prompt).toContain('no tracking parameters');
  });

  it('carries the source reference the review queue groups on', () => {
    expect(buildCompanionPrompt(input)).toContain('"type": "cms_entry", "id": "cme_1"');
  });

  it("tells a LinkedIn run the post carries the publisher's own byline", () => {
    const prompt = buildCompanionPrompt(input);
    expect(prompt).toContain('under their own name');
    expect(prompt).not.toContain("company's voice");
  });

  it('tells a Facebook run the post is signed by the page, not the person', () => {
    const prompt = buildCompanionPrompt({ ...input, platform: 'facebook' });
    expect(prompt).toContain('Facebook page');
    expect(prompt).not.toContain('under their own name');
  });

  it('confines a run to its own platform, so two runs do not each propose both', () => {
    const prompt = buildCompanionPrompt({ ...input, platform: 'facebook' });
    expect(prompt).toContain('platform: facebook');
    expect(prompt).toContain('leave the others alone');
  });
});

describe('companionDedupeKey', () => {
  it('separates the platforms, or the second one is swallowed as a duplicate', () => {
    expect(companionDedupeKey('cme_1', 'linkedin')).not.toBe(
      companionDedupeKey('cme_1', 'facebook'),
    );
  });

  it('still collapses a repeat of the same entry on the same platform', () => {
    expect(companionDedupeKey('cme_1', 'linkedin')).toBe(companionDedupeKey('cme_1', 'linkedin'));
  });
});
