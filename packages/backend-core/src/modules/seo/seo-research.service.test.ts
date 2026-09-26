import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BadGatewayException, BadRequestException, HttpException } from '@nestjs/common';
import { ConnectorRegistry } from '../connectors/connector.ts';
import { ConnectorsService, type ConnectionRow } from '../connectors/connectors.service.ts';
import type { ConnectorFetch } from '../connectors/http.ts';
import { DataForSeoAdapter } from './dataforseo.adapter.ts';
import {
  SeoResearchService,
  normalizeDomain,
  normalizeKeywords,
  type ResearchConnectorAccess,
} from './seo-research.service.ts';

function fixture(name: string): unknown {
  return JSON.parse(
    readFileSync(new URL(`./__fixtures__/dataforseo/${name}.json`, import.meta.url), 'utf8'),
  );
}

interface StubCall {
  url: string;
  body: Array<Record<string, unknown>> | null;
}

function setup(respond: (call: StubCall) => { status?: number; body: unknown }) {
  const calls: StubCall[] = [];
  const fetch: ConnectorFetch = (url, init) => {
    const call = {
      url,
      body: init.body ? (JSON.parse(init.body) as Array<Record<string, unknown>>) : null,
    };
    calls.push(call);
    const { status = 200, body } = respond(call);
    return Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(body),
      text: () => Promise.resolve(JSON.stringify(body)),
    });
  };
  const adapter = new DataForSeoAdapter(fetch);
  const now = new Date();
  const row: ConnectionRow = {
    id: 'cnc_research',
    orgId: 'org_test',
    vendor: 'dataforseo',
    domain: 'seo',
    name: 'DataForSEO',
    config: { encryptedLogin: 'login', encryptedPassword: 'password' },
    active: true,
    credentialState: 'active',
    lastTestedAt: null,
    lastTestError: null,
    createdAt: now,
    updatedAt: now,
  };
  const trunk = new ConnectorsService(new ConnectorRegistry([adapter]));
  const access: ResearchConnectorAccess = {
    resolveScope: () => Promise.resolve({ connection: row, adapter }),
    connectionContext: (r) => ({ config: r.config, decryptSecret: (v) => Promise.resolve(v) }),
    vendorCall: (fn) => trunk.vendorCall(fn),
  };
  return { research: new SeoResearchService(access), calls };
}

function intersectionFor(first: string, rows: Array<[string, number | null, number]>, total = 50) {
  return {
    status_code: 20000,
    cost: 0.01224,
    tasks: [
      {
        status_code: 20000,
        cost: 0.01224,
        result: [
          {
            total_count: total,
            items: rows.map(([keyword, volume, rank]) => ({
              keyword_data: {
                keyword,
                keyword_info: { search_volume: volume, cpc: 1.5, competition: 0.3, competition_level: 'LOW' },
                search_intent_info: { main_intent: 'commercial' },
              },
              first_domain_serp_element: {
                rank_group: rank,
                url: `https://${first}/${keyword.replace(/\s+/g, '-')}`,
              },
            })),
          },
        ],
      },
    ],
  };
}

function rejection(promise: Promise<unknown>): Promise<Error> {
  return promise.then(
    () => {
      throw new Error('expected the call to fail');
    },
    (err: unknown) => err as Error,
  );
}

describe('SeoResearchService', () => {
  it('refuses a call whose worst-case estimate exceeds maxCostUsd without contacting the provider', async () => {
    const { research, calls } = setup(() => ({ body: fixture('domain-intersection') }));

    const err = await rejection(
      research.keywordGap({
        location: 'norway',
        domain: 'example.no',
        competitors: ['competitor.example', 'other.example', 'third.example'],
        limit: 500,
        maxCostUsd: 0.05,
      }),
    );

    expect(err).toBeInstanceOf(BadRequestException);
    expect(err.message).toMatch(/^seo_cost_exceeded: this call is estimated at up to \$0\.2160/);
    expect(calls).toHaveLength(0);
  });

  it('runs when the estimate fits and reports estimated and actual cost', async () => {
    const { research, calls } = setup(() => ({ body: fixture('keyword-ideas') }));

    const result = await research.keywordIdeas({
      location: 'norway',
      seeds: ['kundeservice ai'],
      limit: 3,
      maxCostUsd: 0.05,
    });

    expect(calls).toHaveLength(1);
    expect(result.cost).toEqual({ estimatedUsd: 0.01236, actualUsd: 0.01236 });
    expect(result.market).toEqual({ location: 'norway', language: 'norwegian' });
    expect(result.mode).toBe('live');
    expect(result.rowsReturned).toBe(3);
    expect(result.truncated).toBe(true);
    expect(result.noData).toBe(false);
    expect(result.connection).toEqual({ id: 'cnc_research', name: 'DataForSEO', vendor: 'dataforseo' });
  });

  it('merges gap rows across competitors, excluding the target and sorting by volume', async () => {
    const { research, calls } = setup((call) => {
      const first = call.body![0]!.target1 as string;
      return first === 'competitor.example'
        ? { body: intersectionFor(first, [['chatbot nettbutikk', 720, 3], ['ai kundeservice', 880, 5]]) }
        : { body: intersectionFor(first, [['ai kundeservice', 880, 2], ['telefonsvarer', null, 9]]) };
    });

    const result = await research.keywordGap({
      location: 'norway',
      domain: 'https://www.Example.no/',
      competitors: ['competitor.example', 'other.example', 'example.no', 'Competitor.example'],
      limit: 10,
    });

    expect(calls.map((c) => [c.body![0]!.target1, c.body![0]!.target2])).toEqual([
      ['competitor.example', 'example.no'],
      ['other.example', 'example.no'],
    ]);
    expect(result.domain).toBe('example.no');
    expect(result.competitors).toEqual(['competitor.example', 'other.example']);
    expect(result.rows.map((r) => [r.keyword, r.volume, r.competitors.map((c) => c.domain)])).toEqual([
      ['ai kundeservice', 880, ['competitor.example', 'other.example']],
      ['chatbot nettbutikk', 720, ['competitor.example']],
      ['telefonsvarer', null, ['other.example']],
    ]);
    expect(result.rows[0]!.competitors[1]).toEqual({
      domain: 'other.example',
      position: 2,
      url: 'https://other.example/ai-kundeservice',
    });
    expect(result.cost.actualUsd).toBe(0.02448);
    expect(result.truncated).toBe(true);
  });

  it('rejects a gap whose competitors are all the target itself', async () => {
    const { research, calls } = setup(() => ({ body: fixture('domain-intersection') }));

    const err = await rejection(
      research.keywordGap({
        location: 'norway',
        domain: 'example.no',
        competitors: ['www.example.no'],
        limit: 10,
      }),
    );

    expect(err.message).toMatch(/^seo_invalid: competitors must name at least one domain/);
    expect(calls).toHaveLength(0);
  });

  it('flags an empty answer with a reason instead of returning a bare empty list', async () => {
    const { research } = setup(() => ({ body: fixture('no-results') }));

    const result = await research.rankedKeywords({
      location: 'norway',
      domain: 'example.no',
      limit: 10,
    });

    expect(result.rows).toEqual([]);
    expect(result.noData).toBe(true);
    expect(result.reason).toMatch(/DataForSEO has no data for this query in Norway \(norwegian\)/);
  });

  it('translates insufficient balance into a 402 with a machine-readable prefix', async () => {
    const { research } = setup(() => ({ body: fixture('error-insufficient-balance') }));

    const err = await rejection(
      research.keywordGap({
        location: 'norway',
        domain: 'example.no',
        competitors: ['competitor.example'],
        limit: 10,
      }),
    );

    expect(err).toBeInstanceOf(HttpException);
    expect((err as HttpException).getStatus()).toBe(402);
    expect(err.message).toMatch(/^seo_insufficient_balance: /);
  });

  it('translates rejected credentials into seo_vendor_auth', async () => {
    const { research } = setup(() => ({ status: 401, body: fixture('error-bad-credentials') }));

    const err = await rejection(research.providerBalance({}));

    expect(err).toBeInstanceOf(BadGatewayException);
    expect(err.message).toMatch(/^seo_vendor_auth: DataForSEO rejected the stored API credentials/);
  });

  it('translates a rate limit into a 429', async () => {
    const { research } = setup(() => ({ body: fixture('error-rate-limited') }));

    const err = await rejection(research.keywordVolume({ location: 'norway', keywords: ['ai'] }));

    expect((err as HttpException).getStatus()).toBe(429);
    expect(err.message).toMatch(/^seo_rate_limited: /);
  });

  it('keeps unclassified vendor failures on the generic connector error path', async () => {
    const { research } = setup(() => ({
      body: { status_code: 50000, status_message: 'Internal Error.', tasks: [] },
    }));

    const err = await rejection(research.keywordVolume({ location: 'norway', keywords: ['ai'] }));

    expect(err).toBeInstanceOf(BadGatewayException);
    expect(err.message).toBe('connectors_vendor_error: DataForSEO 50000: Internal Error.');
  });

  it('refuses a market and language pair the tool cannot serve before calling out', async () => {
    const { research, calls } = setup(() => ({ body: fixture('keyword-ideas') }));

    const err = await rejection(
      research.keywordIdeas({ location: 'norway', language: 'english', seeds: ['ai'], limit: 5 }),
    );

    expect(err).toBeInstanceOf(BadRequestException);
    expect(err.message).toBe(
      'seo_invalid_market: DataForSEO offers Norway on this tool only in norwegian, not english',
    );
    expect(calls).toHaveLength(0);
  });

  it('names a country with no Labs data rather than billing a doomed request', async () => {
    const { research, calls } = setup(() => ({ body: fixture('keyword-ideas') }));

    const err = await rejection(research.keywordIdeas({ location: 'iceland', seeds: ['ai'], limit: 5 }));

    expect(err.message).toBe('seo_invalid_market: DataForSEO has no data for Iceland on this tool');
    expect(calls).toHaveLength(0);
  });

  it('still serves search volume and SERPs in a country Labs does not cover', async () => {
    const { research, calls } = setup(() => ({ body: fixture('serp-organic') }));

    await research.serpSnapshot({ location: 'iceland', keyword: 'gisting', limit: 10 });

    expect(calls[0]!.body![0]).toMatchObject({ location_code: 2352, language_code: 'is' });
  });

  it('defaults a multilingual country to its main language and accepts the others', async () => {
    const { research, calls } = setup(() => ({ body: fixture('keyword-ideas') }));

    const dutch = await research.keywordIdeas({ location: 'belgium', seeds: ['fiets'], limit: 5 });
    await research.keywordIdeas({ location: 'belgium', language: 'french', seeds: ['vélo'], limit: 5 });

    expect(dutch.market).toEqual({ location: 'belgium', language: 'dutch' });
    expect(calls.map((c) => [c.body![0]!.location_code, c.body![0]!.language_code])).toEqual([
      [2056, 'nl'],
      [2056, 'fr'],
    ]);
  });

  it('covers North America with Labs data for the United States in Spanish', async () => {
    const { research, calls } = setup(() => ({ body: fixture('domain-intersection') }));

    await research.keywordGap({
      location: 'united_states',
      language: 'spanish',
      domain: 'example.com',
      competitors: ['competitor.example'],
      limit: 10,
    });

    expect(calls[0]!.body![0]).toMatchObject({ location_code: 2840, language_code: 'es' });
  });

  it('defaults the language to the market’s own', async () => {
    const { research, calls } = setup(() => ({ body: fixture('serp-organic') }));

    const result = await research.serpSnapshot({ location: 'norway', keyword: 'kundeservice ai', limit: 10 });

    expect(calls[0]!.body![0]!.language_code).toBe('no');
    expect(result.market.language).toBe('norwegian');
    expect(result.keyword).toBe('kundeservice ai');
    expect(result.cost.estimatedUsd).toBe(0.002);
  });

  it('dedupes keywords and caps volume rows at limit while billing one task', async () => {
    const { research, calls } = setup(() => ({ body: fixture('search-volume') }));

    const result = await research.keywordVolume({
      location: 'norway',
      keywords: ['kundeservice ai', ' Kundeservice  AI ', 'chatbot nettbutikk', 'telefonsvarer ai'],
      limit: 2,
    });

    expect(calls[0]!.body![0]!.keywords).toEqual([
      'kundeservice ai',
      'chatbot nettbutikk',
      'telefonsvarer ai',
    ]);
    expect(result.rowsReturned).toBe(2);
    expect(result.truncated).toBe(true);
    expect(result.cost).toEqual({ estimatedUsd: 0.09, actualUsd: 0.09 });
  });

  it('reports balance without charging for it', async () => {
    const { research } = setup(() => ({ body: fixture('user-data') }));

    const balance = await research.providerBalance({});

    expect(balance).toMatchObject({ balanceUsd: 42.5, cost: { estimatedUsd: 0, actualUsd: 0 } });
    expect(balance).not.toHaveProperty('costUsd');
  });
});

describe('normalizeDomain', () => {
  it('strips scheme, www, path and case', () => {
    expect(normalizeDomain('https://www.Example.no/om-oss?x=1')).toBe('example.no');
    expect(normalizeDomain('competitor.example')).toBe('competitor.example');
  });

  it('rejects something that is not a domain', () => {
    expect(() => normalizeDomain('not a domain')).toThrow(/^seo_invalid: /);
    expect(() => normalizeDomain('localhost')).toThrow(/^seo_invalid: /);
  });
});

describe('normalizeKeywords', () => {
  it('collapses whitespace and drops case-insensitive duplicates', () => {
    expect(normalizeKeywords(['ai  chat', 'AI chat', ' ', 'bot'])).toEqual(['ai chat', 'bot']);
  });

  it('rejects an all-empty list', () => {
    expect(() => normalizeKeywords(['  '])).toThrow(/^seo_invalid: /);
  });
});
