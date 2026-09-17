import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  EXPIRY_WARNING_MS,
  expiresSoon,
  signSocialState,
  toAccountDto,
  verifySocialState,
} from './social-accounts.service.ts';

const DAY = 24 * 60 * 60 * 1000;

type AccountRow = Parameters<typeof toAccountDto>[0];

function row(overrides: Partial<AccountRow> = {}): AccountRow {
  return {
    id: 'sac_1',
    orgId: 'org_1',
    userId: 'usr_1',
    platform: 'linkedin',
    authorKind: 'member',
    externalAccountId: 'urn-sub',
    displayName: 'Ola Nordmann',
    encryptedAccessToken: 'ct-access',
    accessTokenExpiresAt: new Date('2026-11-16T00:00:00.000Z'),
    encryptedRefreshToken: null,
    refreshTokenExpiresAt: null,
    scopes: ['w_member_social'],
    status: 'active',
    lastError: null,
    connectedAt: new Date('2026-09-17T00:00:00.000Z'),
    createdAt: new Date('2026-09-17T00:00:00.000Z'),
    updatedAt: new Date('2026-09-17T00:00:00.000Z'),
    ...overrides,
  };
}

describe('social authorize state', () => {
  const previous = process.env.MUNIN_AUTH_SECRET;
  beforeAll(() => {
    process.env.MUNIN_AUTH_SECRET = 'test-secret';
  });
  afterAll(() => {
    if (previous === undefined) delete process.env.MUNIN_AUTH_SECRET;
    else process.env.MUNIN_AUTH_SECRET = previous;
  });

  it('round-trips the org, the person and the platform', () => {
    const exp = Date.now() + 60_000;
    const signed = signSocialState({ orgId: 'org_1', userId: 'usr_1', platform: 'linkedin', exp });
    expect(verifySocialState(signed)).toEqual({
      orgId: 'org_1',
      userId: 'usr_1',
      platform: 'linkedin',
      exp,
    });
  });

  it('rejects a tampered state, so a callback cannot bind a grant to another org', () => {
    const signed = signSocialState({
      orgId: 'org_1',
      userId: 'usr_1',
      platform: 'linkedin',
      exp: Date.now() + 60_000,
    });
    const forged = Buffer.from(
      JSON.stringify({ orgId: 'org_2', userId: 'usr_1', platform: 'linkedin', exp: Date.now() + 60_000 }),
    ).toString('base64url');
    expect(verifySocialState(`${forged}.${signed.split('.')[1]}`)).toBeNull();
  });

  it('rejects an unknown platform rather than trusting the callback to name one', () => {
    const signed = signSocialState({
      orgId: 'org_1',
      userId: 'usr_1',
      platform: 'mastodon' as 'linkedin',
      exp: Date.now() + 60_000,
    });
    expect(verifySocialState(signed)).toBeNull();
  });
});

describe('expiresSoon', () => {
  const now = Date.parse('2026-09-17T00:00:00.000Z');

  it('is true inside the warning window and false outside it', () => {
    expect(expiresSoon({ accessTokenExpiresAt: new Date(now + 3 * DAY) }, EXPIRY_WARNING_MS, now)).toBe(true);
    expect(expiresSoon({ accessTokenExpiresAt: new Date(now + 30 * DAY) }, EXPIRY_WARNING_MS, now)).toBe(false);
  });

  it('is false when nothing expires, rather than warning about an unknown', () => {
    expect(expiresSoon({ accessTokenExpiresAt: null }, EXPIRY_WARNING_MS, now)).toBe(false);
  });
});

describe('toAccountDto', () => {
  it('never carries a token out of the service', () => {
    const dto = toAccountDto(row());
    const serialised = JSON.stringify(dto);
    expect(serialised).not.toContain('ct-access');
    expect(Object.keys(dto)).not.toContain('encryptedAccessToken');
    expect(Object.keys(dto)).not.toContain('encryptedRefreshToken');
  });

  it('reports canRefresh false for a self-serve grant, which is what the dashboard warns on', () => {
    expect(toAccountDto(row()).canRefresh).toBe(false);
    expect(toAccountDto(row({ encryptedRefreshToken: 'ct-refresh' })).canRefresh).toBe(true);
  });
});
