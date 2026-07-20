import { createHmac } from 'node:crypto';
import { timingSafeEqual } from '@getmunin/core';

const MAX_SKEW_SECONDS = 300;

/**
 * Slack request signing (v0): hex HMAC-SHA256 of `v0:{timestamp}:{rawBody}`
 * with the app's signing secret, compared constant-time. The ±5 min
 * timestamp window bounds replay. Header values arrive untyped because
 * Node header lookups can yield arrays.
 */
export function verifySlackSignature(input: {
  signingSecret: string;
  timestamp: unknown;
  signature: unknown;
  rawBody: Buffer | string;
  nowMs?: number;
}): boolean {
  if (typeof input.timestamp !== 'string' || typeof input.signature !== 'string') return false;
  const ts = Number(input.timestamp);
  if (!Number.isFinite(ts)) return false;
  const nowSeconds = (input.nowMs ?? Date.now()) / 1000;
  if (Math.abs(nowSeconds - ts) > MAX_SKEW_SECONDS) return false;
  const body =
    typeof input.rawBody === 'string' ? input.rawBody : input.rawBody.toString('utf8');
  const expected = `v0=${createHmac('sha256', input.signingSecret)
    .update(`v0:${input.timestamp}:${body}`)
    .digest('hex')}`;
  return timingSafeEqual(expected, input.signature);
}
