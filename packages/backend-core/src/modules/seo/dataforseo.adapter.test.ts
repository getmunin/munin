import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DataForSeoAdapter } from './dataforseo.adapter.ts';
import { DATAFORSEO_MARKETS } from './dataforseo.markets.ts';
import { estimateDataForSeoCostUsd } from './dataforseo.pricing.ts';
import { SeoResearchVendorError } from './seo-adapter.ts';
import { ConnectorVendorError, type ConnectorFetch } from '../connectors/http.ts';
import type { ConnectorConnectionContext } from '../connectors/connector.ts';

const LOGIN = 'api-user@example.com';
const PASSWORD = 'dfs-password-plaintext';

function fixture(name: string): unknown {
  return JSON.parse(
    readFileSync(new URL(`./__fixtures__/dataforseo/${name}.json`, import.meta.url), 'utf8'),
  );
}

interface StubCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
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
      headers: init.headers ?? {},
      body: init.body ? (JSON.parse(init.body) as unknown) : null,
    });
    const { status = 200, body } = respond(url);
    return Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(body),
      text: () => Promise.resolve(JSON.stringify(body)),
    });
  };
  return { fetch, calls };
}

function ctx(): ConnectorConnectionContext {
  return {
    config: { encryptedLogin: 'ct_login', encryptedPassword: 'ct_password' },
    decryptSecret: (ciphertext) =>
      Promise.resolve(ciphertext === 'ct_login' ? LOGIN : PASSWORD),
  };
}

const norway = { market: 'norway', language: 'norwegian', mode: 'live' } as const;

function captureError(promise: Promise<unknown>): Promise<Error> {
  return promise.then(
    () => {
      throw new Error('expected the call to fail');
    },
    (err: unknown) => err as Error,
  );
}

describe('DataForSeoAdapter', () => {
  it('encrypts both login and password and exposes neither in the public config', async () => {
    const adapter = new DataForSeoAdapter();
    const stored = await adapter.buildStoredConfig(
      { login: LOGIN, password: PASSWORD },
      (plaintext) => Promise.resolve(`enc(${plaintext.length})`),
    );

    expect(JSON.stringify(stored)).not.toContain(LOGIN);
    expect(JSON.stringify(stored)).not.toContain(PASSWORD);
    expect(adapter.publicConfig(stored)).toEqual({});
  });

  it('keeps the stored ciphertext for a field the update leaves out', async () => {
    const adapter = new DataForSeoAdapter();
    const stored = await adapter.buildStoredConfig(
      { password: 'a-new-password' },
      () => Promise.resolve('enc_new'),
      { encryptedLogin: 'enc_login', encryptedPassword: 'enc_old' },
    );

    expect(stored).toEqual({ encryptedLogin: 'enc_login', encryptedPassword: 'enc_new' });
  });

  it('refuses to build a config without both credentials', async () => {
    await expect(
      new DataForSeoAdapter().buildStoredConfig({ login: LOGIN }, () => Promise.resolve('x')),
    ).rejects.toThrow(/login and password are both required/);
  });

  it('marks both credential fields secret so they go through the credential link', () => {
    const fields = new DataForSeoAdapter().configFields;
    expect(fields.map((f) => [f.key, f.secret])).toEqual([
      ['login', true],
      ['password', true],
    ]);
  });

  it('authenticates with HTTP Basic and reports the balance as the connection test', async () => {
    const { fetch, calls } = stubApi(() => ({ body: fixture('user-data') }));

    const result = await new DataForSeoAdapter(fetch).testConnection(ctx());

    expect(result).toEqual({
      ok: true,
      detail: 'credentials accepted; account balance $42.50',
      summary: 'Balance $42.50',
    });
    expect(calls[0]!.url).toBe('https://api.dataforseo.com/v3/appendix/user_data');
    expect(calls[0]!.method).toBe('GET');
    expect(calls[0]!.headers.authorization).toBe(
      `Basic ${Buffer.from(`${LOGIN}:${PASSWORD}`).toString('base64')}`,
    );
    expect(calls[0]!.url).not.toContain(LOGIN);
  });

  it('normalizes the account balance and treats a zero daily limit as no limit', async () => {
    const { fetch } = stubApi(() => ({ body: fixture('user-data') }));

    const balance = await new DataForSeoAdapter(fetch).getBalance(ctx());

    expect(balance).toEqual({
      balanceUsd: 42.5,
      totalDepositedUsd: 100,
      spentTodayUsd: 1.25,
      dailyLimitUsd: null,
      costUsd: 0,
    });
  });

  it('sends one search-volume task for Norway without a language and maps the competition index', async () => {
    const { fetch, calls } = stubApi(() => ({ body: fixture('search-volume') }));

    const page = await new DataForSeoAdapter(fetch).keywordVolume(ctx(), {
      ...norway,
      keywords: ['kundeservice ai', 'chatbot nettbutikk', 'telefonsvarer ai'],
    });

    expect(calls[0]!.url).toBe(
      'https://api.dataforseo.com/v3/keywords_data/google_ads/search_volume/live',
    );
    expect(calls[0]!.body).toEqual([
      {
        keywords: ['kundeservice ai', 'chatbot nettbutikk', 'telefonsvarer ai'],
        location_code: 2578,
      },
    ]);
    expect(page.costUsd).toBe(0.09);
    expect(page.rows.map((r) => r.keyword)).toEqual([
      'chatbot nettbutikk',
      'kundeservice ai',
      'telefonsvarer ai',
    ]);
    expect(page.rows[0]).toEqual({
      keyword: 'chatbot nettbutikk',
      volume: 720,
      cpc: 4.3,
      competition: 0.81,
      competitionLevel: 'HIGH',
      monthly: [
        { year: 2026, month: 8, volume: 720 },
        { year: 2026, month: 7, volume: 680 },
      ],
    });
    expect(page.rows[2]).toMatchObject({ keyword: 'telefonsvarer ai', volume: null, cpc: null });
    expect(page.noData).toBe(false);
  });

  it('asks Labs for keyword ideas with the Bokmål language code', async () => {
    const { fetch, calls } = stubApi(() => ({ body: fixture('keyword-ideas') }));

    const page = await new DataForSeoAdapter(fetch).keywordIdeas(ctx(), {
      ...norway,
      seeds: ['kundeservice ai'],
      limit: 3,
    });

    expect(calls[0]!.url).toBe(
      'https://api.dataforseo.com/v3/dataforseo_labs/google/keyword_ideas/live',
    );
    expect(calls[0]!.body).toEqual([
      { keywords: ['kundeservice ai'], limit: 3, location_code: 2578, language_code: 'nb' },
    ]);
    expect(page.totalCount).toBe(1840);
    expect(page.rows[0]).toEqual({
      keyword: 'ai kundeservice',
      volume: 880,
      cpc: 5.4,
      competition: 0.42,
      competitionLevel: 'MEDIUM',
      difficulty: 31,
      intent: 'commercial',
    });
    expect(page.rows[2]).toMatchObject({ volume: 50, cpc: null, difficulty: null });
  });

  it('reads position and ranking URL from ranked keywords, ordered by volume', async () => {
    const { fetch, calls } = stubApi(() => ({ body: fixture('ranked-keywords') }));

    const page = await new DataForSeoAdapter(fetch).rankedKeywords(ctx(), {
      ...norway,
      domain: 'competitor.example',
      limit: 2,
    });

    expect(calls[0]!.body).toEqual([
      {
        target: 'competitor.example',
        limit: 2,
        order_by: ['keyword_data.keyword_info.search_volume,desc'],
        location_code: 2578,
        language_code: 'nb',
      },
    ]);
    expect(page.totalCount).toBe(412);
    expect(page.rows[0]).toEqual({
      keyword: 'chatbot nettbutikk',
      volume: 720,
      cpc: 4.3,
      competition: 0.81,
      competitionLevel: 'HIGH',
      position: 3,
      url: 'https://competitor.example/nettbutikk',
      intent: 'commercial',
    });
  });

  it('asks domain_intersection for keywords only the first domain ranks for', async () => {
    const { fetch, calls } = stubApi(() => ({ body: fixture('domain-intersection') }));

    const page = await new DataForSeoAdapter(fetch).keywordsOnlyFirstRanksFor(ctx(), {
      ...norway,
      first: 'competitor.example',
      second: 'example.no',
      limit: 2,
    });

    expect(calls[0]!.body).toEqual([
      {
        target1: 'competitor.example',
        target2: 'example.no',
        intersections: false,
        limit: 2,
        order_by: ['keyword_data.keyword_info.search_volume,desc'],
        location_code: 2578,
        language_code: 'nb',
      },
    ]);
    expect(page.costUsd).toBe(0.01224);
    expect(page.rows.map((r) => [r.keyword, r.position, r.url])).toEqual([
      ['chatbot nettbutikk', 3, 'https://competitor.example/nettbutikk'],
      ['ai kundeservice', 5, 'https://competitor.example/kundeservice'],
    ]);
  });

  it('keeps only organic results from a SERP and uses the SERP language code', async () => {
    const { fetch, calls } = stubApi(() => ({ body: fixture('serp-organic') }));

    const page = await new DataForSeoAdapter(fetch).serpSnapshot(ctx(), {
      ...norway,
      keyword: 'kundeservice ai',
      depth: 10,
    });

    expect(calls[0]!.url).toBe('https://api.dataforseo.com/v3/serp/google/organic/live/advanced');
    expect(calls[0]!.body).toEqual([
      { keyword: 'kundeservice ai', depth: 10, location_code: 2578, language_code: 'no' },
    ]);
    expect(page.rows).toEqual([
      {
        position: 1,
        url: 'https://competitor.example/kundeservice',
        domain: 'competitor.example',
        title: 'AI-kundeservice for nettbutikker',
      },
      { position: 2, url: 'https://example.no/', domain: 'example.no', title: 'Example AS' },
    ]);
  });

  it('turns an HTTP 401 into an auth error without echoing the credentials', async () => {
    const { fetch } = stubApi(() => ({ status: 401, body: fixture('error-bad-credentials') }));

    const err = await captureError(new DataForSeoAdapter(fetch).getBalance(ctx()));

    expect(err).toBeInstanceOf(SeoResearchVendorError);
    expect((err as SeoResearchVendorError).kind).toBe('auth');
    expect(err.message).toContain('HTTP 401');
    expect(err.message).not.toContain(LOGIN);
    expect(err.message).not.toContain(PASSWORD);
  });

  it('reads insufficient balance from a task-level status on an HTTP 200', async () => {
    const { fetch } = stubApi(() => ({ body: fixture('error-insufficient-balance') }));

    const err = await captureError(
      new DataForSeoAdapter(fetch).keywordsOnlyFirstRanksFor(ctx(), {
        ...norway,
        first: 'competitor.example',
        second: 'example.no',
        limit: 50,
      }),
    );

    expect((err as SeoResearchVendorError).kind).toBe('balance');
    expect(err.message).toContain('40210');
  });

  it('classifies an envelope-level rate limit', async () => {
    const { fetch } = stubApi(() => ({ body: fixture('error-rate-limited') }));

    const err = await captureError(
      new DataForSeoAdapter(fetch).keywordVolume(ctx(), { ...norway, keywords: ['x'] }),
    );

    expect((err as SeoResearchVendorError).kind).toBe('rate_limited');
  });

  it('classifies an invalid location field as an invalid market', async () => {
    const { fetch } = stubApi(() => ({ body: fixture('error-invalid-location') }));

    const err = await captureError(
      new DataForSeoAdapter(fetch).rankedKeywords(ctx(), {
        ...norway,
        domain: 'competitor.example',
        limit: 10,
      }),
    );

    expect((err as SeoResearchVendorError).kind).toBe('invalid_market');
  });

  it('classifies a reached spending limit and a paused account distinctly', async () => {
    const respond = (code: number) => ({
      body: {
        status_code: 20000,
        cost: 0,
        tasks: [{ status_code: code, status_message: 'refused', cost: 0, result: null }],
      },
    });

    const limit = await captureError(
      new DataForSeoAdapter(stubApi(() => respond(40203)).fetch).getBalance(ctx()),
    );
    const paused = await captureError(
      new DataForSeoAdapter(stubApi(() => respond(40201)).fetch).getBalance(ctx()),
    );

    expect((limit as SeoResearchVendorError).kind).toBe('spend_limit');
    expect(paused).toBeInstanceOf(ConnectorVendorError);
    expect(paused).not.toBeInstanceOf(SeoResearchVendorError);
    expect(paused.message).toContain('40201');
  });

  it('reports no results as an empty page flagged noData, not as an error', async () => {
    const { fetch } = stubApi(() => ({ body: fixture('no-results') }));

    const page = await new DataForSeoAdapter(fetch).keywordsOnlyFirstRanksFor(ctx(), {
      ...norway,
      first: 'competitor.example',
      second: 'example.no',
      limit: 50,
    });

    expect(page).toEqual({ rows: [], totalCount: null, costUsd: 0, noData: true });
  });

  it('refuses a language the endpoint family does not offer before sending anything', async () => {
    const { fetch, calls } = stubApi(() => ({ body: fixture('keyword-ideas') }));

    const err = await captureError(
      new DataForSeoAdapter(fetch).keywordIdeas(ctx(), {
        market: 'norway',
        language: 'english',
        mode: 'live',
        seeds: ['ai'],
        limit: 5,
      }),
    );

    expect((err as SeoResearchVendorError).kind).toBe('invalid_market');
    expect(calls).toHaveLength(0);
  });

  it('knows which market and language pairs each endpoint family serves', () => {
    const adapter = new DataForSeoAdapter();
    expect(adapter.supportsMarket('keyword_ideas', 'norway', 'norwegian')).toBe(true);
    expect(adapter.supportsMarket('keyword_ideas', 'norway', 'english')).toBe(false);
    expect(adapter.supportsMarket('serp_snapshot', 'norway', 'english')).toBe(true);
    expect(adapter.supportsMarket('keyword_volume', 'sweden', 'swedish')).toBe(true);
    expect(adapter.supportsMarket('keyword_volume', 'uk', 'norwegian')).toBe(false);
  });
});

describe('DataForSEO market table', () => {
  it('uses the location codes DataForSEO publishes for all four markets in every API', () => {
    for (const api of ['labs', 'google_ads', 'serp'] as const) {
      expect(
        Object.fromEntries(
          Object.entries(DATAFORSEO_MARKETS[api]).map(([m, c]) => [m, c.locationCode]),
        ),
      ).toEqual({ norway: 2578, sweden: 2752, denmark: 2208, uk: 2826 });
    }
  });

  it('uses Bokmål for Labs and the plain Norwegian code for SERP', () => {
    expect(DATAFORSEO_MARKETS.labs.norway.languages).toEqual({ norwegian: 'nb' });
    expect(DATAFORSEO_MARKETS.serp.norway.languages.norwegian).toBe('no');
  });
});

describe('DataForSEO pricing', () => {
  it('charges Labs per task plus per item', () => {
    expect(
      estimateDataForSeoCostUsd('domain_intersection', { mode: 'live', tasks: 3, items: 300 }),
    ).toBeCloseTo(3 * 0.012 + 300 * 0.00012, 10);
  });

  it('charges search volume one flat price regardless of keyword count', () => {
    const one = estimateDataForSeoCostUsd('keyword_volume', { mode: 'live', tasks: 1, items: 1 });
    const many = estimateDataForSeoCostUsd('keyword_volume', {
      mode: 'live',
      tasks: 1,
      items: 1000,
    });
    expect(one).toBe(0.09);
    expect(many).toBe(0.09);
  });

  it('charges SERP per started page of ten results', () => {
    const at = (depth: number) =>
      estimateDataForSeoCostUsd('serp_snapshot', { mode: 'live', tasks: 1, items: depth, depth });
    expect(at(10)).toBeCloseTo(0.002, 10);
    expect(at(11)).toBeCloseTo(0.004, 10);
    expect(at(100)).toBeCloseTo(0.02, 10);
  });

  it('prices the balance check at zero', () => {
    expect(estimateDataForSeoCostUsd('balance', { mode: 'live', tasks: 1, items: 0 })).toBe(0);
  });
});
