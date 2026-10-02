import { describe, it, expect } from 'vitest';
import { generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import {
  mapStrexDeliveryReport,
  parseStrexPublicKey,
  parseStrexSignatureHeader,
  strexSigningMessage,
  verifyStrexSignature,
} from './strex-client.service.ts';
import { keywordInput } from './strex-sms.service.ts';

const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const publicKeyDerBase64 = publicKey.export({ format: 'der', type: 'spki' }).toString('base64');

const URI = 'https://API.example.com/v1/conversations/channels/cch_AbC123/webhook';

function signHeader(opts: { rawBody: Buffer; timestamp?: number; uri?: string }): string {
  const timestamp = opts.timestamp ?? Math.floor(Date.now() / 1000);
  const nonce = randomUUID();
  const message = strexSigningMessage({
    method: 'post',
    uri: opts.uri ?? URI,
    timestamp,
    nonce,
    rawBody: opts.rawBody,
  });
  const signature = sign('sha256', Buffer.from(message, 'utf8'), {
    key: privateKey,
    dsaEncoding: 'ieee-p1363',
  }).toString('base64');
  return `strex-server-key:${timestamp}:${nonce}:${signature}`;
}

function verify(header: string, rawBody: Buffer, uri = URI) {
  const signature = parseStrexSignatureHeader(header);
  if (!signature) throw new Error('header did not parse');
  return verifyStrexSignature({
    publicKey: parseStrexPublicKey(publicKeyDerBase64),
    signature,
    method: 'POST',
    uri,
    rawBody,
  });
}

describe('verifyStrexSignature', () => {
  const body = Buffer.from(
    JSON.stringify({ transactionId: 'tx-1', sender: '+4712345678', recipient: '2002', content: 'Hei' }),
  );

  it('accepts a forward signed by the server key over the lowercased uri and body hash', () => {
    expect(verify(signHeader({ rawBody: body }), body)).toEqual({ ok: true });
  });

  it('treats the uri case-insensitively, as Strex lowercases it before signing', () => {
    expect(verify(signHeader({ rawBody: body }), body, URI.toLowerCase())).toEqual({ ok: true });
  });

  it('rejects a body that differs from the signed one', () => {
    const header = signHeader({ rawBody: body });
    const tampered = Buffer.from(body.toString().replace('Hei', 'Hallo'));
    expect(verify(header, tampered)).toEqual({ ok: false, error: 'signature_mismatch' });
  });

  it('rejects a signature made for another channel url', () => {
    const header = signHeader({
      rawBody: body,
      uri: 'https://api.example.com/v1/conversations/channels/cch_other/webhook',
    });
    expect(verify(header, body)).toEqual({ ok: false, error: 'signature_mismatch' });
  });

  it('rejects a timestamp outside the five minute window', () => {
    const header = signHeader({ rawBody: body, timestamp: Math.floor(Date.now() / 1000) - 301 });
    expect(verify(header, body)).toEqual({ ok: false, error: 'signature_clock_skew' });
  });

  it('signs an empty body with an empty content hash', () => {
    const empty = Buffer.alloc(0);
    expect(verify(signHeader({ rawBody: empty }), empty)).toEqual({ ok: true });
  });
});

describe('parseStrexSignatureHeader', () => {
  it('splits keyName:timestamp:nonce:signature', () => {
    expect(parseStrexSignatureHeader('key:1700000000:abc-123:c2ln')).toEqual({
      keyName: 'key',
      timestamp: 1700000000,
      nonce: 'abc-123',
      signature: 'c2ln',
    });
  });

  it('rejects headers with the wrong number of parts or a non-numeric timestamp', () => {
    expect(parseStrexSignatureHeader('key:1700000000:sig')).toBeNull();
    expect(parseStrexSignatureHeader('key:soon:nonce:sig')).toBeNull();
  });
});

describe('parseStrexPublicKey', () => {
  it('reads both the DER base64 Strex returns and a PEM key', () => {
    const pem = publicKey.export({ format: 'pem', type: 'spki' }).toString();
    expect(parseStrexPublicKey(publicKeyDerBase64).asymmetricKeyType).toBe('ec');
    expect(parseStrexPublicKey(pem).asymmetricKeyType).toBe('ec');
  });
});

describe('mapStrexDeliveryReport', () => {
  it('maps delivered and handed-to-operator reports to sent', () => {
    expect(mapStrexDeliveryReport({ statusCode: 'Ok', detailedStatusCode: 'Delivered' })).toEqual({
      status: 'sent',
      error: null,
    });
    expect(mapStrexDeliveryReport({ statusCode: 'Sent', detailedStatusCode: 'Sent' })).toEqual({
      status: 'sent',
      error: null,
    });
  });

  it('maps failures to failed with the detailed status in the error', () => {
    expect(
      mapStrexDeliveryReport({ statusCode: 'Failed', detailedStatusCode: 'SubscriberBarred' }),
    ).toEqual({ status: 'failed', error: 'strex_SubscriberBarred' });
  });

  it('ignores a duplicate-transaction report so a retried send cannot fail a delivered message', () => {
    expect(
      mapStrexDeliveryReport({ statusCode: 'Failed', detailedStatusCode: 'DuplicateTransaction' }),
    ).toBeNull();
  });

  it('ignores internal queueing and billing reversals', () => {
    expect(mapStrexDeliveryReport({ statusCode: 'Queued', detailedStatusCode: 'None' })).toBeNull();
    expect(mapStrexDeliveryReport({ statusCode: 'Reversed' })).toBeNull();
  });
});

describe('keywordInput', () => {
  it('registers a wildcard catch-all when no keyword is set', () => {
    expect(keywordInput('NO-2002', undefined, 'https://x.example/hook')).toEqual({
      shortNumberId: 'NO-2002',
      keywordText: '*',
      mode: 'Wildcard',
      forwardUrl: 'https://x.example/hook',
    });
  });

  it('matches the first word when a keyword is set', () => {
    expect(keywordInput('NO-2002', 'ACME', 'https://x.example/hook')).toMatchObject({
      keywordText: 'ACME',
      mode: 'Exact',
    });
  });
});
