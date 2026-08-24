import { z } from 'zod';
import { safeFetch } from '@getmunin/core';
import type {
  ConnectorConfigFieldInfo,
  ConnectorConnectionContext,
  ConnectorTestResult,
} from '../connectors/connector.ts';
import { ConnectorVendorError, type ConnectorFetch, REQUEST_TIMEOUT_MS } from '../connectors/http.ts';
import type {
  SeoAdapter,
  SeoPageStatsResult,
  SeoProperty,
  SeoQueryStatsResult,
  SeoStatsArgs,
  SeoStatsWindow,
  SeoSubmitResult,
  SeoUrlStatus,
} from './seo-adapter.ts';

const API_BASE_URL = 'https://ssl.bing.com/webmaster/api.svc/json';
const MAX_URLS_PER_BATCH = 500;
const THROTTLE_ERROR_CODE = 4;

export const BingConfigInput = z.object({
  apiKey: z.string().trim().min(16).max(256).optional(),
});

const StoredBingConfig = z.object({
  encryptedApiKey: z.string(),
});

interface BingSite {
  Url?: string | null;
  IsVerified?: boolean | null;
}

interface BingTrafficRow {
  Query?: string | null;
  Impressions?: number | null;
  Clicks?: number | null;
  AvgImpressionPosition?: number | null;
  Date?: string | null;
}

interface BingUrlInfo {
  Url?: string | null;
  IsPage?: boolean | null;
  HttpStatus?: number | null;
  LastCrawledDate?: string | null;
  DiscoveryDate?: string | null;
  AnchorCount?: number | null;
}

interface BingQuota {
  DailyQuota?: number | null;
  MonthlyQuota?: number | null;
}

export class BingAdapter implements SeoAdapter {
  readonly vendor = 'bing';
  readonly domain = 'seo' as const;
  readonly displayName = 'Bing Webmaster Tools';
  readonly configInput = BingConfigInput;
  readonly configFields: ConnectorConfigFieldInfo[] = [
    {
      key: 'apiKey',
      label: 'API key (Bing Webmaster Tools → Settings → API access)',
      required: true,
      secret: true,
    },
  ];

  constructor(private readonly fetchImpl: ConnectorFetch = safeFetch) {}

  async buildStoredConfig(
    input: Record<string, unknown>,
    encryptSecret: (plaintext: string) => Promise<string>,
    previous?: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const parsed = BingConfigInput.parse(input);
    const prev = previous ? StoredBingConfig.safeParse(previous) : null;
    const encryptedApiKey = parsed.apiKey
      ? await encryptSecret(parsed.apiKey)
      : prev?.success
        ? prev.data.encryptedApiKey
        : null;
    if (!encryptedApiKey) {
      throw new ConnectorVendorError('apiKey is required when creating a Bing connection');
    }
    return { encryptedApiKey };
  }

  publicConfig(stored: Record<string, unknown>): Record<string, unknown> {
    StoredBingConfig.parse(stored);
    return {};
  }

  async testConnection(ctx: ConnectorConnectionContext): Promise<ConnectorTestResult> {
    const properties = await this.listProperties(ctx);
    const verified = properties.filter((p) => p.verified);
    if (verified.length === 0) {
      throw new ConnectorVendorError(
        'the API key is valid but no verified sites are attached to it; verify a site in Bing Webmaster Tools first',
      );
    }
    return {
      ok: true,
      detail: `${verified.length} verified propert${verified.length === 1 ? 'y' : 'ies'}: ${verified
        .map((p) => p.siteUrl)
        .join(', ')}`,
    };
  }

  async listProperties(ctx: ConnectorConnectionContext): Promise<SeoProperty[]> {
    const sites = await this.get<BingSite[]>(ctx, 'GetUserSites');
    return (sites ?? [])
      .filter((s): s is BingSite & { Url: string } => typeof s?.Url === 'string' && !!s.Url)
      .map((s) => ({ siteUrl: s.Url, verified: s.IsVerified !== false }));
  }

  async listQueryStats(
    ctx: ConnectorConnectionContext,
    args: SeoStatsArgs,
  ): Promise<SeoQueryStatsResult> {
    const rows = await this.get<BingTrafficRow[]>(ctx, 'GetQueryStats', {
      siteUrl: args.siteUrl,
    });
    const { totals, window } = aggregate(rows ?? [], args);
    return {
      window,
      queries: totals.slice(0, args.limit).map((t) => ({
        query: t.key,
        impressions: t.impressions,
        clicks: t.clicks,
        ctr: ratio(t.clicks, t.impressions),
        avgPosition: weightedPosition(t),
      })),
    };
  }

  async listPageStats(
    ctx: ConnectorConnectionContext,
    args: SeoStatsArgs,
  ): Promise<SeoPageStatsResult> {
    const rows = await this.get<BingTrafficRow[]>(ctx, 'GetPageStats', {
      siteUrl: args.siteUrl,
    });
    const { totals, window } = aggregate(rows ?? [], args);
    return {
      window,
      pages: totals.slice(0, args.limit).map((t) => ({
        url: t.key,
        impressions: t.impressions,
        clicks: t.clicks,
        ctr: ratio(t.clicks, t.impressions),
        avgPosition: weightedPosition(t),
      })),
    };
  }

  async inspectUrl(
    ctx: ConnectorConnectionContext,
    args: { siteUrl: string; url: string },
  ): Promise<SeoUrlStatus | null> {
    const info = await this.get<BingUrlInfo | null>(ctx, 'GetUrlInfo', {
      siteUrl: args.siteUrl,
      url: args.url,
    });
    if (!info || typeof info.Url !== 'string') return null;
    return {
      url: info.Url,
      indexed: info.IsPage === true,
      detail: null,
      httpStatus: numberOrNull(info.HttpStatus),
      lastCrawledAt: parseBingDate(info.LastCrawledDate),
      discoveredAt: parseBingDate(info.DiscoveryDate),
      inboundAnchorCount: numberOrNull(info.AnchorCount),
    };
  }

  async submitUrls(
    ctx: ConnectorConnectionContext,
    args: { siteUrl: string; urls: string[] },
  ): Promise<SeoSubmitResult> {
    if (args.urls.length > MAX_URLS_PER_BATCH) {
      const err = new ConnectorVendorError(
        `Bing accepts at most ${MAX_URLS_PER_BATCH} URLs per batch; got ${args.urls.length}`,
      );
      err.quotaExceeded = true;
      throw err;
    }
    const quota = await this.get<BingQuota | null>(ctx, 'GetUrlSubmissionQuota', {
      siteUrl: args.siteUrl,
    });
    const daily = numberOrNull(quota?.DailyQuota);
    const monthly = numberOrNull(quota?.MonthlyQuota);
    if (daily !== null && args.urls.length > daily) {
      const err = new ConnectorVendorError(
        `Bing’s remaining daily submission quota for ${args.siteUrl} is ${daily} URL(s); got ${args.urls.length}`,
      );
      err.quotaExceeded = true;
      throw err;
    }
    if (monthly !== null && args.urls.length > monthly) {
      const err = new ConnectorVendorError(
        `Bing’s remaining monthly submission quota for ${args.siteUrl} is ${monthly} URL(s); got ${args.urls.length}`,
      );
      err.quotaExceeded = true;
      throw err;
    }
    await this.post(ctx, 'SubmitUrlBatch', {
      siteUrl: args.siteUrl,
      urlList: args.urls,
    });
    return {
      submitted: args.urls.length,
      dailyQuotaRemaining: daily === null ? null : daily - args.urls.length,
      monthlyQuotaRemaining: monthly === null ? null : monthly - args.urls.length,
    };
  }

  private async get<T>(
    ctx: ConnectorConnectionContext,
    method: string,
    params: Record<string, string> = {},
  ): Promise<T> {
    const apiKey = await this.apiKey(ctx);
    const query = new URLSearchParams({ ...params, apikey: apiKey });
    const res = await this.fetchImpl(`${API_BASE_URL}/${method}?${query.toString()}`, {
      method: 'GET',
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    return this.unwrap<T>(res, method);
  }

  private async post(
    ctx: ConnectorConnectionContext,
    method: string,
    body: Record<string, unknown>,
  ): Promise<void> {
    const apiKey = await this.apiKey(ctx);
    const query = new URLSearchParams({ apikey: apiKey });
    const res = await this.fetchImpl(`${API_BASE_URL}/${method}?${query.toString()}`, {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    await this.unwrap<unknown>(res, method);
  }

  private async apiKey(ctx: ConnectorConnectionContext): Promise<string> {
    const config = StoredBingConfig.parse(ctx.config);
    return ctx.decryptSecret(config.encryptedApiKey);
  }

  private async unwrap<T>(
    res: { ok: boolean; status: number; text(): Promise<string> },
    method: string,
  ): Promise<T> {
    const text = await res.text();
    const parsed = safeJsonParse(text);
    if (!res.ok) {
      throw this.vendorError(res.status, parsed, method);
    }
    if (isEnvelope(parsed)) return parsed.d as T;
    return parsed as T;
  }

  private vendorError(status: number, body: unknown, method: string): ConnectorVendorError {
    const detail = errorDetail(body);
    if (detail.code === THROTTLE_ERROR_CODE) {
      return new ConnectorVendorError(
        `Bing is throttling this API key (${method}); retry later or reduce how often these tools are called`,
      );
    }
    if (status === 401 || status === 403) {
      return new ConnectorVendorError(`Bing rejected the API key (HTTP ${status})`);
    }
    const suffix = detail.message ? `: ${detail.message}` : '';
    return new ConnectorVendorError(`Bing ${method} failed with HTTP ${status}${suffix}`);
  }
}

interface Totals {
  key: string;
  impressions: number;
  clicks: number;
  positionWeight: number;
}

function aggregate(
  rows: BingTrafficRow[],
  args: SeoStatsArgs,
): { totals: Totals[]; window: SeoStatsWindow | null } {
  const byKey = new Map<string, Totals>();
  let earliest: string | null = null;
  let latest: string | null = null;

  for (const row of rows) {
    const key = typeof row.Query === 'string' ? row.Query : null;
    if (!key) continue;
    const date = parseBingDate(row.Date)?.slice(0, 10) ?? null;
    if (date && (date < args.from || date > args.to)) continue;
    if (date) {
      if (!earliest || date < earliest) earliest = date;
      if (!latest || date > latest) latest = date;
    }
    const impressions = numberOrNull(row.Impressions) ?? 0;
    const clicks = numberOrNull(row.Clicks) ?? 0;
    const position = numberOrNull(row.AvgImpressionPosition);
    const totals = byKey.get(key) ?? { key, impressions: 0, clicks: 0, positionWeight: 0 };
    totals.impressions += impressions;
    totals.clicks += clicks;
    if (position !== null) totals.positionWeight += position * impressions;
    byKey.set(key, totals);
  }

  const totals = [...byKey.values()].sort(
    (a, b) => b.impressions - a.impressions || b.clicks - a.clicks || a.key.localeCompare(b.key),
  );
  return {
    totals,
    window: earliest && latest ? { from: earliest, to: latest } : null,
  };
}

function weightedPosition(totals: Totals): number | null {
  if (totals.impressions <= 0 || totals.positionWeight <= 0) return null;
  return round(totals.positionWeight / totals.impressions, 2);
}

function ratio(clicks: number, impressions: number): number {
  if (impressions <= 0) return 0;
  return round(clicks / impressions, 4);
}

function round(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function parseBingDate(value: unknown): string | null {
  if (typeof value !== 'string' || !value) return null;
  const dotNet = /^\/Date\((-?\d+)([+-]\d{4})?\)\/$/.exec(value);
  const ms = dotNet ? Number(dotNet[1]) : Date.parse(value);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString();
}

function safeJsonParse(text: string): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function isEnvelope(body: unknown): body is { d: unknown } {
  return !!body && typeof body === 'object' && 'd' in body;
}

function errorDetail(body: unknown): { code: number | null; message: string | null } {
  if (!body || typeof body !== 'object') {
    return { code: null, message: typeof body === 'string' && body ? body.slice(0, 200) : null };
  }
  const record = body as Record<string, unknown>;
  const inner = isEnvelope(record) && record.d && typeof record.d === 'object' ? record.d : record;
  const source = inner as Record<string, unknown>;
  const message = typeof source.Message === 'string' ? source.Message : null;
  return { code: numberOrNull(source.ErrorCode), message };
}
