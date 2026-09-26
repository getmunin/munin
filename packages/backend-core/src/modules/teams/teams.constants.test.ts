import { describe, it, expect } from 'vitest';
import {
  isAllowedServiceUrl,
  parseThreadConversationId,
  threadConversationId,
} from './teams.constants.ts';

const CHANNEL = '19:abc@thread.tacv2';

function withUserInfo(raw: string): string {
  const url = new URL(raw);
  url.username = 'operator';
  url.password = 'hunter2';
  return url.toString();
}

describe('isAllowedServiceUrl', () => {
  it.each([
    'https://smba.trafficmanager.net/teams/',
    'https://smba.trafficmanager.net/emea/',
    'https://smba.infra.gcc.teams.microsoft.com/teams',
    'https://smba.infra.gov.teams.microsoft.us/teams',
    'https://smba.infra.dod.teams.microsoft.us/teams',
  ])('allows the Bot Connector endpoint %s', (url) => {
    expect(isAllowedServiceUrl(url)).toBe(true);
  });

  it.each([
    'http://smba.trafficmanager.net/teams/',
    'https://smba.trafficmanager.net.attacker.test/teams/',
    'https://attacker.test/smba.trafficmanager.net/',
    withUserInfo('https://smba.trafficmanager.net/teams/'),
    'https://smba.trafficmanager.net:8443/teams/',
    'not a url',
    '',
    42,
  ])('refuses %s so the bot token is never sent elsewhere', (url) => {
    expect(isAllowedServiceUrl(url)).toBe(false);
  });
});

describe('thread conversation ids', () => {
  it('round-trips a channel id and root activity id', () => {
    const id = threadConversationId(CHANNEL, '1700000000001');
    expect(id).toBe(`${CHANNEL};messageid=1700000000001`);
    expect(parseThreadConversationId(id)).toEqual({
      channelId: CHANNEL,
      rootActivityId: '1700000000001',
    });
  });

  it('reads a bare channel id as a top-level post', () => {
    expect(parseThreadConversationId(CHANNEL)).toEqual({ channelId: CHANNEL, rootActivityId: null });
  });
});
