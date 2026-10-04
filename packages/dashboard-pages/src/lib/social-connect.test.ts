import { describe, expect, it } from 'vitest';
import { isDashboardPath, withSocialOutcome } from './social-connect';

describe('isDashboardPath', () => {
  it('accepts a path on this origin, prefixed or not', () => {
    expect(isDashboardPath('/dashboard/review/qi_1')).toBe(true);
    expect(isDashboardPath('/nb/o/org_1/dashboard/review/qi_1?tab=waiting')).toBe(true);
  });

  it('refuses what a browser would resolve to another origin', () => {
    expect(isDashboardPath(null)).toBe(false);
    expect(isDashboardPath('https://evil.example/')).toBe(false);
    expect(isDashboardPath('//evil.example/')).toBe(false);
    expect(isDashboardPath('/\\evil.example/')).toBe(false);
  });
});

describe('withSocialOutcome', () => {
  it('reports the connection to the page the person came from', () => {
    expect(withSocialOutcome('/dashboard/review/qi_1', 'facebook')).toBe(
      '/dashboard/review/qi_1?social=connected&platform=facebook',
    );
    expect(withSocialOutcome('/dashboard/review?tab=waiting', 'linkedin')).toBe(
      '/dashboard/review?tab=waiting&social=connected&platform=linkedin',
    );
  });
});
