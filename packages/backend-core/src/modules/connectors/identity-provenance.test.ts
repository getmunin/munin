import { describe, expect, it } from 'vitest';
import {
  identityProvenance,
  isProvenEmailTurn,
  isSelfReportedIdentity,
  latestEndUserTurn,
} from './identity-provenance.ts';

const verified = (email = 'ola@example.test') => ({
  authorType: 'end_user',
  authorEmail: email,
  metadata: { senderAuth: 'pass' },
});
const unverified = (email = 'ola@example.test') => ({
  authorType: 'end_user',
  authorEmail: email,
  metadata: { senderAuth: 'fail' },
});
const agentReply = { authorType: 'agent', authorEmail: null, metadata: {} };

describe('latestEndUserTurn', () => {
  it('collects the newest contiguous run of customer messages', () => {
    const a = verified();
    const b = unverified();
    expect(latestEndUserTurn([a, b, agentReply, verified()])).toEqual([a, b]);
  });

  it('reaches past a reply the agent already sent to the run it answered', () => {
    const a = verified();
    expect(latestEndUserTurn([agentReply, a, agentReply, unverified()])).toEqual([a]);
  });

  it('is empty when the customer has not written', () => {
    expect(latestEndUserTurn([agentReply])).toEqual([]);
    expect(latestEndUserTurn([])).toEqual([]);
  });
});

describe('isProvenEmailTurn', () => {
  it('accepts a turn whose every message passed DMARC for the booking address', () => {
    expect(isProvenEmailTurn([verified(), verified(), agentReply], 'OLA@example.test')).toBe(true);
  });

  it('rejects a forgery that lands in the same turn as a genuine message', () => {
    expect(isProvenEmailTurn([verified(), unverified(), agentReply], 'ola@example.test')).toBe(false);
    expect(isProvenEmailTurn([unverified(), verified()], 'ola@example.test')).toBe(false);
  });

  it('ignores a verified message from an earlier turn once a forgery is the latest', () => {
    expect(isProvenEmailTurn([unverified(), agentReply, verified()], 'ola@example.test')).toBe(false);
  });

  it('rejects a verified message from a different sender than the booking address', () => {
    expect(isProvenEmailTurn([verified('kari@example.test')], 'ola@example.test')).toBe(false);
  });

  it('rejects messages that predate the verdict or carry none', () => {
    expect(
      isProvenEmailTurn(
        [{ authorType: 'end_user', authorEmail: 'ola@example.test', metadata: {} }],
        'ola@example.test',
      ),
    ).toBe(false);
    expect(
      isProvenEmailTurn(
        [{ authorType: 'end_user', authorEmail: 'ola@example.test', metadata: null }],
        'ola@example.test',
      ),
    ).toBe(false);
  });

  it('rejects when there is no customer turn at all', () => {
    expect(isProvenEmailTurn([agentReply], 'ola@example.test')).toBe(false);
    expect(isProvenEmailTurn([], 'ola@example.test')).toBe(false);
  });
});

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
