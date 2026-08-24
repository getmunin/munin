import type { ConnectorAdapter, ConnectorConnectionContext } from '../connectors/connector.ts';

export interface SeoAdapter extends ConnectorAdapter {
  readonly domain: 'seo';

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
