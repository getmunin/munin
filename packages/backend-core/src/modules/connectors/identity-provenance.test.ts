import { describe, expect, it } from 'vitest';
import { identityProvenance, isSelfReportedIdentity } from './identity-provenance.ts';

describe('isSelfReportedIdentity', () => {
  it('flags anonymous widget sessions and visitor-typed emails', () => {
    expect(isSelfReportedIdentity({ anonymous: true })).toBe(true);
    expect(isSelfReportedIdentity({ emailSource: 'visitor' })).toBe(true);
  });

  it('does not flag channel-ingested or org-asserted identities', () => {
    expect(isSelfReportedIdentity({ source: 'email-inbound' })).toBe(false);
    expect(isSelfReportedIdentity({})).toBe(false);
    expect(isSelfReportedIdentity(null)).toBe(false);
  });
});

describe('identityProvenance', () => {
  it('treats an identity-verified widget session as authenticated', () => {
    expect(identityProvenance({ channelType: 'chat', metadata: {} })).toBe('authenticated');
  });

  it('treats spoofable channel envelopes as channel_asserted', () => {
    for (const channelType of ['email', 'sms', 'voice']) {
      expect(identityProvenance({ channelType, metadata: {} })).toBe('channel_asserted');
    }
  });

  it('never reports authenticated for a turn that arrived over a spoofable channel, even when the end-user record was created by a verified widget session', () => {
    const recordFromVerifiedWidgetSession = {};
    expect(
      identityProvenance({ channelType: 'email', metadata: recordFromVerifiedWidgetSession }),
    ).toBe('channel_asserted');
  });

  it('keeps self_reported ahead of any channel signal', () => {
    expect(identityProvenance({ channelType: 'chat', metadata: { anonymous: true } })).toBe(
      'self_reported',
    );
    expect(identityProvenance({ channelType: 'email', metadata: { emailSource: 'visitor' } })).toBe(
      'self_reported',
    );
  });

  it('defaults to channel_asserted for unknown or missing channels rather than over-claiming', () => {
    expect(identityProvenance({ channelType: null, metadata: {} })).toBe('channel_asserted');
    expect(identityProvenance({ channelType: undefined, metadata: {} })).toBe('channel_asserted');
    expect(identityProvenance({ channelType: 'some-future-channel', metadata: {} })).toBe(
      'channel_asserted',
    );
  });

  it('is case- and whitespace-insensitive on the channel kind', () => {
    expect(identityProvenance({ channelType: ' Chat ', metadata: {} })).toBe('authenticated');
    expect(identityProvenance({ channelType: 'EMAIL', metadata: {} })).toBe('channel_asserted');
  });
});
