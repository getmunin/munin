import type {
  ConnectorAdapter,
  ConnectorCapabilityFilter,
  ConnectorConnectionContext,
} from '../connectors/connector.ts';
import { ConnectorVendorError } from '../connectors/http.ts';
import type { SeoLanguage, SeoMarket } from './seo-markets.ts';

export type SeoRole = 'console' | 'research';

export interface SeoConsoleAdapter extends ConnectorAdapter {
  readonly domain: 'seo';
  readonly seoRole: 'console';

  listProperties(ctx: ConnectorConnectionContext): Promise<SeoProperty[]>;

  listQueryStats(
    ctx: ConnectorConnectionContext,
    args: SeoStatsArgs,
  ): Promise<SeoQueryStatsResult>;

  listPageStats(ctx: ConnectorConnectionContext, args: SeoStatsArgs): Promise<SeoPageStatsResult>;

  inspectUrl(
    ctx: ConnectorConnectionContext,
    args: { siteUrl: string; url: string },
  ): Promise<SeoUrlStatus | null>;

  submitUrls?(
    ctx: ConnectorConnectionContext,
    args: { siteUrl: string; urls: string[] },
  ): Promise<SeoSubmitResult>;
}

export interface SeoStatsArgs {
  siteUrl: string;
  from: string;
  to: string;
  limit: number;
}

export interface SeoProperty {
  siteUrl: string;
  verified: boolean;
}

export interface SeoStatsWindow {
  from: string;
  to: string;
}

export interface SeoQueryStat {
  query: string;
  impressions: number;
  clicks: number;
  ctr: number;
  avgPosition: number | null;
}

export interface SeoPageStat {
  url: string;
  impressions: number;
  clicks: number;
  ctr: number;
  avgPosition: number | null;
}

export interface SeoQueryStatsResult {
  window: SeoStatsWindow | null;
  queries: SeoQueryStat[];
}

export interface SeoPageStatsResult {
  window: SeoStatsWindow | null;
  pages: SeoPageStat[];
}

export interface SeoUrlStatus {
  url: string;
  indexed: boolean;
  detail: string | null;
  httpStatus: number | null;
  lastCrawledAt: string | null;
  discoveredAt: string | null;
  inboundAnchorCount: number | null;
}

export interface SeoSubmitResult {
  submitted: number;
  dailyQuotaRemaining: number | null;
  monthlyQuotaRemaining: number | null;
}

export function isSeoConsoleAdapter(adapter: ConnectorAdapter): adapter is SeoConsoleAdapter {
  return adapter.domain === 'seo' && (adapter as Partial<SeoConsoleAdapter>).seoRole === 'console';
}

export const SEO_CONSOLE: ConnectorCapabilityFilter = {
  label: 'search console',
  accept: isSeoConsoleAdapter,
};

export type { SeoLanguage, SeoMarket } from './seo-markets.ts';

export type SeoResearchMode = 'live';

export type SeoResearchOperation =
  | 'balance'
  | 'keyword_volume'
  | 'keyword_ideas'
  | 'ranked_keywords'
  | 'domain_intersection'
  | 'serp_snapshot';

export interface SeoMarketArgs {
  market: SeoMarket;
  language: SeoLanguage;
  mode: SeoResearchMode;
}

export interface SeoResearchPage<T> {
  rows: T[];
  totalCount: number | null;
  costUsd: number;
  noData: boolean;
}

export interface SeoKeywordMetrics {
  keyword: string;
  volume: number | null;
  cpc: number | null;
  competition: number | null;
  competitionLevel: string | null;
}

export interface SeoKeywordVolumeRow extends SeoKeywordMetrics {
  monthly: Array<{ year: number; month: number; volume: number | null }>;
}

export interface SeoKeywordIdeaRow extends SeoKeywordMetrics {
  difficulty: number | null;
  intent: string | null;
}

export interface SeoRankedKeywordRow extends SeoKeywordMetrics {
  position: number | null;
  url: string | null;
  intent: string | null;
}

export interface SeoIntersectionRow extends SeoKeywordMetrics {
  intent: string | null;
  position: number | null;
  url: string | null;
}

export interface SeoSerpRow {
  position: number;
  url: string;
  domain: string | null;
  title: string | null;
}

export interface SeoProviderBalance {
  balanceUsd: number | null;
  totalDepositedUsd: number | null;
  spentTodayUsd: number | null;
  dailyLimitUsd: number | null;
  costUsd: number;
}

export interface SeoResearchAdapter extends ConnectorAdapter {
  readonly domain: 'seo';
  readonly seoRole: 'research';

  supportedLanguages(operation: SeoResearchOperation, market: SeoMarket): readonly SeoLanguage[];

  estimateCostUsd(
    operation: SeoResearchOperation,
    args: { mode: SeoResearchMode; tasks: number; items: number; depth?: number },
  ): number;

  getBalance(ctx: ConnectorConnectionContext): Promise<SeoProviderBalance>;

  keywordVolume(
    ctx: ConnectorConnectionContext,
    args: SeoMarketArgs & { keywords: string[] },
  ): Promise<SeoResearchPage<SeoKeywordVolumeRow>>;

  keywordIdeas(
    ctx: ConnectorConnectionContext,
    args: SeoMarketArgs & { seeds: string[]; limit: number },
  ): Promise<SeoResearchPage<SeoKeywordIdeaRow>>;

  rankedKeywords(
    ctx: ConnectorConnectionContext,
    args: SeoMarketArgs & { domain: string; limit: number },
  ): Promise<SeoResearchPage<SeoRankedKeywordRow>>;

  keywordsOnlyFirstRanksFor(
    ctx: ConnectorConnectionContext,
    args: SeoMarketArgs & { first: string; second: string; limit: number },
  ): Promise<SeoResearchPage<SeoIntersectionRow>>;

  serpSnapshot(
    ctx: ConnectorConnectionContext,
    args: SeoMarketArgs & { keyword: string; depth: number },
  ): Promise<SeoResearchPage<SeoSerpRow>>;
}

export function isSeoResearchAdapter(adapter: ConnectorAdapter): adapter is SeoResearchAdapter {
  return adapter.domain === 'seo' && (adapter as Partial<SeoResearchAdapter>).seoRole === 'research';
}

export const SEO_RESEARCH: ConnectorCapabilityFilter = {
  label: 'keyword research',
  accept: isSeoResearchAdapter,
};

export type SeoResearchErrorKind =
  | 'auth'
  | 'account_restricted'
  | 'balance'
  | 'spend_limit'
  | 'rate_limited'
  | 'invalid_market'
  | 'unavailable';

export class SeoResearchVendorError extends ConnectorVendorError {
  constructor(
    readonly kind: SeoResearchErrorKind,
    message: string,
  ) {
    super(message);
  }
}
