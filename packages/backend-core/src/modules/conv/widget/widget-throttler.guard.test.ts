import { describe, it, expect } from 'vitest';
import type { Request } from 'express';
import type { ResolvedCredential } from '@getmunin/core';
import { WidgetThrottlerGuard } from './widget-throttler.guard.ts';

class TestGuard extends WidgetThrottlerGuard {
  constructor() {
    super({ throttlers: [] }, null as never, null as never);
  }
  publicGetTracker(req: Request): Promise<string> {
    return this.getTracker(req);
  }
}

function makeReq(input: {
  ip?: string;
  body?: Record<string, unknown>;
  query?: Record<string, unknown>;
  apiKeyId?: string;
}): Request {
  const credential: ResolvedCredential | undefined = input.apiKeyId
    ? ({ actor: { id: input.apiKeyId } } as ResolvedCredential)
    : undefined;
  return {
    ip: input.ip ?? '127.0.0.1',
    headers: {},
    body: input.body,
    query: input.query ?? {},
    socket: { remoteAddress: input.ip ?? '127.0.0.1' },
    credential,
  } as unknown as Request;
}

describe('WidgetThrottlerGuard.getTracker', () => {
  const guard = new TestGuard();

  it('keys by apiKeyId|channelId|ip — independent of caller-supplied sessionId', async () => {
    const t = await guard.publicGetTracker(
      makeReq({
        ip: '203.0.113.5',
        apiKeyId: 'ak_1',
        body: { channelId: 'chan_a', sessionId: 'sess_1' },
      }),
    );
    expect(t).toBe('widget:ak_1|chan_a|203.0.113.5');
  });

  it('produces the same key when only sessionId changes', async () => {
    const a = await guard.publicGetTracker(
      makeReq({
        ip: '203.0.113.5',
        apiKeyId: 'ak_1',
        body: { channelId: 'chan_a', sessionId: 'sess_1' },
      }),
    );
    const b = await guard.publicGetTracker(
      makeReq({
        ip: '203.0.113.5',
        apiKeyId: 'ak_1',
        body: { channelId: 'chan_a', sessionId: 'sess_2' },
      }),
    );
    expect(a).toBe(b);
  });

  it('isolates trackers across api keys with the same channel + ip', async () => {
    const a = await guard.publicGetTracker(
      makeReq({ ip: '203.0.113.5', apiKeyId: 'ak_1', body: { channelId: 'chan_a' } }),
    );
    const b = await guard.publicGetTracker(
      makeReq({ ip: '203.0.113.5', apiKeyId: 'ak_2', body: { channelId: 'chan_a' } }),
    );
    expect(a).not.toBe(b);
  });

  it('isolates trackers across channels', async () => {
    const a = await guard.publicGetTracker(
      makeReq({ ip: '203.0.113.5', apiKeyId: 'ak_1', body: { channelId: 'chan_a' } }),
    );
    const b = await guard.publicGetTracker(
      makeReq({ ip: '203.0.113.5', apiKeyId: 'ak_1', body: { channelId: 'chan_b' } }),
    );
    expect(a).not.toBe(b);
  });

  it('falls back to "-" when apiKeyId or channelId is missing', async () => {
    const t = await guard.publicGetTracker(makeReq({ ip: '203.0.113.5' }));
    expect(t).toBe('widget:-|-|203.0.113.5');
  });

  it('uses req.ip and does not parse x-forwarded-for itself', async () => {
    const t = await guard.publicGetTracker(
      makeReq({ ip: '10.0.0.1', apiKeyId: 'ak_1', body: { channelId: 'chan_a' } }),
    );
    expect(t).toBe('widget:ak_1|chan_a|10.0.0.1');
  });
});
