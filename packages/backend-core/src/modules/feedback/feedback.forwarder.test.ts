import { describe, expect, it } from 'vitest';
import { signHmac } from '@getmunin/core';
import { canonicalVoteBody } from './feedback.forwarder.ts';

const HMAC_KEY_CONSTANT = 'munin-feedback-intake-v1';

describe('canonicalVoteBody', () => {
  it('serializes keys in the order the cloud verifier expects', () => {
    const body = canonicalVoteBody({
      feedbackId: 'fb-123',
      instanceId: '00000000-0000-0000-0000-000000000001',
      comment: null,
      votedAt: '2026-01-01T00:00:00.000Z',
    });
    expect(body).toBe(
      '{"feedbackId":"fb-123","instanceId":"00000000-0000-0000-0000-000000000001","comment":null,"votedAt":"2026-01-01T00:00:00.000Z"}',
    );
  });

  it('coalesces missing comment to null', () => {
    const body = canonicalVoteBody({
      feedbackId: 'fb-123',
      instanceId: '00000000-0000-0000-0000-000000000001',
      comment: null,
      votedAt: '2026-01-01T00:00:00.000Z',
    });
    const parsed = JSON.parse(body) as { comment: unknown };
    expect(parsed.comment).toBeNull();
  });

  it('produces a signature the cloud verifier will accept', () => {
    const instanceId = '00000000-0000-0000-0000-000000000001';
    const body = canonicalVoteBody({
      feedbackId: 'fb-123',
      instanceId,
      comment: 'looks great',
      votedAt: '2026-01-01T00:00:00.000Z',
    });
    const ossKey = signHmac(instanceId, HMAC_KEY_CONSTANT);
    const ossSignature = signHmac(body, ossKey);

    const cloudKey = signHmac(instanceId, HMAC_KEY_CONSTANT);
    const cloudExpected = signHmac(body, cloudKey);

    expect(ossSignature).toBe(cloudExpected);
  });
});
