import {
  BadGatewayException,
  BadRequestException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
} from '@nestjs/common';
import {
  ConnectorsService,
  connectionSummary,
  type ConnectionScope,
  type ConnectionSummary,
} from '../connectors/connectors.service.ts';
import type { ConnectorCapabilityFilter, ConnectorDomain } from '../connectors/connector.ts';
import {
  SEO_RESEARCH,
  SeoResearchVendorError,
  type SeoIntersectionRow,
  type SeoKeywordIdeaRow,
  type SeoKeywordVolumeRow,
  type SeoLanguage,
  type SeoMarket,
  type SeoMarketArgs,
  type SeoProviderBalance,
  type SeoRankedKeywordRow,
  type SeoResearchAdapter,
  type SeoResearchMode,
  type SeoResearchOperation,
  type SeoResearchPage,
  type SeoSerpRow,
} from './seo-adapter.ts';
import { SEO_MARKET_INFO, defaultLanguage } from './seo-markets.ts';

const MODE: SeoResearchMode = 'live';

interface MarketInput {
  connectionId?: string;
  location: SeoMarket;
  language?: SeoLanguage;
  maxCostUsd?: number;
}

export interface SeoResearchCost {
  estimatedUsd: number;
  actualUsd: number;
}

export interface SeoResearchResult<T> {
  connection: ConnectionSummary;
  market: { location: SeoMarket; language: SeoLanguage };
  mode: SeoResearchMode;
  rows: T[];
  rowsReturned: number;
  truncated: boolean;
  noData: boolean;
  reason?: string;
  cost: SeoResearchCost;
}

export interface SeoGapRow {
  keyword: string;
  volume: number | null;
  cpc: number | null;
  competition: number | null;
  competitionLevel: string | null;
  intent: string | null;
  competitors: Array<{ domain: string; position: number | null; url: string | null }>;
}

export interface ResearchConnectorAccess {
  resolveScope(
    domain: ConnectorDomain,
    connectionId?: string,
    capability?: ConnectorCapabilityFilter,
  ): Promise<ConnectionScope>;
  connectionContext: ConnectorsService['connectionContext'];
  vendorCall<T>(fn: () => Promise<T>): Promise<T>;
}

interface Resolved {
  scope: ConnectionScope;
  adapter: SeoResearchAdapter;
  market: SeoMarketArgs;
}

@Injectable()
export class SeoResearchService {
  constructor(@Inject(ConnectorsService) private readonly connectors: ResearchConnectorAccess) {}

  async providerBalance(args: {
    connectionId?: string;
    maxCostUsd?: number;
  }): Promise<{ connection: ConnectionSummary; cost: SeoResearchCost } & Omit<SeoProviderBalance, 'costUsd'>> {
    const scope = await this.connectors.resolveScope('seo', args.connectionId, SEO_RESEARCH);
    const adapter = scope.adapter as SeoResearchAdapter;
    const estimatedUsd = gate(adapter, 'balance', { mode: MODE, tasks: 1, items: 0 }, args.maxCostUsd);
    const { costUsd, ...balance } = await this.call(adapter, () =>
      adapter.getBalance(this.connectors.connectionContext(scope.connection)),
    );
    return {
      connection: connectionSummary(scope.connection),
      ...balance,
      cost: { estimatedUsd, actualUsd: costUsd },
    };
  }

  async keywordVolume(
    args: MarketInput & { keywords: string[]; limit?: number },
  ): Promise<SeoResearchResult<SeoKeywordVolumeRow>> {
    const keywords = normalizeKeywords(args.keywords);
    const { scope, adapter, market } = await this.resolve('keyword_volume', args);
    const estimatedUsd = gate(
      adapter,
      'keyword_volume',
      { mode: MODE, tasks: 1, items: keywords.length },
      args.maxCostUsd,
    );
    const page = await this.call(adapter, () =>
      adapter.keywordVolume(this.connectors.connectionContext(scope.connection), {
        ...market,
        keywords,
      }),
    );
    return this.envelope(scope, adapter, market, page, args.limit ?? keywords.length, estimatedUsd);
  }

  async keywordIdeas(
    args: MarketInput & { seeds: string[]; limit: number },
  ): Promise<SeoResearchResult<SeoKeywordIdeaRow>> {
    const seeds = normalizeKeywords(args.seeds);
    const { scope, adapter, market } = await this.resolve('keyword_ideas', args);
    const estimatedUsd = gate(
      adapter,
      'keyword_ideas',
      { mode: MODE, tasks: 1, items: args.limit },
      args.maxCostUsd,
    );
    const page = await this.call(adapter, () =>
      adapter.keywordIdeas(this.connectors.connectionContext(scope.connection), {
        ...market,
        seeds,
        limit: args.limit,
      }),
    );
    return this.envelope(scope, adapter, market, page, args.limit, estimatedUsd);
  }

  async rankedKeywords(
    args: MarketInput & { domain: string; limit: number },
  ): Promise<SeoResearchResult<SeoRankedKeywordRow> & { domain: string }> {
    const domain = normalizeDomain(args.domain);
    const { scope, adapter, market } = await this.resolve('ranked_keywords', args);
    const estimatedUsd = gate(
      adapter,
      'ranked_keywords',
      { mode: MODE, tasks: 1, items: args.limit },
      args.maxCostUsd,
    );
    const page = await this.call(adapter, () =>
      adapter.rankedKeywords(this.connectors.connectionContext(scope.connection), {
        ...market,
        domain,
        limit: args.limit,
      }),
    );
    return { domain, ...this.envelope(scope, adapter, market, page, args.limit, estimatedUsd) };
  }

  async keywordGap(
    args: MarketInput & { domain: string; competitors: string[]; limit: number },
  ): Promise<SeoResearchResult<SeoGapRow> & { domain: string; competitors: string[] }> {
    const domain = normalizeDomain(args.domain);
    const competitors = [...new Set(args.competitors.map(normalizeDomain))].filter(
      (c) => c !== domain,
    );
    if (competitors.length === 0) {
      throw new BadRequestException(
        'seo_invalid: competitors must name at least one domain other than the target domain',
      );
    }
    const { scope, adapter, market } = await this.resolve('domain_intersection', args);
    const estimatedUsd = gate(
      adapter,
      'domain_intersection',
      { mode: MODE, tasks: competitors.length, items: args.limit * competitors.length },
      args.maxCostUsd,
    );

    const byKeyword = new Map<string, SeoGapRow>();
    let actualUsd = 0;
    let truncated = false;
    for (const competitor of competitors) {
      const page = await this.call(adapter, () =>
        adapter.keywordsOnlyFirstRanksFor(this.connectors.connectionContext(scope.connection), {
          ...market,
          first: competitor,
          second: domain,
          limit: args.limit,
        }),
      );
      actualUsd += page.costUsd;
      if (page.totalCount !== null && page.totalCount > page.rows.length) truncated = true;
      for (const row of page.rows) mergeGapRow(byKeyword, competitor, row);
    }

    const merged = [...byKeyword.values()].sort(
      (a, b) =>
        (b.volume ?? -1) - (a.volume ?? -1) ||
        b.competitors.length - a.competitors.length ||
        a.keyword.localeCompare(b.keyword),
    );
    const rows = merged.slice(0, args.limit);
    return {
      connection: connectionSummary(scope.connection),
      domain,
      competitors,
      market: { location: market.market, language: market.language },
      mode: MODE,
      rows,
      rowsReturned: rows.length,
      truncated: truncated || merged.length > rows.length,
      noData: rows.length === 0,
      ...(rows.length === 0 ? { reason: noDataReason(adapter, market) } : {}),
      cost: { estimatedUsd, actualUsd: roundUsd(actualUsd) },
    };
  }

  async serpSnapshot(
    args: MarketInput & { keyword: string; limit: number },
  ): Promise<SeoResearchResult<SeoSerpRow> & { keyword: string }> {
    const [keyword] = normalizeKeywords([args.keyword]);
    const { scope, adapter, market } = await this.resolve('serp_snapshot', args);
    const estimatedUsd = gate(
      adapter,
      'serp_snapshot',
      { mode: MODE, tasks: 1, items: args.limit, depth: args.limit },
      args.maxCostUsd,
    );
    const page = await this.call(adapter, () =>
      adapter.serpSnapshot(this.connectors.connectionContext(scope.connection), {
        ...market,
        keyword: keyword!,
        depth: args.limit,
      }),
    );
    return {
      keyword: keyword!,
      ...this.envelope(scope, adapter, market, page, args.limit, estimatedUsd),
    };
  }

  private async resolve(operation: SeoResearchOperation, args: MarketInput): Promise<Resolved> {
    const scope = await this.connectors.resolveScope('seo', args.connectionId, SEO_RESEARCH);
    const adapter = scope.adapter as SeoResearchAdapter;
    const offered = adapter.supportedLanguages(operation, args.location);
    const language = args.language ?? pickDefaultLanguage(args.location, offered);
    if (!offered.includes(language)) {
      const label = SEO_MARKET_INFO[args.location].label;
      throw new BadRequestException(
        offered.length === 0
          ? `seo_invalid_market: ${adapter.displayName} has no data for ${label} on this tool`
          : `seo_invalid_market: ${adapter.displayName} offers ${label} on this tool only in ${offered.join(', ')}, not ${language}`,
      );
    }
    return { scope, adapter, market: { market: args.location, language, mode: MODE } };
  }

  private envelope<T>(
    scope: ConnectionScope,
    adapter: SeoResearchAdapter,
    market: SeoMarketArgs,
    page: SeoResearchPage<T>,
    limit: number,
    estimatedUsd: number,
  ): SeoResearchResult<T> {
    const rows = page.rows.slice(0, limit);
    const total = page.totalCount ?? page.rows.length;
    const noData = page.noData || rows.length === 0;
    return {
      connection: connectionSummary(scope.connection),
      market: { location: market.market, language: market.language },
      mode: market.mode,
      rows,
      rowsReturned: rows.length,
      truncated: total > rows.length,
      noData,
      ...(noData ? { reason: noDataReason(adapter, market) } : {}),
      cost: { estimatedUsd, actualUsd: roundUsd(page.costUsd) },
    };
  }

  private call<T>(adapter: SeoResearchAdapter, fn: () => Promise<T>): Promise<T> {
    return this.connectors.vendorCall(async () => {
      try {
        return await fn();
      } catch (err) {
        if (err instanceof SeoResearchVendorError) throw translate(adapter, err);
        throw err;
      }
    });
  }
}

function pickDefaultLanguage(market: SeoMarket, offered: readonly SeoLanguage[]): SeoLanguage {
  const preferred = defaultLanguage(market);
  return offered.includes(preferred) ? preferred : (offered[0] ?? preferred);
}

function gate(
  adapter: SeoResearchAdapter,
  operation: SeoResearchOperation,
  args: { mode: SeoResearchMode; tasks: number; items: number; depth?: number },
  maxCostUsd: number | undefined,
): number {
  const estimatedUsd = roundUsd(adapter.estimateCostUsd(operation, args));
  if (maxCostUsd !== undefined && estimatedUsd > maxCostUsd) {
    throw new BadRequestException(
      `seo_cost_exceeded: this call is estimated at up to $${estimatedUsd.toFixed(4)}, above maxCostUsd $${maxCostUsd.toFixed(4)}; nothing was sent to ${adapter.displayName}. Lower limit or the number of keywords/competitors, or raise maxCostUsd.`,
    );
  }
  return estimatedUsd;
}

function translate(adapter: SeoResearchAdapter, err: SeoResearchVendorError): HttpException {
  switch (err.kind) {
    case 'auth':
      return new BadGatewayException(
        `seo_vendor_auth: ${adapter.displayName} rejected the stored API credentials (${err.message}); create a new connection with fresh credentials`,
      );
    case 'balance':
      return new HttpException(
        `seo_insufficient_balance: the ${adapter.displayName} account balance is too low for this call (${err.message}); top up the account and retry`,
        HttpStatus.PAYMENT_REQUIRED,
      );
    case 'spend_limit':
      return new HttpException(
        `seo_spend_limit: the spending limit set on the ${adapter.displayName} account has been reached (${err.message}); raise it in the provider's API settings or wait for it to reset`,
        HttpStatus.PAYMENT_REQUIRED,
      );
    case 'rate_limited':
      return new HttpException(
        `seo_rate_limited: ${adapter.displayName} is rate-limiting this account (${err.message}); retry in a minute`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    case 'invalid_market':
      return new BadRequestException(
        `seo_invalid_market: ${adapter.displayName} rejected the location or language (${err.message})`,
      );
  }
}

function noDataReason(adapter: SeoResearchAdapter, market: SeoMarketArgs): string {
  return `${adapter.displayName} has no data for this query in ${SEO_MARKET_INFO[market.market].label} (${market.language}); this is an empty result, not an error`;
}

function mergeGapRow(
  byKeyword: Map<string, SeoGapRow>,
  competitor: string,
  row: SeoIntersectionRow,
): void {
  const key = row.keyword.toLowerCase();
  const existing = byKeyword.get(key);
  const entry = { domain: competitor, position: row.position, url: row.url };
  if (existing) {
    existing.competitors.push(entry);
    return;
  }
  byKeyword.set(key, {
    keyword: row.keyword,
    volume: row.volume,
    cpc: row.cpc,
    competition: row.competition,
    competitionLevel: row.competitionLevel,
    intent: row.intent,
    competitors: [entry],
  });
}

export function normalizeKeywords(keywords: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of keywords) {
    const keyword = raw.trim().replace(/\s+/g, ' ');
    const key = keyword.toLowerCase();
    if (!keyword || seen.has(key)) continue;
    seen.add(key);
    out.push(keyword);
  }
  if (out.length === 0) {
    throw new BadRequestException('seo_invalid: pass at least one non-empty keyword');
  }
  return out;
}

const HOSTNAME = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

export function normalizeDomain(input: string): string {
  const trimmed = input.trim().toLowerCase();
  let host = trimmed;
  try {
    host = new URL(/^[a-z][a-z0-9+.-]*:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`).hostname;
  } catch {
    host = trimmed;
  }
  host = host.replace(/^www\./, '').replace(/\.$/, '');
  if (!HOSTNAME.test(host)) {
    throw new BadRequestException(`seo_invalid: ${input} is not a domain name`);
  }
  return host;
}

function roundUsd(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}
