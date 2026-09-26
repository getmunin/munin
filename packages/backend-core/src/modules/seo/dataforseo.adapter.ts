import { z } from 'zod';
import { safeFetch } from '@getmunin/core';
import type {
  ConnectorConfigFieldInfo,
  ConnectorConnectionContext,
  ConnectorTestResult,
} from '../connectors/connector.ts';
import { ConnectorVendorError, type ConnectorFetch } from '../connectors/http.ts';
import {
  SeoResearchVendorError,
  type SeoIntersectionRow,
  type SeoKeywordIdeaRow,
  type SeoKeywordMetrics,
  type SeoKeywordVolumeRow,
  type SeoLanguage,
  type SeoMarket,
  type SeoMarketArgs,
  type SeoProviderBalance,
  type SeoRankedKeywordRow,
  type SeoResearchAdapter,
  type SeoResearchErrorKind,
  type SeoResearchMode,
  type SeoResearchOperation,
  type SeoResearchPage,
  type SeoSerpRow,
} from './seo-adapter.ts';
import { marketCodes } from './dataforseo.markets.ts';
import { estimateDataForSeoCostUsd } from './dataforseo.pricing.ts';

const API_BASE_URL = 'https://api.dataforseo.com/v3';
const DATAFORSEO_TIMEOUT_MS = 30_000;
const OK = 20000;
const PARTIAL_RESULTS = 40106;
const NO_RESULTS = 40102;
const AUTH_CODES = new Set([40100, 40104]);
const BALANCE_CODES = new Set([40200, 40210]);
const SPEND_LIMIT_CODES = new Set([40203]);
const RATE_LIMIT_CODES = new Set([40202, 40209]);
const INVALID_FIELD_CODES = new Set([40501, 40505]);
const VOLUME_ORDER = ['keyword_data.keyword_info.search_volume,desc'];

type Endpoint =
  | 'keywords_data/google_ads/search_volume'
  | 'dataforseo_labs/google/keyword_ideas'
  | 'dataforseo_labs/google/ranked_keywords'
  | 'dataforseo_labs/google/domain_intersection'
  | 'serp/google/organic';

export function endpointPath(endpoint: Endpoint, mode: SeoResearchMode): string {
  switch (mode) {
    case 'live':
      return endpoint === 'serp/google/organic' ? `${endpoint}/live/advanced` : `${endpoint}/live`;
  }
}

export const DataForSeoConfigInput = z.object({
  login: z.string().trim().min(3).max(256).optional(),
  password: z.string().trim().min(8).max(256).optional(),
});

const StoredDataForSeoConfig = z.object({
  encryptedLogin: z.string(),
  encryptedPassword: z.string(),
});

interface Envelope {
  status_code?: number;
  status_message?: string;
  cost?: number;
  tasks?: Task[];
}

interface Task {
  status_code?: number;
  status_message?: string;
  cost?: number;
  result?: unknown[] | null;
}

interface KeywordInfo {
  search_volume?: number | null;
  cpc?: number | null;
  competition?: number | null;
  competition_level?: string | null;
}

interface KeywordData {
  keyword?: string | null;
  keyword_info?: KeywordInfo | null;
  keyword_properties?: { keyword_difficulty?: number | null } | null;
  search_intent_info?: { main_intent?: string | null } | null;
}

interface SerpElement {
  rank_group?: number | null;
  rank_absolute?: number | null;
  url?: string | null;
  domain?: string | null;
  title?: string | null;
  type?: string | null;
}

interface LabsResult<T> {
  total_count?: number | null;
  items?: T[] | null;
}

interface SearchVolumeItem {
  keyword?: string | null;
  search_volume?: number | null;
  cpc?: number | null;
  competition?: string | null;
  competition_index?: number | null;
  monthly_searches?: Array<{ year?: number; month?: number; search_volume?: number | null }> | null;
}

interface UserData {
  money?: {
    total?: number | null;
    balance?: number | null;
    limits?: { day?: { total?: number | null } | null } | null;
    statistics?: { day?: { total?: number | null } | null } | null;
  } | null;
}

interface Called<T> {
  result: T[];
  costUsd: number;
  noData: boolean;
}

export class DataForSeoAdapter implements SeoResearchAdapter {
  readonly vendor = 'dataforseo';
  readonly domain = 'seo' as const;
  readonly seoRole = 'research' as const;
  readonly displayName = 'DataForSEO';
  readonly configInput = DataForSeoConfigInput;
  readonly configFields: ConnectorConfigFieldInfo[] = [
    {
      key: 'login',
      label: 'API login (app.dataforseo.com → API Access)',
      required: true,
      secret: true,
    },
    {
      key: 'password',
      label: 'API password (app.dataforseo.com → API Access)',
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
    const parsed = DataForSeoConfigInput.parse(input);
    const prev = previous ? StoredDataForSeoConfig.safeParse(previous) : null;
    const prior = prev?.success ? prev.data : null;
    const encryptedLogin = parsed.login ? await encryptSecret(parsed.login) : prior?.encryptedLogin;
    const encryptedPassword = parsed.password
      ? await encryptSecret(parsed.password)
      : prior?.encryptedPassword;
    if (!encryptedLogin || !encryptedPassword) {
      throw new ConnectorVendorError(
        'login and password are both required when creating a DataForSEO connection',
      );
    }
    return { encryptedLogin, encryptedPassword };
  }

  publicConfig(stored: Record<string, unknown>): Record<string, unknown> {
    StoredDataForSeoConfig.parse(stored);
    return {};
  }

  async testConnection(ctx: ConnectorConnectionContext): Promise<ConnectorTestResult> {
    const balance = await this.getBalance(ctx);
    const amount = balance.balanceUsd === null ? 'unknown' : `$${balance.balanceUsd.toFixed(2)}`;
    return {
      ok: true,
      detail: `credentials accepted; account balance ${amount}`,
      summary: `Balance ${amount}`,
    };
  }

  supportsMarket(
    operation: SeoResearchOperation,
    market: SeoMarket,
    language: SeoLanguage,
  ): boolean {
    if (operation === 'balance') return true;
    return marketCodes(operation, market, language) !== null;
  }

  estimateCostUsd(
    operation: SeoResearchOperation,
    args: { mode: SeoResearchMode; tasks: number; items: number; depth?: number },
  ): number {
    return estimateDataForSeoCostUsd(operation, args);
  }

  async getBalance(ctx: ConnectorConnectionContext): Promise<SeoProviderBalance> {
    const called = await this.request<UserData>(ctx, 'GET', 'appendix/user_data');
    const money = called.result[0]?.money ?? null;
    const dailyLimit = num(money?.limits?.day?.total);
    return {
      balanceUsd: num(money?.balance),
      totalDepositedUsd: num(money?.total),
      spentTodayUsd: num(money?.statistics?.day?.total),
      dailyLimitUsd: dailyLimit && dailyLimit > 0 ? dailyLimit : null,
      costUsd: called.costUsd,
    };
  }

  async keywordVolume(
    ctx: ConnectorConnectionContext,
    args: SeoMarketArgs & { keywords: string[] },
  ): Promise<SeoResearchPage<SeoKeywordVolumeRow>> {
    const called = await this.post<SearchVolumeItem>(
      ctx,
      endpointPath('keywords_data/google_ads/search_volume', args.mode),
      { keywords: args.keywords, ...this.codes('keyword_volume', args) },
    );
    const rows = called.result
      .filter((item): item is SearchVolumeItem & { keyword: string } => !!item?.keyword)
      .map((item) => ({
        keyword: item.keyword,
        volume: num(item.search_volume),
        cpc: num(item.cpc),
        competition: item.competition_index == null ? null : round(item.competition_index / 100, 2),
        competitionLevel: item.competition ?? null,
        monthly: (item.monthly_searches ?? [])
          .filter((m) => typeof m.year === 'number' && typeof m.month === 'number')
          .map((m) => ({ year: m.year!, month: m.month!, volume: num(m.search_volume) })),
      }))
      .sort((a, b) => (b.volume ?? -1) - (a.volume ?? -1));
    return {
      rows,
      totalCount: rows.length,
      costUsd: called.costUsd,
      noData: called.noData || rows.every((r) => r.volume === null),
    };
  }

  async keywordIdeas(
    ctx: ConnectorConnectionContext,
    args: SeoMarketArgs & { seeds: string[]; limit: number },
  ): Promise<SeoResearchPage<SeoKeywordIdeaRow>> {
    const called = await this.post<LabsResult<KeywordData>>(
      ctx,
      endpointPath('dataforseo_labs/google/keyword_ideas', args.mode),
      { keywords: args.seeds, limit: args.limit, ...this.codes('keyword_ideas', args) },
    );
    return labsPage(called, (item) => {
      const metrics = keywordMetrics(item);
      if (!metrics) return null;
      return {
        ...metrics,
        difficulty: num(item.keyword_properties?.keyword_difficulty),
        intent: item.search_intent_info?.main_intent ?? null,
      };
    });
  }

  async rankedKeywords(
    ctx: ConnectorConnectionContext,
    args: SeoMarketArgs & { domain: string; limit: number },
  ): Promise<SeoResearchPage<SeoRankedKeywordRow>> {
    const called = await this.post<
      LabsResult<{ keyword_data?: KeywordData | null; ranked_serp_element?: { serp_item?: SerpElement | null } | null }>
    >(ctx, endpointPath('dataforseo_labs/google/ranked_keywords', args.mode), {
      target: args.domain,
      limit: args.limit,
      order_by: VOLUME_ORDER,
      ...this.codes('ranked_keywords', args),
    });
    return labsPage(called, (item) => {
      const metrics = item.keyword_data ? keywordMetrics(item.keyword_data) : null;
      if (!metrics) return null;
      const serp = item.ranked_serp_element?.serp_item ?? null;
      return {
        ...metrics,
        position: num(serp?.rank_group),
        url: serp?.url ?? null,
        intent: item.keyword_data?.search_intent_info?.main_intent ?? null,
      };
    });
  }

  async keywordsOnlyFirstRanksFor(
    ctx: ConnectorConnectionContext,
    args: SeoMarketArgs & { first: string; second: string; limit: number },
  ): Promise<SeoResearchPage<SeoIntersectionRow>> {
    const called = await this.post<
      LabsResult<{ keyword_data?: KeywordData | null; first_domain_serp_element?: SerpElement | null }>
    >(ctx, endpointPath('dataforseo_labs/google/domain_intersection', args.mode), {
      target1: args.first,
      target2: args.second,
      intersections: false,
      limit: args.limit,
      order_by: VOLUME_ORDER,
      ...this.codes('domain_intersection', args),
    });
    return labsPage(called, (item) => {
      const metrics = item.keyword_data ? keywordMetrics(item.keyword_data) : null;
      if (!metrics) return null;
      const serp = item.first_domain_serp_element ?? null;
      return {
        ...metrics,
        intent: item.keyword_data?.search_intent_info?.main_intent ?? null,
        position: num(serp?.rank_group),
        url: serp?.url ?? null,
      };
    });
  }

  async serpSnapshot(
    ctx: ConnectorConnectionContext,
    args: SeoMarketArgs & { keyword: string; depth: number },
  ): Promise<SeoResearchPage<SeoSerpRow>> {
    const called = await this.post<{ items?: SerpElement[] | null }>(
      ctx,
      endpointPath('serp/google/organic', args.mode),
      { keyword: args.keyword, depth: args.depth, ...this.codes('serp_snapshot', args) },
    );
    const rows = (called.result[0]?.items ?? [])
      .filter((item): item is SerpElement & { url: string } => item?.type === 'organic' && !!item.url)
      .map((item, index) => ({
        position: num(item.rank_group) ?? index + 1,
        url: item.url,
        domain: item.domain ?? null,
        title: item.title ?? null,
      }))
      .slice(0, args.depth);
    return {
      rows,
      totalCount: rows.length,
      costUsd: called.costUsd,
      noData: called.noData || rows.length === 0,
    };
  }

  private codes(
    operation: Exclude<SeoResearchOperation, 'balance'>,
    args: SeoMarketArgs,
  ): { location_code: number; language_code?: string } {
    const codes = marketCodes(operation, args.market, args.language);
    if (!codes) {
      throw new SeoResearchVendorError(
        'invalid_market',
        `${args.language} in ${args.market} is not offered for this request`,
      );
    }
    return codes.languageCode === null
      ? { location_code: codes.locationCode }
      : { location_code: codes.locationCode, language_code: codes.languageCode };
  }

  private post<T>(
    ctx: ConnectorConnectionContext,
    path: string,
    task: Record<string, unknown>,
  ): Promise<Called<T>> {
    return this.request<T>(ctx, 'POST', path, [task]);
  }

  private async request<T>(
    ctx: ConnectorConnectionContext,
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
  ): Promise<Called<T>> {
    const authorization = await this.authorization(ctx);
    const res = await this.fetchImpl(`${API_BASE_URL}/${path}`, {
      method,
      headers: {
        accept: 'application/json',
        authorization,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(DATAFORSEO_TIMEOUT_MS),
    });
    const text = await res.text();
    const parsed = safeJsonParse(text);
    const envelope = isEnvelope(parsed) ? parsed : null;
    if (!res.ok) throw httpError(res.status, envelope);
    if (!envelope) {
      throw new ConnectorVendorError(`DataForSEO returned a non-JSON response for ${path}`);
    }
    if (envelope.status_code !== OK) throw statusError(envelope.status_code, envelope.status_message);
    const task = envelope.tasks?.[0];
    if (!task) throw new ConnectorVendorError(`DataForSEO returned no task for ${path}`);
    const costUsd = num(envelope.cost) ?? num(task.cost) ?? 0;
    if (task.status_code === NO_RESULTS) return { result: [], costUsd, noData: true };
    if (task.status_code !== OK && task.status_code !== PARTIAL_RESULTS) {
      throw statusError(task.status_code, task.status_message);
    }
    const result = (task.result ?? []) as T[];
    return { result, costUsd, noData: result.length === 0 };
  }

  private async authorization(ctx: ConnectorConnectionContext): Promise<string> {
    const config = StoredDataForSeoConfig.parse(ctx.config);
    const [login, password] = await Promise.all([
      ctx.decryptSecret(config.encryptedLogin),
      ctx.decryptSecret(config.encryptedPassword),
    ]);
    return `Basic ${Buffer.from(`${login}:${password}`, 'utf8').toString('base64')}`;
  }
}

function labsPage<T, R>(
  called: Called<LabsResult<T>>,
  map: (item: T) => R | null,
): SeoResearchPage<R> {
  const result = called.result[0];
  const rows = (result?.items ?? []).map(map).filter((r): r is R => r !== null);
  return {
    rows,
    totalCount: num(result?.total_count),
    costUsd: called.costUsd,
    noData: called.noData || rows.length === 0,
  };
}

function keywordMetrics(item: KeywordData): SeoKeywordMetrics | null {
  if (!item.keyword) return null;
  const info = item.keyword_info ?? null;
  return {
    keyword: item.keyword,
    volume: num(info?.search_volume),
    cpc: num(info?.cpc),
    competition: num(info?.competition),
    competitionLevel: info?.competition_level ?? null,
  };
}

function classify(code: number | undefined): SeoResearchErrorKind | null {
  if (code === undefined) return null;
  if (AUTH_CODES.has(code)) return 'auth';
  if (BALANCE_CODES.has(code)) return 'balance';
  if (SPEND_LIMIT_CODES.has(code)) return 'spend_limit';
  if (RATE_LIMIT_CODES.has(code)) return 'rate_limited';
  if (INVALID_FIELD_CODES.has(code)) return 'invalid_market';
  return null;
}

function statusError(code: number | undefined, message: string | undefined): ConnectorVendorError {
  const detail = `DataForSEO ${code ?? 'unknown status'}${message ? `: ${message}` : ''}`;
  const kind = classify(code);
  if (kind === 'invalid_market' && !/location|language/i.test(message ?? '')) {
    return new ConnectorVendorError(detail);
  }
  return kind ? new SeoResearchVendorError(kind, detail) : new ConnectorVendorError(detail);
}

function httpError(status: number, envelope: Envelope | null): ConnectorVendorError {
  const detail = `DataForSEO HTTP ${status}${envelope?.status_message ? `: ${envelope.status_message}` : ''}`;
  if (status === 401 || status === 403) return new SeoResearchVendorError('auth', detail);
  if (status === 402) return new SeoResearchVendorError('balance', detail);
  if (status === 429) return new SeoResearchVendorError('rate_limited', detail);
  const kind = classify(envelope?.status_code);
  return kind ? new SeoResearchVendorError(kind, detail) : new ConnectorVendorError(detail);
}

function isEnvelope(body: unknown): body is Envelope {
  return !!body && typeof body === 'object' && 'status_code' in body;
}

function safeJsonParse(text: string): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function round(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}
