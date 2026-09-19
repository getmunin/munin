import { describe, expect, it } from 'vitest';
import {
  defaultOrgId,
  needsOrgSegment,
  orgScopedDashboardPathname,
  setupPathFor,
  splitLocalePrefix,
} from './setup-gate';
import { signInHrefFor } from './auth/post-signin-redirect';

const LOCALES = ['en', 'nb'] as const;
const ORG = 'org_0123456789abcdefghijkl';

describe('splitLocalePrefix', () => {
  it('separates a known locale prefix from the dashboard path', () => {
    expect(splitLocalePrefix('/en/dashboard/review', LOCALES)).toEqual({
      prefix: '/en',
      rest: '/dashboard/review',
    });
    expect(splitLocalePrefix('/dashboard/review', LOCALES)).toEqual({
      prefix: '',
      rest: '/dashboard/review',
    });
  });

  it('does not treat an unknown prefix as a locale', () => {
    expect(splitLocalePrefix('/de/dashboard/review', LOCALES)).toEqual({
      prefix: '',
      rest: '/de/dashboard/review',
    });
  });
});

describe('needsOrgSegment', () => {
  it('is false on a single-org deployment, whatever the path', () => {
    expect(needsOrgSegment('/en/dashboard', LOCALES, false)).toBe(false);
    expect(needsOrgSegment('/en/dashboard/review/spd_1', LOCALES, false)).toBe(false);
  });

  it('is true for a legacy dashboard path and false once scoped', () => {
    expect(needsOrgSegment('/en/dashboard', LOCALES)).toBe(true);
    expect(needsOrgSegment('/en/dashboard/review/spd_1', LOCALES)).toBe(true);
    expect(needsOrgSegment(`/en/o/${ORG}/dashboard/review/spd_1`, LOCALES)).toBe(false);
  });

  it('is false outside the dashboard tree', () => {
    expect(needsOrgSegment('/en/setup', LOCALES)).toBe(false);
    expect(needsOrgSegment('/en/docs/skills', LOCALES)).toBe(false);
  });
});

describe('orgScopedDashboardPathname', () => {
  it('rewrites a legacy link while keeping the locale prefix', () => {
    expect(orgScopedDashboardPathname('/en/dashboard/review/spd_1', ORG, LOCALES)).toBe(
      `/en/o/${ORG}/dashboard/review/spd_1`,
    );
    expect(orgScopedDashboardPathname('/nb/dashboard', ORG, LOCALES)).toBe(
      `/nb/o/${ORG}/dashboard`,
    );
  });

  it('returns null when the path is already scoped, so the middleware does not loop', () => {
    expect(
      orgScopedDashboardPathname(`/en/o/${ORG}/dashboard/review`, ORG, LOCALES),
    ).toBeNull();
  });
});

describe('setupPathFor', () => {
  it('drops the org segment along with the dashboard path', () => {
    expect(setupPathFor(`/en/o/${ORG}/dashboard/review`)).toBe('/en/setup');
    expect(setupPathFor(`/nb/o/${ORG}/dashboard`)).toBe('/nb/setup');
  });

  it('leaves a lookalike segment that is not an org id in place', () => {
    expect(setupPathFor('/en/o/not-an-org/dashboard')).toBe('/en/o/not-an-org/setup');
  });
});

describe('defaultOrgId', () => {
  it('prefers the default membership, then the first, then nothing', () => {
    const rows = [
      { orgId: 'org_a', name: 'A', role: 'admin', isDefault: false },
      { orgId: 'org_b', name: 'B', role: 'owner', isDefault: true },
    ];
    expect(defaultOrgId(rows)).toBe('org_b');
    expect(defaultOrgId([rows[0]!])).toBe('org_a');
    expect(defaultOrgId([])).toBeNull();
    expect(defaultOrgId(null)).toBeNull();
  });
});

describe('signed-out legacy links', () => {
  it('keeps the destination when a legacy dashboard path has no session to resolve an org', () => {
    const { rest } = splitLocalePrefix('/en/dashboard/review/spd_1', LOCALES);
    expect(signInHrefFor(rest)).toBe(
      `/login?redirect=${encodeURIComponent('/dashboard/review/spd_1')}`,
    );
  });
});
