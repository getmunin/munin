import { describe, expect, it } from 'vitest';
import {
  emailDomain,
  evaluateInboundEmailAuth,
  inboundSenderAuth,
  stripAuthResultComments,
} from './authentication-results.ts';

describe('inboundSenderAuth', () => {
  const passing = {
    authenticationResults: ['mx.test; dmarc=pass header.from=example.com'],
    fromAddress: 'ola@example.com',
  };

  it('applies the DMARC verdict when the sender is the From address itself', () => {
    expect(inboundSenderAuth(passing, { kind: 'direct', senderAddress: 'ola@example.com' })).toBe(
      'pass',
    );
  });

  it('refuses to extend the verdict to a manually forwarded sender, whom DMARC never checked', () => {
    expect(
      inboundSenderAuth(passing, { kind: 'manual-forward', senderAddress: 'kari@example.test' }),
    ).toBe('unknown');
  });

  it('refuses to extend the verdict to an auto-forwarded sender', () => {
    expect(
      inboundSenderAuth(passing, { kind: 'auto-forward', senderAddress: 'kari@example.test' }),
    ).toBe('unknown');
  });

  it('refuses when a direct sender was rewritten away from the authenticated From address', () => {
    expect(
      inboundSenderAuth(passing, { kind: 'direct', senderAddress: 'kari@example.test' }),
    ).toBe('unknown');
  });

  it('still reports a failing verdict for a direct sender rather than swallowing it', () => {
    expect(
      inboundSenderAuth(
        { authenticationResults: ['mx.test; dmarc=fail header.from=example.com'], fromAddress: 'ola@example.com' },
        { kind: 'direct', senderAddress: 'OLA@Example.com' },
      ),
    ).toBe('fail');
  });
});

describe('stripAuthResultComments', () => {
  it('drops parenthesised comments that would otherwise be scanned for tokens', () => {
    expect(
      stripAuthResultComments('spf=pass (mx.test: domain of a@b.test designates 1.2.3.4) dmarc=fail'),
    ).toBe('spf=pass  dmarc=fail');
  });

  it('handles nested parentheses without leaking their contents', () => {
    expect(stripAuthResultComments('a=b (outer (inner) still) c=d')).toBe('a=b  c=d');
  });

  it('tolerates an unbalanced closing paren', () => {
    expect(stripAuthResultComments('a=b) c=d')).toBe('a=b c=d');
  });
});

describe('emailDomain', () => {
  it('reads the domain after the last @', () => {
    expect(emailDomain('Ola.Nordmann@Example.COM')).toBe('example.com');
    expect(emailDomain('weird@name@example.test')).toBe('example.test');
  });

  it('returns null when there is no domain to read', () => {
    expect(emailDomain('not-an-address')).toBeNull();
    expect(emailDomain('')).toBeNull();
    expect(emailDomain(null)).toBeNull();
    expect(emailDomain(undefined)).toBeNull();
  });

  it('strips a trailing root dot and stray angle bracket', () => {
    expect(emailDomain('a@example.com.')).toBe('example.com');
    expect(emailDomain('a@example.com>')).toBe('example.com');
  });
});

describe('evaluateInboundEmailAuth', () => {
  it('passes a dmarc=pass whose header.from aligns with the envelope From', () => {
    expect(
      evaluateInboundEmailAuth({
        authenticationResults: [
          'mx.test; spf=pass smtp.mailfrom=ola@example.com; dkim=pass header.i=@example.com; dmarc=pass header.from=example.com',
        ],
        fromAddress: 'ola@example.com',
      }),
    ).toBe('pass');
  });

  it('fails when dmarc passed for a different domain than the From header', () => {
    expect(
      evaluateInboundEmailAuth({
        authenticationResults: ['mx.test; dmarc=pass header.from=attacker.test'],
        fromAddress: 'ola@example.com',
      }),
    ).toBe('fail');
  });

  it('fails an explicit dmarc=fail', () => {
    expect(
      evaluateInboundEmailAuth({
        authenticationResults: ['mx.test; dmarc=fail header.from=example.com'],
        fromAddress: 'ola@example.com',
      }),
    ).toBe('fail');
  });

  it('reads only the topmost header, so a sender-forged result cannot outrank the receiving MTA', () => {
    expect(
      evaluateInboundEmailAuth({
        authenticationResults: [
          'mx.test; dmarc=fail header.from=example.com',
          'forged.invalid; dmarc=pass header.from=example.com',
        ],
        fromAddress: 'ola@example.com',
      }),
    ).toBe('fail');
  });

  it('is unknown rather than pass when no Authentication-Results header was added at all', () => {
    expect(
      evaluateInboundEmailAuth({ authenticationResults: [], fromAddress: 'ola@example.com' }),
    ).toBe('unknown');
  });

  it('is unknown when the header carries no dmarc method', () => {
    expect(
      evaluateInboundEmailAuth({
        authenticationResults: ['mx.test; spf=pass smtp.mailfrom=ola@example.com'],
        fromAddress: 'ola@example.com',
      }),
    ).toBe('unknown');
  });

  it('is unknown when dmarc passed but alignment cannot be checked', () => {
    expect(
      evaluateInboundEmailAuth({
        authenticationResults: ['mx.test; dmarc=pass'],
        fromAddress: 'ola@example.com',
      }),
    ).toBe('unknown');
  });

  it('does not let a comment body fake a dmarc result', () => {
    expect(
      evaluateInboundEmailAuth({
        authenticationResults: ['mx.test; spf=fail (claims dmarc=pass header.from=example.com)'],
        fromAddress: 'ola@example.com',
      }),
    ).toBe('unknown');
  });

  it('fails a dmarc=pass that cannot be aligned because the From address is unusable', () => {
    expect(
      evaluateInboundEmailAuth({
        authenticationResults: ['mx.test; dmarc=pass header.from=example.com'],
        fromAddress: '',
      }),
    ).toBe('fail');
  });

  it('matches case-insensitively and tolerates quoting and a trailing dot', () => {
    expect(
      evaluateInboundEmailAuth({
        authenticationResults: ['mx.test; DMARC=Pass header.from="Example.COM."'],
        fromAddress: 'ola@example.com',
      }),
    ).toBe('pass');
  });

  it('does not treat a subdomain as aligned', () => {
    expect(
      evaluateInboundEmailAuth({
        authenticationResults: ['mx.test; dmarc=pass header.from=mail.example.com'],
        fromAddress: 'ola@example.com',
      }),
    ).toBe('fail');
  });
});
