import { describe, expect, it } from 'vitest';
import {
  KNOWN_SKILL_URIS,
  jobKindOf,
  priorityFor,
  tierFor,
  toolPrefixesFor,
} from './job-catalog.ts';

describe('jobKindOf', () => {
  it('classifies skill:// URIs as skill', () => {
    expect(jobKindOf('skill://kb/review-content')).toBe('skill');
  });
  it('classifies task:// URIs as task', () => {
    expect(jobKindOf('task://web/scrape-website')).toBe('task');
  });
  it('returns null for anything else', () => {
    expect(jobKindOf('')).toBeNull();
    expect(jobKindOf('http://example.com')).toBeNull();
    expect(jobKindOf('not-a-uri')).toBeNull();
  });
});

describe('tierFor', () => {
  it('routes strip-email-signature to fast', () => {
    expect(tierFor('skill://conv/strip-email-signature')).toBe('fast');
  });
  it('defaults to smart', () => {
    expect(tierFor('skill://crm/clean-contact-data')).toBe('smart');
    expect(tierFor('task://web/scrape-website')).toBe('smart');
    expect(tierFor('skill://made-up/future')).toBe('smart');
    expect(tierFor('')).toBe('smart');
  });
});

describe('toolPrefixesFor', () => {
  it('returns the configured prefixes for a known skill', () => {
    expect(toolPrefixesFor('skill://kb/review-content')).toEqual(['conv_', 'kb_']);
  });
  it('returns undefined for unmapped URIs', () => {
    expect(toolPrefixesFor('task://web/scrape-website')).toBeUndefined();
    expect(toolPrefixesFor('skill://unknown/x')).toBeUndefined();
  });
});

describe('priorityFor', () => {
  it('prioritizes the interactive website import above background work', () => {
    expect(priorityFor('task://web/scrape-website')).toBe(100);
  });
  it('defaults background jobs to 0', () => {
    expect(priorityFor('skill://kb/review-content')).toBe(0);
    expect(priorityFor('skill://crm/clean-contact-data')).toBe(0);
    expect(priorityFor('skill://made-up/future')).toBe(0);
    expect(priorityFor('')).toBe(0);
  });
});

describe('KNOWN_SKILL_URIS', () => {
  it('only contains skill:// URIs', () => {
    for (const uri of KNOWN_SKILL_URIS) expect(uri.startsWith('skill://')).toBe(true);
  });
});
