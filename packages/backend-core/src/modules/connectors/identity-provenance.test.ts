import { describe, expect, it } from 'vitest';
import {
  identityProvenance,
  isSelfReportedIdentity,
  latestEndUserTurn,
  latestTurnSenderAuthBlock,
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

describe('latestTurnSenderAuthBlock', () => {
  const forwarded = { authorType: 'end_user', metadata: provenSenderMetadata('forwarded', 'ola@example.test') };

  it('flags a turn containing a message that failed DMARC', () => {
    expect(latestTurnSenderAuthBlock([unverified(), agentReply])).toBe('fail');
    expect(latestTurnSenderAuthBlock([verified(), unverified(), agentReply])).toBe('fail');
  });

  it('flags a turn whose sender came from forwarded text rather than the envelope', () => {
    expect(latestTurnSenderAuthBlock([forwarded, agentReply])).toBe('forwarded');
    expect(latestTurnSenderAuthBlock([verified(), forwarded])).toBe('forwarded');
  });

  it('reports the failure over the forward when a turn carries both', () => {
    expect(latestTurnSenderAuthBlock([forwarded, unverified()])).toBe('fail');
  });

  it('does not flag a passing turn or one with no verdict at all', () => {
    expect(latestTurnSenderAuthBlock([verified(), agentReply])).toBeNull();
    expect(latestTurnSenderAuthBlock([{ authorType: 'end_user', metadata: {} }])).toBeNull();
    expect(latestTurnSenderAuthBlock([{ authorType: 'end_user', metadata: null }])).toBeNull();
    expect(
      latestTurnSenderAuthBlock([{ authorType: 'end_user', metadata: { senderAuth: 'unknown' } }]),
    ).toBeNull();
  });

  it('looks only at the latest turn, so an answered failure does not block a later genuine message', () => {
    expect(latestTurnSenderAuthBlock([verified(), agentReply, unverified()])).toBeNull();
    expect(latestTurnSenderAuthBlock([verified(), agentReply, forwarded])).toBeNull();
  });

  it('does not flag a conversation where the customer has not written', () => {
    expect(latestTurnSenderAuthBlock([agentReply])).toBeNull();
    expect(latestTurnSenderAuthBlock([])).toBeNull();
  });
});

describe('isSelfReportedIdentity', () => {
  const email = 'kari@example.com';

  it('flags anonymous widget sessions whether or not they carry an email', () => {
    expect(isSelfReportedIdentity({ email: null, metadata: { anonymous: true } })).toBe(true);
    expect(
      isSelfReportedIdentity({ email, metadata: { anonymous: true, emailSource: 'org-attested' } }),
    ).toBe(true);
  });

  it('trusts an email only from an allow-listed source', () => {
    for (const emailSource of ['org-attested', 'channel', 'legacy']) {
      expect(isSelfReportedIdentity({ email, metadata: { emailSource } })).toBe(false);
    }
  });

  it('fails closed on an email whose source is visitor, unknown or missing', () => {
    for (const metadata of [
      { emailSource: 'visitor' },
      { emailSource: 'some-future-path' },
      { emailSource: 42 },
      { source: 'email-inbound' },
      {},
      null,
    ]) {
      expect(isSelfReportedIdentity({ email, metadata })).toBe(true);
    }
  });

  it('does not flag an identity that carries no email, since there is nothing to trust', () => {
    expect(isSelfReportedIdentity({ email: null, metadata: {} })).toBe(false);
    expect(isSelfReportedIdentity({ email: '  ', metadata: null })).toBe(false);
  });
});

describe('identityProvenance', () => {
  it('treats an identity-verified widget session as authenticated', () => {
    expect(identityProvenance({ channelType: 'chat', email: null, metadata: {} })).toBe('authenticated');
  });

  it('treats spoofable channel envelopes as channel_asserted', () => {
    for (const channelType of ['email', 'sms', 'voice']) {
      expect(identityProvenance({ channelType, email: null, metadata: {} })).toBe('channel_asserted');
    }
  });

  it('never reports authenticated for a turn that arrived over a spoofable channel, even when the end-user record was created by a verified widget session', () => {
    const recordFromVerifiedWidgetSession = {};
    expect(
      identityProvenance({ channelType: 'email', email: null, metadata: recordFromVerifiedWidgetSession }),
    ).toBe('channel_asserted');
  });

  it('keeps self_reported ahead of any channel signal', () => {
    expect(identityProvenance({ channelType: 'chat', email: null, metadata: { anonymous: true } })).toBe(
      'self_reported',
    );
    expect(identityProvenance({ channelType: 'email', email: 'kari@example.com', metadata: { emailSource: 'visitor' } })).toBe(
      'self_reported',
    );
  });

  it('reports an email from an unknown source as self_reported', () => {
    expect(
      identityProvenance({ channelType: 'chat', email: 'kari@example.com', metadata: {} }),
    ).toBe('self_reported');
    expect(
      identityProvenance({
        channelType: 'email',
        email: 'kari@example.com',
        metadata: { emailSource: 'channel' },
      }),
    ).toBe('channel_asserted');
  });

  it('defaults to channel_asserted for unknown or missing channels rather than over-claiming', () => {
    expect(identityProvenance({ channelType: null, email: null, metadata: {} })).toBe('channel_asserted');
    expect(identityProvenance({ channelType: undefined, email: null, metadata: {} })).toBe('channel_asserted');
    expect(identityProvenance({ channelType: 'some-future-channel', email: null, metadata: {} })).toBe(
      'channel_asserted',
    );
  });

  it('is case- and whitespace-insensitive on the channel kind', () => {
    expect(identityProvenance({ channelType: ' Chat ', email: null, metadata: {} })).toBe('authenticated');
    expect(identityProvenance({ channelType: 'EMAIL', email: null, metadata: {} })).toBe('channel_asserted');
  });
});
