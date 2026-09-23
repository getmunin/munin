import { describe, expect, it } from 'vitest';
import {
  hasFailedSenderAuth,
  identityProvenance,
  isSelfReportedIdentity,
  latestEndUserTurn,
  provenSenderMetadata,
} from './identity-provenance.ts';

const verified = (email = 'ola@example.test') => ({
  authorType: 'end_user',
  metadata: provenSenderMetadata('pass', email),
});
const unverified = (email = 'ola@example.test') => ({
  authorType: 'end_user',
  metadata: provenSenderMetadata('fail', email),
});
const agentReply = { authorType: 'agent', metadata: {} };

describe('provenSenderMetadata', () => {
  it('records the proven address only alongside a pass', () => {
    expect(provenSenderMetadata('pass', ' Ola@Example.test ')).toEqual({
      senderAuth: 'pass',
      provenEmail: 'ola@example.test',
    });
    expect(provenSenderMetadata('fail', 'ola@example.test')).toEqual({ senderAuth: 'fail' });
    expect(provenSenderMetadata('unknown', 'ola@example.test')).toEqual({ senderAuth: 'unknown' });
  });
});

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

describe('hasFailedSenderAuth', () => {
  it('flags a turn containing a message that failed DMARC', () => {
    expect(hasFailedSenderAuth([unverified(), agentReply])).toBe(true);
    expect(hasFailedSenderAuth([verified(), unverified(), agentReply])).toBe(true);
  });

  it('does not flag a passing turn or one with no verdict at all', () => {
    expect(hasFailedSenderAuth([verified(), agentReply])).toBe(false);
    expect(hasFailedSenderAuth([{ authorType: 'end_user', metadata: {} }])).toBe(false);
    expect(hasFailedSenderAuth([{ authorType: 'end_user', metadata: null }])).toBe(false);
    expect(
      hasFailedSenderAuth([{ authorType: 'end_user', metadata: { senderAuth: 'unknown' } }]),
    ).toBe(false);
  });

  it('looks only at the latest turn, so an answered failure does not block a later genuine message', () => {
    expect(hasFailedSenderAuth([verified(), agentReply, unverified()])).toBe(false);
  });

  it('does not flag a conversation where the customer has not written', () => {
    expect(hasFailedSenderAuth([agentReply])).toBe(false);
    expect(hasFailedSenderAuth([])).toBe(false);
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
