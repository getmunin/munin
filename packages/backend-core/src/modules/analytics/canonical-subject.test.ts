import { describe, it, expect } from 'vitest';
import { canonicalizeSubjectId } from './canonical-subject.ts';

describe('canonicalizeSubjectId', () => {
  it('always folds trailing slashes without eating the root', () => {
    expect(canonicalizeSubjectId('/pricing/')).toBe('/pricing');
    expect(canonicalizeSubjectId('/pricing///')).toBe('/pricing');
    expect(canonicalizeSubjectId('/')).toBe('/');
    expect(canonicalizeSubjectId('/pricing')).toBe('/pricing');
  });

  it('strips a first segment that matches the page locale', () => {
    expect(canonicalizeSubjectId('/en/pricing', { locale: 'en' })).toBe('/pricing');
    expect(canonicalizeSubjectId('/en/pricing', { locale: 'en-US' })).toBe('/pricing');
    expect(canonicalizeSubjectId('/EN/pricing', { locale: 'en-us' })).toBe('/pricing');
    expect(canonicalizeSubjectId('/en-us/pricing', { locale: 'en-US' })).toBe('/pricing');
    expect(canonicalizeSubjectId('/nb/priser', { locale: 'nb-NO' })).toBe('/priser');
  });

  it('collapses a locale root onto the site root', () => {
    expect(canonicalizeSubjectId('/en/', { locale: 'en-US' })).toBe('/');
    expect(canonicalizeSubjectId('/en', { locale: 'en' })).toBe('/');
  });

  it('leaves segments that only look like the locale alone', () => {
    expect(canonicalizeSubjectId('/enterprise/pricing', { locale: 'en' })).toBe(
      '/enterprise/pricing',
    );
    expect(canonicalizeSubjectId('/pricing/en', { locale: 'en' })).toBe('/pricing/en');
    expect(canonicalizeSubjectId('/uk/pricing', { locale: 'en-GB' })).toBe('/uk/pricing');
  });

  it('strips nothing when the page reports no locale', () => {
    expect(canonicalizeSubjectId('/en/pricing')).toBe('/en/pricing');
    expect(canonicalizeSubjectId('/en/pricing', { locale: '' })).toBe('/en/pricing');
    expect(canonicalizeSubjectId('/en/pricing', { locale: null })).toBe('/en/pricing');
  });

  it('honors overrides for prefixes that disagree with the lang tag', () => {
    const ctx = { locale: 'nb-NO', localeOverrides: ['no', 'en'] };
    expect(canonicalizeSubjectId('/no/priser', ctx)).toBe('/priser');
    expect(canonicalizeSubjectId('/en/pricing', ctx)).toBe('/pricing');
    expect(canonicalizeSubjectId('/nb/priser', ctx)).toBe('/priser');
  });

  it('tolerates padded and empty override entries', () => {
    const ctx = { localeOverrides: [' NO ', '', 'zh-hans'] };
    expect(canonicalizeSubjectId('/no/priser', ctx)).toBe('/priser');
    expect(canonicalizeSubjectId('/zh-Hans/pricing', ctx)).toBe('/pricing');
    expect(canonicalizeSubjectId('/pricing', ctx)).toBe('/pricing');
  });

  it('never rewrites ids that are not path-shaped', () => {
    const ctx = { locale: 'en', localeOverrides: ['en'] };
    expect(canonicalizeSubjectId('signup-cta-click', ctx)).toBe('signup-cta-click');
    expect(canonicalizeSubjectId('en/pricing/', ctx)).toBe('en/pricing/');
    expect(canonicalizeSubjectId('cme_abc123', ctx)).toBe('cme_abc123');
  });
});
