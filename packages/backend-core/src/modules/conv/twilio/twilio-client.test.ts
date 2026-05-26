import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import { parseUrlEncoded, validateTwilioSignature } from './twilio-client.service.ts';

describe('parseUrlEncoded', () => {
  it('parses simple form-encoded body', () => {
    const buf = Buffer.from('From=%2B14155551212&Body=hi+there&MessageSid=SM123');
    expect(parseUrlEncoded(buf)).toEqual({
      From: '+14155551212',
      Body: 'hi there',
      MessageSid: 'SM123',
    });
  });

  it('handles empty body', () => {
    expect(parseUrlEncoded(Buffer.alloc(0))).toEqual({});
  });

  it('handles missing value (key=)', () => {
    expect(parseUrlEncoded(Buffer.from('a=1&b=&c=3'))).toEqual({ a: '1', b: '', c: '3' });
  });
});

describe('validateTwilioSignature', () => {
  const authToken = 'test-twilio-auth-token';
  const url = 'https://munin.example/api/v1/conversations/channels/cch_abc/webhook';
  const params = {
    AccountSid: 'AC1234567890',
    From: '+14155551212',
    Body: 'hello world',
    MessageSid: 'SM00000000000000000000000000000001',
    To: '+14155557777',
  };

  function sign(opts: { authToken: string; url: string; params: Record<string, string> }): string {
    const keys = Object.keys(opts.params).sort();
    let data = opts.url;
    for (const k of keys) data += k + opts.params[k];
    return createHmac('sha1', opts.authToken).update(data, 'utf8').digest('base64');
  }

  it('accepts a correctly signed request', () => {
    const signature = sign({ authToken, url, params });
    expect(validateTwilioSignature({ authToken, url, params, signature })).toBe(true);
  });

  it('rejects when the signature is tampered', () => {
    const signature = sign({ authToken, url, params });
    const bad = signature.slice(0, -2) + (signature.endsWith('=') ? 'A=' : 'AA');
    expect(validateTwilioSignature({ authToken, url, params, signature: bad })).toBe(false);
  });

  it('rejects when a param is changed', () => {
    const signature = sign({ authToken, url, params });
    const tampered = { ...params, Body: 'hello WORLD' };
    expect(validateTwilioSignature({ authToken, url, params: tampered, signature })).toBe(false);
  });

  it('rejects when the URL differs', () => {
    const signature = sign({ authToken, url, params });
    expect(
      validateTwilioSignature({
        authToken,
        url: 'https://munin.example/wrong/path',
        params,
        signature,
      }),
    ).toBe(false);
  });

  it('rejects when the auth token is wrong', () => {
    const signature = sign({ authToken, url, params });
    expect(
      validateTwilioSignature({ authToken: 'other-token', url, params, signature }),
    ).toBe(false);
  });

  it('rejects empty signature', () => {
    expect(validateTwilioSignature({ authToken, url, params, signature: '' })).toBe(false);
  });
});
