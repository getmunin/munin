import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import { verifySlackSignature } from './slack-signature.ts';

const SECRET = 'test-signing-secret';
const NOW_MS = 1_750_000_000_000;

function sign(body: string, timestamp: string, secret = SECRET): string {
  return `v0=${createHmac('sha256', secret).update(`v0:${timestamp}:${body}`).digest('hex')}`;
}

function tsAt(nowMs: number, offsetSeconds = 0): string {
  return String(Math.floor(nowMs / 1000) + offsetSeconds);
}

describe('verifySlackSignature', () => {
  it('accepts a valid signature', () => {
    const body = '{"type":"url_verification","challenge":"x"}';
    const timestamp = tsAt(NOW_MS);
    expect(
      verifySlackSignature({
        signingSecret: SECRET,
        timestamp,
        signature: sign(body, timestamp),
        rawBody: Buffer.from(body),
        nowMs: NOW_MS,
      }),
    ).toBe(true);
  });

  it('rejects a wrong secret', () => {
    const body = '{}';
    const timestamp = tsAt(NOW_MS);
    expect(
      verifySlackSignature({
        signingSecret: SECRET,
        timestamp,
        signature: sign(body, timestamp, 'other-secret'),
        rawBody: body,
        nowMs: NOW_MS,
      }),
    ).toBe(false);
  });

  it('rejects a tampered body', () => {
    const timestamp = tsAt(NOW_MS);
    expect(
      verifySlackSignature({
        signingSecret: SECRET,
        timestamp,
        signature: sign('{"a":1}', timestamp),
        rawBody: '{"a":2}',
        nowMs: NOW_MS,
      }),
    ).toBe(false);
  });

  it('rejects timestamps outside the replay window (both directions)', () => {
    const body = '{}';
    for (const offset of [-301, 301]) {
      const timestamp = tsAt(NOW_MS, offset);
      expect(
        verifySlackSignature({
          signingSecret: SECRET,
          timestamp,
          signature: sign(body, timestamp),
          rawBody: body,
          nowMs: NOW_MS,
        }),
      ).toBe(false);
    }
  });

  it('accepts timestamps just inside the replay window', () => {
    const body = '{}';
    const timestamp = tsAt(NOW_MS, -299);
    expect(
      verifySlackSignature({
        signingSecret: SECRET,
        timestamp,
        signature: sign(body, timestamp),
        rawBody: body,
        nowMs: NOW_MS,
      }),
    ).toBe(true);
  });

  it('rejects non-string header values (array tampering)', () => {
    const body = '{}';
    const timestamp = tsAt(NOW_MS);
    const signature = sign(body, timestamp);
    expect(
      verifySlackSignature({
        signingSecret: SECRET,
        timestamp: [timestamp, timestamp],
        signature,
        rawBody: body,
        nowMs: NOW_MS,
      }),
    ).toBe(false);
    expect(
      verifySlackSignature({
        signingSecret: SECRET,
        timestamp,
        signature: [signature],
        rawBody: body,
        nowMs: NOW_MS,
      }),
    ).toBe(false);
    expect(
      verifySlackSignature({
        signingSecret: SECRET,
        timestamp: undefined,
        signature: undefined,
        rawBody: body,
        nowMs: NOW_MS,
      }),
    ).toBe(false);
  });

  it('rejects a non-numeric timestamp', () => {
    const body = '{}';
    expect(
      verifySlackSignature({
        signingSecret: SECRET,
        timestamp: 'not-a-number',
        signature: sign(body, 'not-a-number'),
        rawBody: body,
        nowMs: NOW_MS,
      }),
    ).toBe(false);
  });
});
