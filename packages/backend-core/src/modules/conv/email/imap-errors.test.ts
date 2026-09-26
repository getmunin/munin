import { describe, expect, it } from 'vitest';
import { classifyImapError } from './imap-errors.ts';

function withProps(message: string, props: Record<string, unknown>): Error {
  return Object.assign(new Error(message), props);
}

describe('classifyImapError', () => {
  it('treats a rejected login as permanent', () => {
    expect(classifyImapError(withProps('Authentication failed', { authenticationFailed: true }))).toBe(
      'permanent',
    );
  });

  it.each(['AUTHENTICATIONFAILED', 'AUTHORIZATIONFAILED', 'EXPIRED', 'NONEXISTENT', 'nonexistent'])(
    'treats server response code %s as permanent',
    (code) => {
      expect(classifyImapError(withProps('Command failed', { serverResponseCode: code }))).toBe(
        'permanent',
      );
    },
  );

  it.each(['ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', 'ECONNRESET', 'CONNECT_TIMEOUT', 'GREETING_TIMEOUT'])(
    'treats network failure %s as transient',
    (code) => {
      expect(classifyImapError(withProps('connect failed', { code }))).toBe('transient');
    },
  );

  it('treats a server-side busy response as transient', () => {
    expect(classifyImapError(withProps('Command failed', { serverResponseCode: 'UNAVAILABLE' }))).toBe(
      'transient',
    );
  });

  it('treats anything unrecognised as transient', () => {
    expect(classifyImapError(new Error('Command failed'))).toBe('transient');
    expect(classifyImapError('boom')).toBe('transient');
    expect(classifyImapError(null)).toBe('transient');
  });
});
