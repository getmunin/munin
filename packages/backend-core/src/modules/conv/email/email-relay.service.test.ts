import { describe, expect, it } from 'vitest';
import { forwarderAllowed, normaliseAddress } from './email-relay.service.ts';

describe('normaliseAddress', () => {
  it('lowercases and trims a bare address', () => {
    expect(normaliseAddress('  Acme-7F3C@In.GetMunin.com ')).toBe('acme-7f3c@in.getmunin.com');
  });

  it('unwraps an angle-bracketed address', () => {
    expect(normaliseAddress('Acme Support <acme@in.getmunin.com>')).toBe('acme@in.getmunin.com');
  });

  it('rejects a value that is not an address', () => {
    expect(normaliseAddress('not-an-address')).toBeNull();
    expect(normaliseAddress('')).toBeNull();
  });
});

describe('forwarderAllowed', () => {
  it('accepts the forwarding mailbox domain', () => {
    expect(forwarderAllowed('support@acme.com', 'customer@example.com', ['acme.com'])).toBe(true);
  });

  it('accepts a subdomain of an allowed domain', () => {
    expect(forwarderAllowed('support@mail.acme.com', 'customer@example.com', ['acme.com'])).toBe(
      true,
    );
  });

  it('falls back to the envelope sender when there is no forwarding hop', () => {
    expect(forwarderAllowed(null, 'ops@acme.com', ['acme.com'])).toBe(true);
  });

  it('rejects when neither address matches the allowlist', () => {
    expect(forwarderAllowed('relay@evil.test', 'spoof@evil.test', ['acme.com'])).toBe(false);
  });

  it('does not treat a suffix match as a subdomain match', () => {
    expect(forwarderAllowed('support@notacme.com', 'x@notacme.com', ['acme.com'])).toBe(false);
  });
});
