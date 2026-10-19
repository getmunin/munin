import { describe, it, expect } from 'vitest';
import type { SlackUserInfo } from './slack-api.client.ts';
import { belongsToWorkspace, eligibleForEmailLink } from './slack-user-mapping.service.ts';

const TEAM = 'T_HOME';

function user(overrides: Partial<SlackUserInfo> = {}): SlackUserInfo {
  return {
    id: 'U_ONE',
    email: 'kari@example.com',
    displayName: 'Kari Nordmann',
    isBot: false,
    teamId: TEAM,
    enterpriseTeamIds: [],
    deleted: false,
    isStranger: false,
    isRestricted: false,
    isUltraRestricted: false,
    ...overrides,
  };
}

describe('eligibleForEmailLink', () => {
  it('links a full member of the connected workspace with a profile email', () => {
    expect(eligibleForEmailLink(user(), TEAM)).toBe(true);
  });

  it('refuses a user whose home workspace is another team, as a Slack Connect partner is', () => {
    expect(eligibleForEmailLink(user({ teamId: 'T_PARTNER' }), TEAM)).toBe(false);
  });

  it('refuses a user Slack marks as a stranger even when the team id matches', () => {
    expect(eligibleForEmailLink(user({ isStranger: true }), TEAM)).toBe(false);
  });

  it('refuses single- and multi-channel guests', () => {
    expect(eligibleForEmailLink(user({ isRestricted: true }), TEAM)).toBe(false);
    expect(eligibleForEmailLink(user({ isUltraRestricted: true }), TEAM)).toBe(false);
  });

  it('refuses bots, deactivated accounts and profiles without an email', () => {
    expect(eligibleForEmailLink(user({ isBot: true }), TEAM)).toBe(false);
    expect(eligibleForEmailLink(user({ deleted: true }), TEAM)).toBe(false);
    expect(eligibleForEmailLink(user({ email: null }), TEAM)).toBe(false);
    expect(eligibleForEmailLink(user({ email: '  ' }), TEAM)).toBe(false);
  });

  it('refuses a user whose team cannot be read at all', () => {
    expect(eligibleForEmailLink(user({ teamId: null }), TEAM)).toBe(false);
  });

  it('links an Enterprise Grid member whose workspace list includes the connected team', () => {
    expect(
      eligibleForEmailLink(
        user({ teamId: 'T_OTHER_GRID_WORKSPACE', enterpriseTeamIds: ['T_OTHER_GRID_WORKSPACE', TEAM] }),
        TEAM,
      ),
    ).toBe(true);
  });
});

describe('belongsToWorkspace', () => {
  it('lets a guest an admin linked by hand keep acting inside the connected workspace', () => {
    expect(belongsToWorkspace(user({ isRestricted: true }), TEAM)).toBe(true);
  });

  it('never admits a user from another workspace, however they were linked', () => {
    expect(belongsToWorkspace(user({ teamId: 'T_PARTNER' }), TEAM)).toBe(false);
    expect(belongsToWorkspace(user({ isStranger: true }), TEAM)).toBe(false);
  });
});
