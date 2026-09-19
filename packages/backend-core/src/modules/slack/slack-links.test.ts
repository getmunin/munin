import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { conversationUrl, dashboardUrl, reviewListUrl, reviewUrl } from './slack.constants.ts';
import { registerOrgScopedDashboard } from '../../common/web-url.ts';

const ORG = 'org_0123456789abcdefghijkl';
const OTHER_ORG = 'org_zyxwvutsrqponmlkjihgf';
const previous = process.env.MUNIN_WEB_URL;

afterEach(() => {
  if (previous === undefined) delete process.env.MUNIN_WEB_URL;
  else process.env.MUNIN_WEB_URL = previous;
  registerOrgScopedDashboard(false);
});

describe('slack dashboard links on a single-org deployment', () => {
  it('links straight at the item, with no org segment to disambiguate', () => {
    process.env.MUNIN_WEB_URL = 'https://app.example.com';
    expect(reviewUrl(ORG, 'spd_1')).toBe('https://app.example.com/dashboard/review/spd_1');
    expect(conversationUrl(ORG, 'cnv_1')).toBe(
      'https://app.example.com/dashboard/conversations/cnv_1',
    );
  });
});

describe('slack dashboard links where routes are org-scoped', () => {
  beforeEach(() => {
    registerOrgScopedDashboard(true);
  });

  it('scopes every link to the org the card was posted for', () => {
    process.env.MUNIN_WEB_URL = 'https://app.example.com';
    expect(dashboardUrl(ORG)).toBe(`https://app.example.com/o/${ORG}/dashboard`);
    expect(reviewListUrl(ORG)).toBe(`https://app.example.com/o/${ORG}/dashboard/review`);
    expect(reviewUrl(ORG, 'spd_1')).toBe(`https://app.example.com/o/${ORG}/dashboard/review/spd_1`);
    expect(conversationUrl(ORG, 'cnv_1')).toBe(
      `https://app.example.com/o/${ORG}/dashboard/conversations/cnv_1`,
    );
  });

  it('separates two orgs sharing one Slack workspace', () => {
    process.env.MUNIN_WEB_URL = 'https://app.example.com';
    expect(reviewUrl(ORG, 'spd_1')).not.toBe(reviewUrl(OTHER_ORG, 'spd_1'));
  });

  it('drops a trailing slash on the configured web url', () => {
    process.env.MUNIN_WEB_URL = 'https://app.example.com/';
    expect(reviewListUrl(ORG)).toBe(`https://app.example.com/o/${ORG}/dashboard/review`);
  });

  it('percent-encodes ids so a hostile id cannot escape the path', () => {
    process.env.MUNIN_WEB_URL = 'https://app.example.com';
    expect(reviewUrl(ORG, '../../settings/api-keys')).toBe(
      `https://app.example.com/o/${ORG}/dashboard/review/..%2F..%2Fsettings%2Fapi-keys`,
    );
  });
});
