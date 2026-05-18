import { describe, it, expect } from 'vitest';
import {
  signUnsubscribeToken,
  verifyUnsubscribeToken,
  UnsubscribeTokenError,
} from './outreach-tokens.js';

const PEPPER = 'test-pepper-do-not-use-in-prod';

describe('unsubscribe tokens', () => {
  it('round-trips a signed token', () => {
    const token = signUnsubscribeToken(
      { orgId: 'org_a', contactId: 'cct_b', campaignId: 'cmp_c' },
      PEPPER,
    );
    const payload = verifyUnsubscribeToken(token, PEPPER);
    expect(payload.orgId).toBe('org_a');
    expect(payload.contactId).toBe('cct_b');
    expect(payload.campaignId).toBe('cmp_c');
    expect(payload.issuedAt).toBeGreaterThan(0);
  });

  it('rejects a token signed with a different pepper', () => {
    const token = signUnsubscribeToken(
      { orgId: 'org_a', contactId: 'cct_b', campaignId: 'cmp_c' },
      PEPPER,
    );
    expect(() => verifyUnsubscribeToken(token, 'other-pepper')).toThrow(UnsubscribeTokenError);
  });

  it('rejects a tampered token', () => {
    const token = signUnsubscribeToken(
      { orgId: 'org_a', contactId: 'cct_b', campaignId: 'cmp_c' },
      PEPPER,
    );
    const tampered = token.replace('cct_b', 'cct_evil');
    expect(() => verifyUnsubscribeToken(tampered, PEPPER)).toThrow(UnsubscribeTokenError);
  });

  it('rejects a malformed token', () => {
    expect(() => verifyUnsubscribeToken('garbage', PEPPER)).toThrow(UnsubscribeTokenError);
    expect(() => verifyUnsubscribeToken('a.b.c', PEPPER)).toThrow(UnsubscribeTokenError);
  });

  it('rejects field values containing dots', () => {
    expect(() =>
      signUnsubscribeToken({ orgId: 'org.a', contactId: 'cct_b', campaignId: 'cmp_c' }, PEPPER),
    ).toThrow();
  });
});
