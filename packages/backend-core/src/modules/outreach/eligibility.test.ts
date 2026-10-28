import { describe, expect, it } from 'vitest';
import { assertEligible, type EligibilityFacts } from './eligibility.ts';

const reachable: EligibilityFacts = {
  id: 'ctc_1',
  doNotContact: false,
  unsubscribedAt: null,
  consentLawfulBasis: 'consent',
  deliverability: null,
};

describe('assertEligible', () => {
  it('lets transactional messages reach an unsubscribed contact without consent, but never one marked do-not-contact', () => {
    const unsubscribed = { ...reachable, unsubscribedAt: '2026-10-01T00:00:00.000Z', consentLawfulBasis: null };
    expect(() => assertEligible(unsubscribed, { class: 'transactional', channelType: 'email' })).not.toThrow();
    expect(() => assertEligible(unsubscribed, { class: 'marketing', channelType: 'email' })).toThrow(/no longer eligible/);
    expect(() => assertEligible({ ...reachable, doNotContact: true }, { class: 'transactional', channelType: 'sms' })).toThrow(
      /no longer eligible/,
    );
  });

  it('refuses email to an address known to bounce, on any channel class', () => {
    const bouncing = {
      ...reachable,
      deliverability: {
        address: 'ola@example.com',
        state: 'undeliverable',
        reason: 'hard_bounce',
        evidence: {},
        failureCount: 1,
        firstFailureAt: '2026-10-01T00:00:00.000Z',
        lastFailureAt: '2026-10-01T00:00:00.000Z',
        stateChangedAt: '2026-10-01T00:00:00.000Z',
        updatedAt: '2026-10-01T00:00:00.000Z',
      },
    } satisfies EligibilityFacts;
    expect(() => assertEligible(bouncing, { class: 'transactional', channelType: 'email' })).toThrow(/outreach_undeliverable/);
    expect(() => assertEligible(bouncing, { class: 'marketing', channelType: 'sms' })).not.toThrow();
  });
});
