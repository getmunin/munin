import { describe, it, expect, vi } from 'vitest';
import { createApiClient, WidgetApiError } from './api.ts';

interface CapturedCall {
  url: string;
  init: RequestInit;
}

function mockFetch(
  responder: (call: CapturedCall) => { status: number; body: unknown },
): { fetchImpl: typeof fetch; calls: CapturedCall[] } {
  const calls: CapturedCall[] = [];
  const fetchImpl: typeof fetch = (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const call = { url, init: init ?? {} };
    calls.push(call);
    const { status, body } = responder(call);
    return Promise.resolve(
      new Response(typeof body === 'string' ? body : JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
  };
  return { fetchImpl, calls };
}

describe('api: postMessage', () => {
  it('POSTs to /api/v1/widget/messages with channelId, sessionId, end_user role', async () => {
    const { fetchImpl, calls } = mockFetch(() => ({
      status: 201,
      body: {
        conversationId: 'cnv_1',
        displayId: 1,
        contactId: 'ctc_1',
        inserted: 1,
        skipped: 0,
      },
    }));
    const client = createApiClient({
      host: 'https://munin.example',
      widgetKey: 'mn_widget_abc',
      channelId: 'cnv_chan',
      sessionId: 'sess_1',
      fetchImpl,
    });
    const res = await client.postMessage('hello');
    expect(res.conversationId).toBe('cnv_1');
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('https://munin.example/api/v1/widget/messages');
    expect(calls[0]!.init.method).toBe('POST');
    const body = JSON.parse(calls[0]!.init.body as string) as Record<string, unknown>;
    expect(body).toMatchObject({
      channelId: 'cnv_chan',
      sessionId: 'sess_1',
      messages: [{ role: 'end_user', body: 'hello' }],
    });
    expect(body).not.toHaveProperty('verifiedExternalId');
  });

  it('threads identity attrs into the request body', async () => {
    const { fetchImpl, calls } = mockFetch(() => ({
      status: 201,
      body: { conversationId: 'cnv', displayId: 1, contactId: 'ctc', inserted: 1, skipped: 0 },
    }));
    const client = createApiClient({
      host: 'https://munin.example',
      widgetKey: 'mn_widget_abc',
      channelId: 'cnv_chan',
      sessionId: 'sess_1',
      identity: { externalId: 'user_42', userHash: 'a'.repeat(64) },
      fetchImpl,
    });
    await client.postMessage('hi');
    const body = JSON.parse(calls[0]!.init.body as string) as Record<string, unknown>;
    expect(body.verifiedExternalId).toBe('user_42');
    expect(body.userHash).toBe('a'.repeat(64));
  });

  it('threads visitor metadata into the request body', async () => {
    const { fetchImpl, calls } = mockFetch(() => ({
      status: 201,
      body: { conversationId: 'cnv', displayId: 1, contactId: 'ctc', inserted: 1, skipped: 0 },
    }));
    const client = createApiClient({
      host: 'https://munin.example',
      widgetKey: 'mn_widget_abc',
      channelId: 'cnv_chan',
      sessionId: 'sess_1',
      visitor: { name: 'Ada', email: 'ada@example.com', metadata: { plan: 'pro' } },
      fetchImpl,
    });
    await client.postMessage('hi');
    const body = JSON.parse(calls[0]!.init.body as string) as Record<string, unknown>;
    expect(body.visitor).toEqual({
      name: 'Ada',
      email: 'ada@example.com',
      metadata: { plan: 'pro' },
    });
  });

  it('throws WidgetApiError carrying the status on a non-2xx response', async () => {
    const { fetchImpl } = mockFetch(() => ({ status: 403, body: { error: 'origin_not_allowed' } }));
    const client = createApiClient({
      host: 'https://munin.example',
      widgetKey: 'mn_widget_abc',
      channelId: 'cnv_chan',
      sessionId: 'sess_1',
      fetchImpl,
    });
    await expect(client.postMessage('x')).rejects.toBeInstanceOf(WidgetApiError);
    await expect(client.postMessage('x')).rejects.toMatchObject({ status: 403 });
  });

  it('sends Authorization: Bearer <widgetKey>', async () => {
    const { fetchImpl, calls } = mockFetch(() => ({
      status: 201,
      body: { conversationId: 'c', displayId: 1, contactId: 'ctc', inserted: 1, skipped: 0 },
    }));
    const client = createApiClient({
      host: 'https://munin.example',
      widgetKey: 'mn_widget_secret',
      channelId: 'cnv_chan',
      sessionId: 'sess_1',
      fetchImpl,
    });
    await client.postMessage('x');
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer mn_widget_secret');
  });

  it('strips the trailing slash on host before constructing URLs', async () => {
    const { fetchImpl, calls } = mockFetch(() => ({
      status: 201,
      body: { conversationId: 'c', displayId: 1, contactId: 'ctc', inserted: 1, skipped: 0 },
    }));
    const client = createApiClient({
      host: 'https://munin.example', // already stripped by parseConfig but verify here
      widgetKey: 'mn_widget_abc',
      channelId: 'cnv_chan',
      sessionId: 'sess_1',
      fetchImpl,
    });
    await client.postMessage('x');
    expect(calls[0]!.url).toBe('https://munin.example/api/v1/widget/messages');
  });
});

describe('api: backfillSince', () => {
  it('GETs with channelId + sessionId and parses the result', async () => {
    const { fetchImpl, calls } = mockFetch(() => ({
      status: 200,
      body: {
        messages: [
          { id: 'm1', role: 'end_user', body: 'one', bodyHtml: null, at: '2026-05-09T10:00:00.000Z' },
        ],
        hasMore: false,
      },
    }));
    const client = createApiClient({
      host: 'https://munin.example',
      widgetKey: 'mn_widget_abc',
      channelId: 'cnv_chan',
      sessionId: 'sess_1',
      fetchImpl,
    });
    const res = await client.backfillSince(undefined);
    expect(res.messages).toHaveLength(1);
    expect(res.hasMore).toBe(false);
    expect(calls[0]!.url).toContain('channelId=cnv_chan');
    expect(calls[0]!.url).toContain('sessionId=sess_1');
    expect(calls[0]!.url).not.toContain('since=');
    expect(calls[0]!.init.method).toBe('GET');
  });

  it('serializes since as ISO 8601 in the query string', async () => {
    const { fetchImpl, calls } = mockFetch(() => ({
      status: 200,
      body: { messages: [], hasMore: false },
    }));
    const client = createApiClient({
      host: 'https://munin.example',
      widgetKey: 'mn_widget_abc',
      channelId: 'cnv_chan',
      sessionId: 'sess_1',
      fetchImpl,
    });
    const since = new Date('2026-05-09T11:00:00.123Z');
    await client.backfillSince(since);
    expect(calls[0]!.url).toContain('since=2026-05-09T11%3A00%3A00.123Z');
  });

  it('threads identity attrs as query params', async () => {
    const { fetchImpl, calls } = mockFetch(() => ({
      status: 200,
      body: { messages: [], hasMore: false },
    }));
    const client = createApiClient({
      host: 'https://munin.example',
      widgetKey: 'mn_widget_abc',
      channelId: 'cnv_chan',
      sessionId: 'sess_1',
      identity: { externalId: 'user_42', userHash: 'b'.repeat(64) },
      fetchImpl,
    });
    await client.backfillSince(undefined);
    expect(calls[0]!.url).toContain('verifiedExternalId=user_42');
    expect(calls[0]!.url).toContain(`userHash=${'b'.repeat(64)}`);
  });

  it('throws WidgetApiError on non-2xx response', async () => {
    const { fetchImpl } = mockFetch(() => ({ status: 401, body: 'unauth' }));
    const client = createApiClient({
      host: 'https://munin.example',
      widgetKey: 'mn_widget_abc',
      channelId: 'cnv_chan',
      sessionId: 'sess_1',
      fetchImpl,
    });
    await expect(client.backfillSince(undefined)).rejects.toMatchObject({ status: 401 });
  });
});

describe('api: clients are not polling', () => {
  it('createApiClient never installs a setInterval', async () => {
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
    const { fetchImpl } = mockFetch(() => ({
      status: 200,
      body: { messages: [], hasMore: false },
    }));
    const client = createApiClient({
      host: 'https://munin.example',
      widgetKey: 'mn_widget_abc',
      channelId: 'cnv_chan',
      sessionId: 'sess_1',
      fetchImpl,
    });
    await client.backfillSince(undefined);
    await client.backfillSince(undefined);
    expect(setIntervalSpy).not.toHaveBeenCalled();
    setIntervalSpy.mockRestore();
  });
});
