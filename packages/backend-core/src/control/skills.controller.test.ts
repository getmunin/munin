import { describe, expect, it } from 'vitest';
import { tierFor } from './skills.controller.js';

describe('tierFor', () => {
  it('routes strip-email-signature to the fast tier', () => {
    expect(tierFor('skill://conv/strip-email-signature')).toBe('fast');
  });

  it('routes every other skill to the smart tier by default', () => {
    expect(tierFor('skill://crm/contact-extract')).toBe('smart');
    expect(tierFor('skill://crm/hygiene')).toBe('smart');
    expect(tierFor('skill://kb/curation')).toBe('smart');
    expect(tierFor('skill://outreach/draft-reply')).toBe('smart');
  });

  it('routes unknown / not-yet-existing skill URIs to smart', () => {
    expect(tierFor('skill://made-up/future-skill')).toBe('smart');
    expect(tierFor('')).toBe('smart');
  });
});
