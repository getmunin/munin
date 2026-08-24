import { z } from 'zod';
import { safeFetch } from '@getmunin/core';
import {
  OAuthGrantRevokedError,
  requireAccessToken,
  type ConnectorConfigFieldInfo,
  type ConnectorConnectionContext,
  type ConnectorOAuth,
  type ConnectorTestResult,
  type OAuthTokenSet,
} from '../connectors/connector.ts';
import { ConnectorVendorError, type ConnectorFetch, REQUEST_TIMEOUT_MS } from '../connectors/http.ts';
import type {
  SeoAdapter,
  SeoPageStatsResult,
  SeoProperty,
  SeoQueryStatsResult,
  SeoStatsArgs,
  SeoStatsWindow,
  SeoUrlStatus,
} from './seo-adapter.ts';

const API_BASE_URL = 'https://searchconsole.googleapis.com';
const AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const SCOPES = ['https://www.googleapis.com/auth/webmasters.readonly'];
const ROW_LIMIT = 25_000;

export const GoogleSearchConsoleConfigInput = z.object({
  clientId: z.string().trim().min(10).max(256),
  clientSecret: z.string().trim().min(10).max(256).optional(),
});

const StoredConfig = z.object({
  clientId: z.string(),
  encryptedClientSecret: z.string(),
});

interface SiteEntry {
  siteUrl?: string | null;
  permissionLevel?: string | null;
}

interface AnalyticsRow {
  keys?: string[] | null;
  clicks?: number | null;
  impressions?: number | null;
  position?: number | null;
}

interface IndexStatusResult {
  verdict?: string | null;
  coverageState?: string | null;
  lastCrawlTime?: string | null;
  pageFetchState?: string | null;
  robotsTxtState?: string | null;
}

interface TokenResponse {
  access_token?: string | null;
  refresh_token?: string | null;
  expires_in?: number | null;
  error?: string | null;
  error_description?: string | null;
}

export class GoogleSearchConsoleAdapter implements SeoAdapter {
  readonly vendor = 'google_search_console';
  readonly domain = 'seo' as const;
  readonly displayName = 'Google Search Console';
  readonly configInput = GoogleSearchConsoleConfigInput;
  readonly configFields: ConnectorConfigFieldInfo[] = [
    {
      key: 'clientId',
      label: 'OAuth client ID (Google Cloud console → Credentials)',
      required: true,
      placeholder: '000000000000-xxxxxxxx.apps.googleusercontent.com',
    },
    {
      key: 'clientSecret',
      label: 'OAuth client secret',
      required: true,
      secret: true,
    },
  ];

  readonly oauth: ConnectorOAuth;

  constructor(private readonly fetchImpl: ConnectorFetch = safeFetch) {
    this.oauth = {
      authorizationScopes: SCOPES,
      clientIdKey: 'clientId',
      encryptedClientSecretKey: 'encryptedClientSecret',
      authorizeUrl: ({ state, redirectUri, clientId }) => {
        const url = new URL(AUTHORIZE_URL);
        url.searchParams.set('client_id', clientId);
        url.searchParams.set('redirect_uri', redirectUri);
        url.searchParams.set('response_type', 'code');
        url.searchParams.set('scope', SCOPES.join(' '));
        url.searchParams.set('access_type', 'offline');
        url.searchParams.set('prompt', 'consent');
        url.searchParams.set('include_granted_scopes', 'true');
        url.searchParams.set('state', state);
        return url.toString();
      },
      exchangeCode: ({ code, redirectUri, client }) =>
        this.token(
          {
            grant_type: 'authorization_code',
            code,
            redirect_uri: redirectUri,
            client_id: client.clientId,
            client_secret: client.clientSecret,
          },
          false,
        ),
      refresh: ({ refreshToken, client }) =>
        this.token(
          {
            grant_type: 'refresh_token',
            refresh_token: refreshToken,
            client_id: client.clientId,
            client_secret: client.clientSecret,
          },
          true,
        ),
      revoke: async ({ refreshToken }) => {
        const res = await this.fetchImpl(REVOKE_URL, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ token: refreshToken }).toString(),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
        if (!res.ok) {
          throw new ConnectorVendorError(`Google rejected the revocation (HTTP ${res.status})`);
        }
      },
    };
  }

  async buildStoredConfig(
    input: Record<string, unknown>,
    encryptSecret: (plaintext: string) => Promise<string>,
    previous?: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const parsed = GoogleSearchConsoleConfigInput.parse(input);
    const prev = previous ? StoredConfig.safeParse(previous) : null;
    const encryptedClientSecret = parsed.clientSecret
      ? await encryptSecret(parsed.clientSecret)
      : prev?.success
        ? prev.data.encryptedClientSecret
        : null;
    if (!encryptedClientSecret) {
      throw new ConnectorVendorError(
        'clientSecret is required when creating a Google Search Console connection',
      );
    }
    return { clientId: parsed.clientId, encryptedClientSecret };
  }

  publicConfig(stored: Record<string, unknown>): Record<string, unknown> {
    const parsed = StoredConfig.parse(stored);
    return { clientId: parsed.clientId };
  }

  async testConnection(ctx: ConnectorConnectionContext): Promise<ConnectorTestResult> {
    const properties = await this.listProperties(ctx);
    const verified = properties.filter((p) => p.verified);
    if (verified.length === 0) {
      throw new ConnectorVendorError(
        'the grant is valid but this Google account owns no verified Search Console properties',
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
    const body = await this.call<{ siteEntry?: SiteEntry[] | null }>(ctx, 'GET', '/webmasters/v3/sites');
    return (body.siteEntry ?? [])
      .filter((s): s is SiteEntry & { siteUrl: string } => typeof s?.siteUrl === 'string')
      .map((s) => ({
        siteUrl: s.siteUrl,
        verified: s.permissionLevel !== 'siteUnverifiedUser',
      }));
  }

  async listQueryStats(
    ctx: ConnectorConnectionContext,
    args: SeoStatsArgs,
  ): Promise<SeoQueryStatsResult> {
    const { totals, window } = await this.queryAnalytics(ctx, args, 'query');
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
    const { totals, window } = await this.queryAnalytics(ctx, args, 'page');
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
    const body = await this.call<{
      inspectionResult?: { indexStatusResult?: IndexStatusResult | null } | null;
    }>(ctx, 'POST', '/v1/urlInspection/index:inspect', {
      inspectionUrl: args.url,
      siteUrl: args.siteUrl,
    });
    const status = body.inspectionResult?.indexStatusResult;
    if (!status) return null;
    return {
      url: args.url,
      indexed: status.verdict === 'PASS',
      detail: status.coverageState ?? status.pageFetchState ?? null,
      httpStatus: null,
      lastCrawledAt: status.lastCrawlTime ?? null,
      discoveredAt: null,
      inboundAnchorCount: null,
    };
  }

  private async queryAnalytics(
    ctx: ConnectorConnectionContext,
    args: SeoStatsArgs,
    dimension: 'query' | 'page',
  ): Promise<{ totals: Totals[]; window: SeoStatsWindow | null }> {
    const body = await this.call<{ rows?: AnalyticsRow[] | null }>(
      ctx,
      'POST',
      `/webmasters/v3/sites/${encodeURIComponent(args.siteUrl)}/searchAnalytics/query`,
      {
        startDate: args.from,
        endDate: args.to,
        dimensions: ['date', dimension],
        rowLimit: ROW_LIMIT,
      },
    );
    return aggregate(body.rows ?? []);
  }

  private async token(form: Record<string, string>, isRefresh: boolean): Promise<OAuthTokenSet> {
    const res = await this.fetchImpl(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(form).toString(),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const body = (await res.json()) as TokenResponse;
    if (!res.ok || !body.access_token) {
      const detail = body.error_description ?? body.error ?? `HTTP ${res.status}`;
      if (isRefresh && body.error === 'invalid_grant') {
        throw new OAuthGrantRevokedError(detail);
      }
      throw new ConnectorVendorError(`Google token request failed: ${detail}`);
    }
    return {
      accessToken: body.access_token,
      refreshToken: body.refresh_token ?? undefined,
      expiresInSeconds: typeof body.expires_in === 'number' ? body.expires_in : undefined,
    };
  }

  private async call<T>(
    ctx: ConnectorConnectionContext,
    method: 'GET' | 'POST',
    path: string,
    body?: Record<string, unknown>,
  ): Promise<T> {
    const accessToken = await requireAccessToken(ctx);
    const res = await this.fetchImpl(`${API_BASE_URL}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${accessToken}`,
        accept: 'application/json',
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (res.status === 401 || res.status === 403) {
      throw new ConnectorVendorError(
        `Google Search Console refused the request (HTTP ${res.status}) — the grant may lack access to that property`,
      );
    }
    if (res.status === 429) {
      throw new ConnectorVendorError(
        'Google Search Console is rate-limiting this connection; retry later',
      );
    }
    if (!res.ok) {
      throw new ConnectorVendorError(
        `Google Search Console request failed with HTTP ${res.status}`,
      );
    }
    return (await res.json()) as T;
  }
}

interface Totals {
  key: string;
  impressions: number;
  clicks: number;
  positionWeight: number;
}

function aggregate(rows: AnalyticsRow[]): { totals: Totals[]; window: SeoStatsWindow | null } {
  const byKey = new Map<string, Totals>();
  let earliest: string | null = null;
  let latest: string | null = null;

  for (const row of rows) {
    const date = row.keys?.[0];
    const key = row.keys?.[1];
    if (typeof date !== 'string' || typeof key !== 'string') continue;
    if (!earliest || date < earliest) earliest = date;
    if (!latest || date > latest) latest = date;
    const impressions = numberOrNull(row.impressions) ?? 0;
    const clicks = numberOrNull(row.clicks) ?? 0;
    const position = numberOrNull(row.position);
    const totals = byKey.get(key) ?? { key, impressions: 0, clicks: 0, positionWeight: 0 };
    totals.impressions += impressions;
    totals.clicks += clicks;
    if (position !== null) totals.positionWeight += position * impressions;
    byKey.set(key, totals);
  }

  const totals = [...byKey.values()].sort(
    (a, b) => b.impressions - a.impressions || b.clicks - a.clicks || a.key.localeCompare(b.key),
  );
  return { totals, window: earliest && latest ? { from: earliest, to: latest } : null };
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
