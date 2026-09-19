import { describe, expect, it } from 'vitest';
import {
  isOrgId,
  orgDashboardPath,
  parseOrgDashboardPath,
  stripOrgDashboardPath,
} from './org-scope.ts';

const ORG = 'org_0123456789abcdefghijkl';
const OTHER = 'org_zyxwvutsrqponmlkjihgf';

describe('isOrgId', () => {
  it('accepts a generated org id and rejects near misses', () => {
    expect(isOrgId(ORG)).toBe(true);
    expect(isOrgId('org_short')).toBe(false);
    expect(isOrgId('usr_0123456789abcdefghijkl')).toBe(false);
    expect(isOrgId(`${ORG}/review`)).toBe(false);
  });
});

describe('orgDashboardPath', () => {
  it('puts the org ahead of /dashboard, narrowing scope like the locale prefix', () => {
    expect(orgDashboardPath('/dashboard', ORG)).toBe(`/o/${ORG}/dashboard`);
    expect(orgDashboardPath('/dashboard/review/spd_1', ORG)).toBe(
      `/o/${ORG}/dashboard/review/spd_1`,
    );
  });

  it('keeps query and hash after the rewritten path', () => {
    expect(orgDashboardPath('/dashboard/settings?tab=team', ORG)).toBe(
      `/o/${ORG}/dashboard/settings?tab=team`,
    );
    expect(orgDashboardPath('/dashboard/review#top', ORG)).toBe(`/o/${ORG}/dashboard/review#top`);
  });

  it('leaves non-dashboard paths and invalid org ids alone', () => {
    expect(orgDashboardPath('/setup', ORG)).toBe('/setup');
    expect(orgDashboardPath('/dashboards/x', ORG)).toBe('/dashboards/x');
    expect(orgDashboardPath('/dashboard/review', 'not-an-org')).toBe('/dashboard/review');
  });

  it('is idempotent so an already-scoped href is never double-prefixed', () => {
    const once = orgDashboardPath('/dashboard/review/spd_1', ORG);
    expect(orgDashboardPath(once, ORG)).toBe(once);
    expect(orgDashboardPath(once, OTHER)).toBe(once);
  });
});

describe('parseOrgDashboardPath', () => {
  it('splits the org back off the front of the path', () => {
    expect(parseOrgDashboardPath(`/o/${ORG}/dashboard/review/spd_1`)).toEqual({
      orgId: ORG,
      path: '/dashboard/review/spd_1',
    });
    expect(parseOrgDashboardPath(`/o/${ORG}/dashboard`)).toEqual({
      orgId: ORG,
      path: '/dashboard',
    });
  });

  it('returns null for unscoped paths and malformed org segments', () => {
    expect(parseOrgDashboardPath('/dashboard/review/spd_1')).toBeNull();
    expect(parseOrgDashboardPath('/o/nope/dashboard/review')).toBeNull();
    expect(parseOrgDashboardPath('/o/not-an-org/dashboard')).toBeNull();
  });

  it('round-trips with orgDashboardPath including query strings', () => {
    const scoped = orgDashboardPath('/dashboard/conversations/cnv_1?filter=open', ORG);
    expect(parseOrgDashboardPath(scoped)).toEqual({
      orgId: ORG,
      path: '/dashboard/conversations/cnv_1?filter=open',
    });
  });
});

describe('stripOrgDashboardPath', () => {
  it('returns the unscoped path unchanged', () => {
    expect(stripOrgDashboardPath('/dashboard/review')).toBe('/dashboard/review');
    expect(stripOrgDashboardPath(`/o/${ORG}/dashboard/review`)).toBe('/dashboard/review');
  });
});
