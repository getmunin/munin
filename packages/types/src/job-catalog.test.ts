import { describe, expect, it } from 'vitest';
import {
  KNOWN_SKILL_URIS,
  KNOWN_TASK_URIS,
  jobKindOf,
  tierFor,
  toolPrefixesFor,
} from './job-catalog.js';

describe('jobKindOf', () => {
  it('classifies skill:// URIs as skill', () => {
    expect(jobKindOf('skill://kb/curation')).toBe('skill');
  });
  it('classifies task:// URIs as task', () => {
    expect(jobKindOf('task://web/scrape-site')).toBe('task');
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
    expect(tierFor('skill://crm/hygiene')).toBe('smart');
    expect(tierFor('task://web/scrape-site')).toBe('smart');
    expect(tierFor('skill://made-up/future')).toBe('smart');
    expect(tierFor('')).toBe('smart');
  });
});

describe('toolPrefixesFor', () => {
  it('returns the configured prefixes for a known skill', () => {
    expect(toolPrefixesFor('skill://kb/curation')).toEqual(['conv_', 'kb_']);
  });
  it('returns undefined for unmapped URIs', () => {
    expect(toolPrefixesFor('task://web/scrape-site')).toBeUndefined();
    expect(toolPrefixesFor('skill://unknown/x')).toBeUndefined();
  });
});

describe('known URI sets', () => {
  it('separates skill vs task URIs by scheme', () => {
    for (const uri of KNOWN_SKILL_URIS) expect(uri.startsWith('skill://')).toBe(true);
    for (const uri of KNOWN_TASK_URIS) expect(uri.startsWith('task://')).toBe(true);
  });
});
