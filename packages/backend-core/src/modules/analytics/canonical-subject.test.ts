import { describe, it, expect } from 'vitest';
import { canonicalizeSubjectId } from './canonical-subject.ts';

const off = { locales: [], stripTrailingSlash: false };

describe('canonicalizeSubjectId', () => {
  it('is a no-op with default settings', () => {
    expect(canonicalizeSubjectId('/en/pricing', off)).toBe('/en/pricing');
    expect(canonicalizeSubjectId('/', off)).toBe('/');
  });

  it('strips a configured locale prefix', () => {
    const opts = { locales: ['en', 'nb'], stripTrailingSlash: false };
    expect(canonicalizeSubjectId('/en/pricing', opts)).toBe('/pricing');
    expect(canonicalizeSubjectId('/nb/pricing', opts)).toBe('/pricing');
    expect(canonicalizeSubjectId('/en', opts)).toBe('/');
    expect(canonicalizeSubjectId('/en/', opts)).toBe('/');
  });

  it('leaves non-locale first segments alone', () => {
    const opts = { locales: ['en'], stripTrailingSlash: false };
    expect(canonicalizeSubjectId('/english/pricing', opts)).toBe('/english/pricing');
    expect(canonicalizeSubjectId('/pricing/en', opts)).toBe('/pricing/en');
  });

  it('matches locales case-insensitively and tolerates padded config', () => {
    const opts = { locales: [' EN ', '', 'nb-NO'], stripTrailingSlash: false };
    expect(canonicalizeSubjectId('/EN/pricing', opts)).toBe('/pricing');
    expect(canonicalizeSubjectId('/nb-no/pricing', opts)).toBe('/pricing');
  });

  it('strips trailing slashes without eating the root', () => {
    const opts = { locales: [], stripTrailingSlash: true };
    expect(canonicalizeSubjectId('/pricing/', opts)).toBe('/pricing');
    expect(canonicalizeSubjectId('/pricing///', opts)).toBe('/pricing');
    expect(canonicalizeSubjectId('/', opts)).toBe('/');
  });

  it('collapses a locale-root redirect onto the site root', () => {
    const opts = { locales: ['en'], stripTrailingSlash: true };
    expect(canonicalizeSubjectId('/en/', opts)).toBe('/');
    expect(canonicalizeSubjectId('/', opts)).toBe('/');
  });

  it('never rewrites ids that are not path-shaped', () => {
    const opts = { locales: ['en'], stripTrailingSlash: true };
    expect(canonicalizeSubjectId('signup-cta-click', opts)).toBe('signup-cta-click');
    expect(canonicalizeSubjectId('en/pricing/', opts)).toBe('en/pricing/');
    expect(canonicalizeSubjectId('cme_abc123', opts)).toBe('cme_abc123');
  });
});
