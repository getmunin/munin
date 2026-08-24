import { describe, expect, it } from 'vitest';
import { GoogleSearchConsoleAdapter } from './google-search-console.adapter.ts';
import { ConnectorVendorError, type ConnectorFetch } from '../connectors/http.ts';
import { OAuthGrantRevokedError, type ConnectorConnectionContext } from '../connectors/connector.ts';
import type { SeoAdapter } from './seo-adapter.ts';

interface StubCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | null;
}

function stubApi(respond: (call: StubCall) => { status?: number; body: unknown }): {
  fetch: ConnectorFetch;
  calls: StubCall[];
} {
  const calls: StubCall[] = [];
  const fetch: ConnectorFetch = (url, init) => {
    const call: StubCall = {
      url,
      method: init.method ?? 'GET',
      headers: (init.headers as Record<string, string>) ?? {},
      body: init.body ?? null,
    };
    calls.push(call);
    const { status = 200, body } = respond(call);
    return Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(body),
      text: () => Promise.resolve(body === undefined ? '' : JSON.stringify(body)),
    });
  };
  return { fetch, calls };
}

function ctx(accessToken = 'ya29.token'): ConnectorConnectionContext {
  return {
    config: { clientId: 'cid.apps.googleusercontent.com', encryptedClientSecret: 'ct' },
    decryptSecret: () => Promise.resolve('csecret'),
    accessToken: () => Promise.resolve(accessToken),
  };
}

const client = { clientId: 'cid.apps.googleusercontent.com', clientSecret: 'csecret' };
const statsWindow = { from: '2026-01-01', to: '2026-03-31', limit: 50 };

const row = (date: string, key: string, over: Record<string, unknown> = {}) => ({
  keys: [date, key],
  clicks: 0,
  impressions: 0,
  position: 1,
  ...over,
});

describe('GoogleSearchConsoleAdapter', () => {
  it('asks for offline access and forced consent so a re-auth still yields a refresh token', () => {
    const url = new URL(
      new GoogleSearchConsoleAdapter().oauth.authorizeUrl({
        state: 'st4te',
        redirectUri: 'https://munin.test/v1/connectors/oauth/callback',
        clientId: client.clientId,
      }),
    );

    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(url.searchParams.get('access_type')).toBe('offline');
    expect(url.searchParams.get('prompt')).toBe('consent');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('state')).toBe('st4te');
    expect(url.searchParams.get('scope')).toBe(
      'https://www.googleapis.com/auth/webmasters.readonly',
    );
  });

  it('exchanges an authorization code for both tokens', async () => {
    const { fetch, calls } = stubApi(() => ({
      body: { access_token: 'at_1', refresh_token: 'rt_1', expires_in: 3599 },
    }));

    const tokens = await new GoogleSearchConsoleAdapter(fetch).oauth.exchangeCode({
      code: 'code-1',
      redirectUri: 'https://munin.test/cb',
      client,
    });

    expect(tokens).toEqual({
      accessToken: 'at_1',
      refreshToken: 'rt_1',
      expiresInSeconds: 3599,
    });
    expect(calls[0]!.url).toBe('https://oauth2.googleapis.com/token');
    expect(calls[0]!.body).toContain('grant_type=authorization_code');
    expect(calls[0]!.body).toContain('client_secret=csecret');
  });

  it('translates invalid_grant on refresh into a revoked-grant error, not a vendor fault', async () => {
    const { fetch } = stubApi(() => ({
      status: 400,
      body: { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' },
    }));

    const err = await new GoogleSearchConsoleAdapter(fetch).oauth
      .refresh({ refreshToken: 'rt_1', client })
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(OAuthGrantRevokedError);
    expect((err as Error).message).toBe('Token has been expired or revoked.');
  });

  it('keeps other token failures as vendor errors so they are not mistaken for revocation', async () => {
    const { fetch } = stubApi(() => ({
      status: 500,
      body: { error: 'backend_error' },
    }));

    const err = await new GoogleSearchConsoleAdapter(fetch).oauth
      .refresh({ refreshToken: 'rt_1', client })
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ConnectorVendorError);
    expect(err).not.toBeInstanceOf(OAuthGrantRevokedError);
  });

  it('lists properties and treats an unverified one as unusable', async () => {
    const { fetch, calls } = stubApi(() => ({
      body: {
        siteEntry: [
          { siteUrl: 'https://example.com/', permissionLevel: 'siteOwner' },
          { siteUrl: 'sc-domain:other.test', permissionLevel: 'siteUnverifiedUser' },
        ],
      },
    }));

    const properties = await new GoogleSearchConsoleAdapter(fetch).listProperties(ctx());

    expect(properties).toEqual([
      { siteUrl: 'https://example.com/', verified: true },
      { siteUrl: 'sc-domain:other.test', verified: false },
    ]);
    expect(calls[0]!.headers.authorization).toBe('Bearer ya29.token');
  });

  it('aggregates the date+query rows and reports the window they actually cover', async () => {
    const { fetch, calls } = stubApi(() => ({
      body: {
        rows: [
          row('2026-02-01', 'munin mcp', { impressions: 100, clicks: 2, position: 10 }),
          row('2026-02-08', 'munin mcp', { impressions: 300, clicks: 10, position: 2 }),
          row('2026-02-08', 'quiet query', { impressions: 5, clicks: 0, position: 40 }),
        ],
      },
    }));

    const result = await new GoogleSearchConsoleAdapter(fetch).listQueryStats(ctx(), {
      siteUrl: 'https://example.com/',
      ...statsWindow,
    });

    expect(result.queries).toEqual([
      { query: 'munin mcp', impressions: 400, clicks: 12, ctr: 0.03, avgPosition: 4 },
      { query: 'quiet query', impressions: 5, clicks: 0, ctr: 0, avgPosition: 40 },
    ]);
    expect(result.window).toEqual({ from: '2026-02-01', to: '2026-02-08' });
    const body = JSON.parse(calls[0]!.body!) as Record<string, unknown>;
    expect(body.dimensions).toEqual(['date', 'query']);
    expect(body.startDate).toBe('2026-01-01');
    expect(body.endDate).toBe('2026-03-31');
  });

  it('url-encodes the property in the path so sc-domain and https properties both work', async () => {
    const { fetch, calls } = stubApi(() => ({ body: { rows: [] } }));

    await new GoogleSearchConsoleAdapter(fetch).listPageStats(ctx(), {
      siteUrl: 'sc-domain:example.com',
      ...statsWindow,
    });

    expect(calls[0]!.url).toBe(
      'https://searchconsole.googleapis.com/webmasters/v3/sites/sc-domain%3Aexample.com/searchAnalytics/query',
    );
    expect((JSON.parse(calls[0]!.body!) as { dimensions: string[] }).dimensions).toEqual([
      'date',
      'page',
    ]);
  });

  it('returns a null window when the range holds no rows', async () => {
    const { fetch } = stubApi(() => ({ body: {} }));

    const result = await new GoogleSearchConsoleAdapter(fetch).listQueryStats(ctx(), {
      siteUrl: 'https://example.com/',
      ...statsWindow,
    });

    expect(result).toEqual({ window: null, queries: [] });
  });

  it('reports coverage state as the index detail Google gives instead of an http status', async () => {
    const { fetch, calls } = stubApi(() => ({
      body: {
        inspectionResult: {
          indexStatusResult: {
            verdict: 'PASS',
            coverageState: 'Submitted and indexed',
            lastCrawlTime: '2026-03-18T04:12:00Z',
          },
        },
      },
    }));

    const status = await new GoogleSearchConsoleAdapter(fetch).inspectUrl(ctx(), {
      siteUrl: 'https://example.com/',
      url: 'https://example.com/pricing',
    });

    expect(status).toEqual({
      url: 'https://example.com/pricing',
      indexed: true,
      detail: 'Submitted and indexed',
      httpStatus: null,
      lastCrawledAt: '2026-03-18T04:12:00Z',
      discoveredAt: null,
      inboundAnchorCount: null,
    });
    expect(calls[0]!.url).toBe(
      'https://searchconsole.googleapis.com/v1/urlInspection/index:inspect',
    );
  });

  it('reports a crawled-but-not-indexed url as not indexed', async () => {
    const { fetch } = stubApi(() => ({
      body: {
        inspectionResult: {
          indexStatusResult: {
            verdict: 'NEUTRAL',
            coverageState: 'Crawled - currently not indexed',
          },
        },
      },
    }));

    const status = await new GoogleSearchConsoleAdapter(fetch).inspectUrl(ctx(), {
      siteUrl: 'https://example.com/',
      url: 'https://example.com/thin',
    });

    expect(status?.indexed).toBe(false);
    expect(status?.detail).toBe('Crawled - currently not indexed');
  });

  it('returns null when Google holds no inspection result at all', async () => {
    const { fetch } = stubApi(() => ({ body: { inspectionResult: {} } }));

    await expect(
      new GoogleSearchConsoleAdapter(fetch).inspectUrl(ctx(), {
        siteUrl: 'https://example.com/',
        url: 'https://example.com/missing',
      }),
    ).resolves.toBeNull();
  });

  it('does not offer URL submission, since Search Console has no such endpoint', () => {
    const adapter: SeoAdapter = new GoogleSearchConsoleAdapter();
    expect('submitUrls' in adapter).toBe(false);
  });

  it('explains a 403 as a property-access problem rather than a generic failure', async () => {
    const { fetch } = stubApi(() => ({ status: 403, body: {} }));

    await expect(new GoogleSearchConsoleAdapter(fetch).listProperties(ctx())).rejects.toThrow(
      /may lack access to that property/,
    );
  });

  it('names rate limiting distinctly from other request failures', async () => {
    const { fetch } = stubApi(() => ({ status: 429, body: {} }));

    await expect(new GoogleSearchConsoleAdapter(fetch).listProperties(ctx())).rejects.toThrow(
      /rate-limiting/,
    );
  });

  it('fails the connection test when the account owns no verified property', async () => {
    const { fetch } = stubApi(() => ({
      body: { siteEntry: [{ siteUrl: 'https://x.test/', permissionLevel: 'siteUnverifiedUser' }] },
    }));

    await expect(new GoogleSearchConsoleAdapter(fetch).testConnection(ctx())).rejects.toThrow(
      /no verified Search Console properties/,
    );
  });

  it('keeps the stored client secret out of publicConfig and reuses it on update', async () => {
    const adapter = new GoogleSearchConsoleAdapter();
    const stored = { clientId: 'cid.apps.googleusercontent.com', encryptedClientSecret: 'ct_old' };

    expect(adapter.publicConfig(stored)).toEqual({ clientId: 'cid.apps.googleusercontent.com' });
    await expect(
      adapter.buildStoredConfig(
        { clientId: 'cid.apps.googleusercontent.com' },
        () => Promise.resolve('ct_new'),
        stored,
      ),
    ).resolves.toEqual(stored);
  });

  it('refuses to build a config with no client secret anywhere', async () => {
    await expect(
      new GoogleSearchConsoleAdapter().buildStoredConfig(
        { clientId: 'cid.apps.googleusercontent.com' },
        () => Promise.resolve('ct'),
      ),
    ).rejects.toThrow(/clientSecret is required/);
  });
});
