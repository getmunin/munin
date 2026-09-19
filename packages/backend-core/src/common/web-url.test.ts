import { afterEach, describe, expect, it } from 'vitest';
import {
  absoluteWebUrl,
  dashboardUrl,
  readWebBaseUrl,
  registerOrgScopedDashboard,
} from './web-url.ts';

const ORG = 'org_0123456789abcdefghijkl';
const previous = process.env.MUNIN_WEB_URL;

afterEach(() => {
  if (previous === undefined) delete process.env.MUNIN_WEB_URL;
  else process.env.MUNIN_WEB_URL = previous;
  registerOrgScopedDashboard(false);
});

describe('readWebBaseUrl', () => {
  it('trims trailing slashes so joins never double up', () => {
    process.env.MUNIN_WEB_URL = 'https://app.example.com//';
    expect(readWebBaseUrl()).toBe('https://app.example.com');
  });
});

describe('dashboardUrl', () => {
  it('stays flat by default, because a single-org deployment has nothing to disambiguate', () => {
    process.env.MUNIN_WEB_URL = 'https://app.example.com';
    expect(dashboardUrl(ORG, '/settings/privacy')).toBe(
      'https://app.example.com/dashboard/settings/privacy',
    );
  });

  it('names the org once a deployment registers org-scoped routes', () => {
    process.env.MUNIN_WEB_URL = 'https://app.example.com';
    registerOrgScopedDashboard(true);
    expect(dashboardUrl(ORG, '/settings/privacy')).toBe(
      `https://app.example.com/o/${ORG}/dashboard/settings/privacy`,
    );
  });
});

describe('absoluteWebUrl', () => {
  it('turns a stored relative alert cta into a link an email client can follow', () => {
    process.env.MUNIN_WEB_URL = 'https://app.example.com';
    expect(absoluteWebUrl('/dashboard/settings/privacy', ORG)).toBe(
      'https://app.example.com/dashboard/settings/privacy',
    );
  });

  it('scopes the alert cta to the alerting org where routes are org-scoped', () => {
    process.env.MUNIN_WEB_URL = 'https://app.example.com';
    registerOrgScopedDashboard(true);
    expect(absoluteWebUrl('/dashboard/settings/privacy', ORG)).toBe(
      `https://app.example.com/o/${ORG}/dashboard/settings/privacy`,
    );
  });

  it('leaves a non-dashboard path absolute but unscoped', () => {
    process.env.MUNIN_WEB_URL = 'https://app.example.com';
    expect(absoluteWebUrl('/connect/credentials', ORG)).toBe(
      'https://app.example.com/connect/credentials',
    );
  });

  it('passes an already absolute url through untouched', () => {
    process.env.MUNIN_WEB_URL = 'https://app.example.com';
    expect(absoluteWebUrl('https://elsewhere.example/docs', ORG)).toBe(
      'https://elsewhere.example/docs',
    );
  });

  it('refuses anything that is not a rooted path, so no scheme-relative smuggling', () => {
    process.env.MUNIN_WEB_URL = 'https://app.example.com';
    expect(absoluteWebUrl('dashboard/settings', ORG)).toBeNull();
    expect(absoluteWebUrl('javascript:alert(1)', ORG)).toBeNull();
    expect(absoluteWebUrl('', ORG)).toBeNull();
  });
});
