import { describe, it, expect } from 'vitest';
import { createHash, createHmac } from 'node:crypto';
import {
  parseUrlEncoded,
  verifyMessageBirdJwt,
} from './messagebird-client.service.ts';

function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function makeJwt(opts: {
  signingKey: string;
  url: string;
  body: Buffer;
  now: number;
  alg?: string;
  typ?: string;
  tamperPayloadHash?: boolean;
  tamperUrlHash?: boolean;
  expiredSecondsAgo?: number;
}): string {
  const header = { alg: opts.alg ?? 'HS256', typ: opts.typ ?? 'JWT' };
  const urlHash = createHash('sha256').update(opts.url, 'utf8').digest('hex');
  const payloadHash =
    opts.body.length > 0 ? createHash('sha256').update(opts.body).digest('hex') : null;
  const payload: Record<string, unknown> = {
    iss: 'MessageBird',
    nbf: opts.now - 60,
    exp: opts.expiredSecondsAgo ? opts.now - opts.expiredSecondsAgo : opts.now + 300,
    jti: 'test-id',
    url_hash: opts.tamperUrlHash ? 'deadbeef' : urlHash,
    payload_hash: opts.tamperPayloadHash ? 'cafebabe' : payloadHash,
  };
  const headerB64 = b64url(Buffer.from(JSON.stringify(header)));
  const payloadB64 = b64url(Buffer.from(JSON.stringify(payload)));
  const signature = createHmac('sha256', opts.signingKey)
    .update(`${headerB64}.${payloadB64}`, 'utf8')
    .digest();
  return `${headerB64}.${payloadB64}.${b64url(signature)}`;
}

describe('parseUrlEncoded (messagebird)', () => {
  it('parses form-encoded inbound', () => {
    const buf = Buffer.from('id=e8077&originator=31612345678&body=Hi+there');
    expect(parseUrlEncoded(buf)).toEqual({
      id: 'e8077',
      originator: '31612345678',
      body: 'Hi there',
    });
  });
});

describe('verifyMessageBirdJwt', () => {
  const signingKey = 'mb-signing-key';
  const url = 'https://munin.example/api/v1/conversations/channels/cch_abc/webhook';
  const body = Buffer.from('id=e8077&originator=31612345678&body=hello');
  const now = Math.floor(Date.now() / 1000);
  const nowDate = new Date(now * 1000);

  it('accepts a correctly-signed JWT', () => {
    const token = makeJwt({ signingKey, url, body, now });
    const r = verifyMessageBirdJwt({ signingKey, token, url, rawBody: body, now: nowDate });
    expect(r.ok).toBe(true);
  });

  it('rejects an unsupported alg', () => {
    const token = makeJwt({ signingKey, url, body, now, alg: 'none' });
    const r = verifyMessageBirdJwt({ signingKey, token, url, rawBody: body, now: nowDate });
    expect(r.ok).toBe(false);
  });

  it('rejects when payload_hash mismatches', () => {
    const token = makeJwt({ signingKey, url, body, now, tamperPayloadHash: true });
    const r = verifyMessageBirdJwt({ signingKey, token, url, rawBody: body, now: nowDate });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toBe('jwt_payload_hash_mismatch');
  });

  it('rejects when url_hash mismatches', () => {
    const token = makeJwt({ signingKey, url, body, now, tamperUrlHash: true });
    const r = verifyMessageBirdJwt({ signingKey, token, url, rawBody: body, now: nowDate });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toBe('jwt_url_hash_mismatch');
  });

  it('rejects when the signing key is wrong', () => {
    const token = makeJwt({ signingKey: 'other-key', url, body, now });
    const r = verifyMessageBirdJwt({ signingKey, token, url, rawBody: body, now: nowDate });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toBe('jwt_signature_mismatch');
  });

  it('rejects an expired token', () => {
    const token = makeJwt({ signingKey, url, body, now, expiredSecondsAgo: 3600 });
    const r = verifyMessageBirdJwt({ signingKey, token, url, rawBody: body, now: nowDate });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toBe('jwt_expired');
  });

  it('rejects a malformed token', () => {
    const r = verifyMessageBirdJwt({
      signingKey,
      token: 'not.a.jwt.really',
      url,
      rawBody: body,
      now: nowDate,
    });
    expect(r.ok).toBe(false);
  });
});
