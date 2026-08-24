import { describe, expect, it } from 'vitest';
import { BingAdapter } from './bing.adapter.ts';
import { ConnectorVendorError, type ConnectorFetch } from '../connectors/http.ts';
import type { ConnectorConnectionContext } from '../connectors/connector.ts';

interface StubCall {
  url: string;
  method: string;
  body: Record<string, unknown> | null;
}

function stubApi(respond: (url: string) => { status?: number; body: unknown }): {
  fetch: ConnectorFetch;
  calls: StubCall[];
} {
  const calls: StubCall[] = [];
  const fetch: ConnectorFetch = (url, init) => {
    calls.push({
      url,
      method: init.method ?? 'GET',
      body: init.body ? (JSON.parse(init.body) as Record<string, unknown>) : null,
    });
    const { status = 200, body } = respond(url);
    return Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(body),
      text: () => Promise.resolve(body === undefined ? '' : JSON.stringify(body)),
    });
  };
  return { fetch, calls };
}

function ctx(): ConnectorConnectionContext {
  return {
    config: { encryptedApiKey: 'ct_abc' },
    decryptSecret: () => Promise.resolve('bing_api_key_value'),
  };
}

const week = (date: string) => `/Date(${Date.parse(`${date}T00:00:00Z`)})/`;

const statsWindow = { from: '2026-01-01', to: '2026-12-31', limit: 50 };

describe('BingAdapter', () => {
  it('passes the api key as a query parameter and unwraps the d envelope', async () => {
    const { fetch, calls } = stubApi(() => ({
      body: { d: [{ Url: 'https://example.com', IsVerified: true }] },
    }));

    const properties = await new BingAdapter(fetch).listProperties(ctx());

    expect(properties).toEqual([{ siteUrl: 'https://example.com', verified: true }]);
    expect(calls[0]!.url).toBe(
      'https://ssl.bing.com/webmaster/api.svc/json/GetUserSites?apikey=bing_api_key_value',
    );
  });

  it('sums the weekly rows per query and weights avgPosition by impressions', async () => {
    const { fetch } = stubApi(() => ({
      body: {
        d: [
          {
            Query: 'munin mcp',
            Impressions: 100,
            Clicks: 2,
            AvgImpressionPosition: 10,
            Date: week('2026-03-07'),
          },
          {
            Query: 'munin mcp',
            Impressions: 300,
            Clicks: 10,
            AvgImpressionPosition: 2,
            Date: week('2026-03-14'),
          },
          {
            Query: 'quiet query',
            Impressions: 5,
            Clicks: 0,
            AvgImpressionPosition: 40,
            Date: week('2026-03-14'),
          },
        ],
      },
    }));

    const result = await new BingAdapter(fetch).listQueryStats(ctx(), {
      siteUrl: 'https://example.com',
      ...statsWindow,
    });

    expect(result.queries).toEqual([
      { query: 'munin mcp', impressions: 400, clicks: 12, ctr: 0.03, avgPosition: 4 },
      { query: 'quiet query', impressions: 5, clicks: 0, ctr: 0, avgPosition: 40 },
    ]);
    expect(result.window).toEqual({ from: '2026-03-07', to: '2026-03-14' });
  });

  it('reports the window it actually covered, not the window requested', async () => {
    const { fetch } = stubApi(() => ({
      body: {
        d: [
          { Query: 'in range', Impressions: 10, Clicks: 1, Date: week('2026-03-14') },
          { Query: 'too old', Impressions: 99, Clicks: 9, Date: week('2025-01-04') },
        ],
      },
    }));

    const result = await new BingAdapter(fetch).listQueryStats(ctx(), {
      siteUrl: 'https://example.com',
      from: '2026-03-01',
      to: '2026-03-31',
      limit: 50,
    });

    expect(result.queries.map((q) => q.query)).toEqual(['in range']);
    expect(result.window).toEqual({ from: '2026-03-14', to: '2026-03-14' });
  });

  it('returns a null window when nothing fell inside the requested range', async () => {
    const { fetch } = stubApi(() => ({
      body: { d: [{ Query: 'too old', Impressions: 99, Clicks: 9, Date: week('2020-01-04') }] },
    }));

    const result = await new BingAdapter(fetch).listQueryStats(ctx(), {
      siteUrl: 'https://example.com',
      from: '2026-03-01',
      to: '2026-03-31',
      limit: 50,
    });

    expect(result).toEqual({ window: null, queries: [] });
  });

  it('truncates to the requested limit after aggregating, keeping the highest impressions', async () => {
    const { fetch } = stubApi(() => ({
      body: {
        d: [
          { Query: 'a', Impressions: 10, Clicks: 0, Date: week('2026-03-14') },
          { Query: 'b', Impressions: 90, Clicks: 0, Date: week('2026-03-14') },
          { Query: 'c', Impressions: 50, Clicks: 0, Date: week('2026-03-14') },
        ],
      },
    }));

    const result = await new BingAdapter(fetch).listQueryStats(ctx(), {
      siteUrl: 'https://example.com',
      ...statsWindow,
      limit: 2,
    });

    expect(result.queries.map((q) => q.query)).toEqual(['b', 'c']);
  });

  it('maps page rows off the Query field, which Bing reuses for the page url', async () => {
    const { fetch } = stubApi(() => ({
      body: {
        d: [
          {
            Query: 'https://example.com/pricing',
            Impressions: 200,
            Clicks: 20,
            AvgImpressionPosition: 3,
            Date: week('2026-03-14'),
          },
        ],
      },
    }));

    const result = await new BingAdapter(fetch).listPageStats(ctx(), {
      siteUrl: 'https://example.com',
      ...statsWindow,
    });

    expect(result.pages).toEqual([
      {
        url: 'https://example.com/pricing',
        impressions: 200,
        clicks: 20,
        ctr: 0.1,
        avgPosition: 3,
      },
    ]);
  });

  it('translates the .NET date format on index records', async () => {
    const { fetch } = stubApi(() => ({
      body: {
        d: {
          Url: 'https://example.com/pricing',
          IsPage: true,
          HttpStatus: 200,
          LastCrawledDate: week('2026-03-18'),
          DiscoveryDate: week('2025-11-02'),
          AnchorCount: 7,
        },
      },
    }));

    const status = await new BingAdapter(fetch).inspectUrl(ctx(), {
      siteUrl: 'https://example.com',
      url: 'https://example.com/pricing',
    });

    expect(status).toEqual({
      url: 'https://example.com/pricing',
      indexed: true,
      detail: null,
      httpStatus: 200,
      lastCrawledAt: '2026-03-18T00:00:00.000Z',
      discoveredAt: '2025-11-02T00:00:00.000Z',
      inboundAnchorCount: 7,
    });
  });

  it('returns null for a url the index holds no record for', async () => {
    const { fetch } = stubApi(() => ({ body: { d: null } }));

    const status = await new BingAdapter(fetch).inspectUrl(ctx(), {
      siteUrl: 'https://example.com',
      url: 'https://example.com/missing',
    });

    expect(status).toBeNull();
  });

  it('maps the ThrottleUser error code to a vendor error naming the throttle', async () => {
    const { fetch } = stubApi(() => ({
      status: 400,
      body: { ErrorCode: 4, Message: 'Too many requests' },
    }));

    await expect(
      new BingAdapter(fetch).listQueryStats(ctx(), {
        siteUrl: 'https://example.com',
        ...statsWindow,
      }),
    ).rejects.toThrow(/throttling this API key/);
  });

  it('maps a rejected api key to a vendor error naming the credential', async () => {
    const { fetch } = stubApi(() => ({ status: 401, body: { Message: 'Unauthorized' } }));

    await expect(new BingAdapter(fetch).listProperties(ctx())).rejects.toThrow(
      /rejected the API key/,
    );
  });

  it('submits the batch and reports the quota left after it', async () => {
    const { fetch, calls } = stubApi((url) =>
      url.includes('GetUrlSubmissionQuota')
        ? { body: { d: { DailyQuota: 10, MonthlyQuota: 100 } } }
        : { body: { d: null } },
    );

    const result = await new BingAdapter(fetch).submitUrls(ctx(), {
      siteUrl: 'https://example.com',
      urls: ['https://example.com/a', 'https://example.com/b'],
    });

    expect(result).toEqual({ submitted: 2, dailyQuotaRemaining: 8, monthlyQuotaRemaining: 98 });
    const submit = calls.find((c) => c.url.includes('SubmitUrlBatch'))!;
    expect(submit.method).toBe('POST');
    expect(submit.body).toEqual({
      siteUrl: 'https://example.com',
      urlList: ['https://example.com/a', 'https://example.com/b'],
    });
  });

  it('rejects a batch over the remaining daily quota before submitting anything', async () => {
    const { fetch, calls } = stubApi(() => ({ body: { d: { DailyQuota: 1, MonthlyQuota: 100 } } }));

    const err = await new BingAdapter(fetch)
      .submitUrls(ctx(), {
        siteUrl: 'https://example.com',
        urls: ['https://example.com/a', 'https://example.com/b'],
      })
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ConnectorVendorError);
    expect((err as ConnectorVendorError).quotaExceeded).toBe(true);
    expect(calls.some((c) => c.url.includes('SubmitUrlBatch'))).toBe(false);
  });

  it('rejects a batch over Bing’s per-call cap without spending a quota call', async () => {
    const { fetch, calls } = stubApi(() => ({ body: { d: null } }));

    const err = await new BingAdapter(fetch)
      .submitUrls(ctx(), {
        siteUrl: 'https://example.com',
        urls: Array.from({ length: 501 }, (_, i) => `https://example.com/${i}`),
      })
      .catch((e: unknown) => e);

    expect((err as ConnectorVendorError).quotaExceeded).toBe(true);
    expect(calls).toHaveLength(0);
  });

  it('keeps the encrypted key out of publicConfig and reuses it when no new key is given', async () => {
    const adapter = new BingAdapter();

    expect(adapter.publicConfig({ encryptedApiKey: 'ct_abc' })).toEqual({});
    await expect(
      adapter.buildStoredConfig({}, () => Promise.resolve('ct_new'), {
        encryptedApiKey: 'ct_abc',
      }),
    ).resolves.toEqual({ encryptedApiKey: 'ct_abc' });
    await expect(adapter.buildStoredConfig({}, () => Promise.resolve('ct_new'))).rejects.toThrow(
      /apiKey is required/,
    );
  });

  it('fails the connection test when the key has no verified sites', async () => {
    const { fetch } = stubApi(() => ({
      body: { d: [{ Url: 'https://example.com', IsVerified: false }] },
    }));

    await expect(new BingAdapter(fetch).testConnection(ctx())).rejects.toThrow(
      /no verified sites are attached/,
    );
  });
});
