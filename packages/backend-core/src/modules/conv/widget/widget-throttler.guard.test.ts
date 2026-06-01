import { describe, it, expect } from 'vitest';
import type { Request } from 'express';
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
  xff?: string;
  body?: Record<string, unknown>;
  query?: Record<string, unknown>;
}): Request {
  return {
    ip: input.ip ?? '127.0.0.1',
    headers: input.xff ? { 'x-forwarded-for': input.xff } : {},
    body: input.body,
    query: input.query ?? {},
    socket: { remoteAddress: input.ip ?? '127.0.0.1' },
  } as unknown as Request;
}

describe('WidgetThrottlerGuard.getTracker', () => {
  const guard = new TestGuard();

  it('keys by ip|channelId|sessionId from the request body', async () => {
    const t = await guard.publicGetTracker(
      makeReq({ ip: '203.0.113.5', body: { channelId: 'chan_a', sessionId: 'sess_1' } }),
    );
    expect(t).toBe('widget:203.0.113.5|chan_a|sess_1');
  });

  it('falls back to query string for GET endpoints', async () => {
    const t = await guard.publicGetTracker(
      makeReq({ ip: '203.0.113.5', query: { channelId: 'chan_a', sessionId: 'sess_1' } }),
    );
    expect(t).toBe('widget:203.0.113.5|chan_a|sess_1');
  });

  it('uses the first id from listConversations sessionIds csv', async () => {
    const t = await guard.publicGetTracker(
      makeReq({ ip: '203.0.113.5', query: { channelId: 'chan_a', sessionIds: 'sess_1,sess_2' } }),
    );
    expect(t).toBe('widget:203.0.113.5|chan_a|sess_1');
  });

  it('isolates trackers across (channelId, sessionId) pairs from the same ip', async () => {
    const a = await guard.publicGetTracker(
      makeReq({ ip: '203.0.113.5', body: { channelId: 'chan_a', sessionId: 'sess_1' } }),
    );
    const b = await guard.publicGetTracker(
      makeReq({ ip: '203.0.113.5', body: { channelId: 'chan_a', sessionId: 'sess_2' } }),
    );
    const c = await guard.publicGetTracker(
      makeReq({ ip: '203.0.113.5', body: { channelId: 'chan_b', sessionId: 'sess_1' } }),
    );
    expect(new Set([a, b, c]).size).toBe(3);
  });

  it('prefers X-Forwarded-For first hop over req.ip when behind a proxy', async () => {
    const t = await guard.publicGetTracker(
      makeReq({
        ip: '10.0.0.1',
        xff: '198.51.100.7, 10.0.0.1',
        body: { channelId: 'chan_a', sessionId: 'sess_1' },
      }),
    );
    expect(t).toBe('widget:198.51.100.7|chan_a|sess_1');
  });

  it('falls back to "-" when channelId or sessionId is missing', async () => {
    const t = await guard.publicGetTracker(makeReq({ ip: '203.0.113.5' }));
    expect(t).toBe('widget:203.0.113.5|-|-');
  });
});
