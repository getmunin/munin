import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  ConnectorsService,
  connectionSummary,
  type ConnectionScope,
  type ConnectionSummary,
} from '../connectors/connectors.service.ts';
import { ConnectorVendorError } from '../connectors/http.ts';
import type {
  SeoAdapter,
  SeoPageStatsResult,
  SeoProperty,
  SeoQueryStatsResult,
  SeoSubmitResult,
  SeoUrlStatus,
} from './seo-adapter.ts';

const DEFAULT_WINDOW_DAYS = 90;
const MS_PER_DAY = 86_400_000;

interface StatsArgs {
  connectionId?: string;
  siteUrl?: string;
  from?: string;
  to?: string;
  limit: number;
}

@Injectable()
export class SeoService {
  constructor(@Inject(ConnectorsService) private readonly connectors: ConnectorsService) {}

  async listProperties(args: {
    connectionId?: string;
  }): Promise<{ connection: ConnectionSummary; properties: SeoProperty[] }> {
    const scope = await this.connectors.resolveScope('seo', args.connectionId);
    const adapter = scope.adapter as SeoAdapter;
    const properties = await this.connectors.vendorCall(() =>
      adapter.listProperties(this.connectors.connectionContext(scope.connection)),
    );
    return { connection: connectionSummary(scope.connection), properties };
  }

  async listQueries(
    args: StatsArgs,
  ): Promise<{ connection: ConnectionSummary; siteUrl: string } & SeoQueryStatsResult> {
    const scope = await this.connectors.resolveScope('seo', args.connectionId);
    const adapter = scope.adapter as SeoAdapter;
    const siteUrl = await this.resolveSiteUrl(scope, args.siteUrl);
    const range = resolveWindow(args.from, args.to);
    const result = await this.connectors.vendorCall(() =>
      adapter.listQueryStats(this.connectors.connectionContext(scope.connection), {
        siteUrl,
        limit: args.limit,
        ...range,
      }),
    );
    return { connection: connectionSummary(scope.connection), siteUrl, ...result };
  }

  async listPages(
    args: StatsArgs,
  ): Promise<{ connection: ConnectionSummary; siteUrl: string } & SeoPageStatsResult> {
    const scope = await this.connectors.resolveScope('seo', args.connectionId);
    const adapter = scope.adapter as SeoAdapter;
    const siteUrl = await this.resolveSiteUrl(scope, args.siteUrl);
    const range = resolveWindow(args.from, args.to);
    const result = await this.connectors.vendorCall(() =>
      adapter.listPageStats(this.connectors.connectionContext(scope.connection), {
        siteUrl,
        limit: args.limit,
        ...range,
      }),
    );
    return { connection: connectionSummary(scope.connection), siteUrl, ...result };
  }

  async inspectUrl(args: {
    connectionId?: string;
    siteUrl?: string;
    url: string;
  }): Promise<{ connection: ConnectionSummary; siteUrl: string; status: SeoUrlStatus }> {
    const scope = await this.connectors.resolveScope('seo', args.connectionId);
    const adapter = scope.adapter as SeoAdapter;
    const siteUrl = await this.resolveSiteUrl(scope, args.siteUrl);
    const status = await this.connectors.vendorCall(() =>
      adapter.inspectUrl(this.connectors.connectionContext(scope.connection), {
        siteUrl,
        url: args.url,
      }),
    );
    if (!status) {
      throw new NotFoundException(
        'seo_not_found: the search engine holds no index record for that URL',
      );
    }
    return { connection: connectionSummary(scope.connection), siteUrl, status };
  }

  async submitUrls(args: {
    connectionId?: string;
    siteUrl?: string;
    urls: string[];
  }): Promise<{ connection: ConnectionSummary; siteUrl: string } & SeoSubmitResult> {
    const scope = await this.connectors.resolveScope('seo', args.connectionId);
    const adapter = scope.adapter as SeoAdapter;
    const submit = adapter.submitUrls?.bind(adapter);
    if (!submit) {
      throw new BadRequestException(
        `seo_invalid: ${adapter.displayName} does not support submitting URLs for indexing`,
      );
    }
    const siteUrl = await this.resolveSiteUrl(scope, args.siteUrl);
    const outside = args.urls.filter((url) => !belongsTo(url, siteUrl));
    if (outside.length > 0) {
      throw new BadRequestException(
        `seo_invalid: these URLs are not under ${siteUrl}: ${outside.slice(0, 5).join(', ')}`,
      );
    }
    const result = await this.connectors.vendorCall(async () => {
      try {
        return await submit(this.connectors.connectionContext(scope.connection), {
          siteUrl,
          urls: args.urls,
        });
      } catch (err) {
        if (err instanceof ConnectorVendorError && err.quotaExceeded) {
          throw new BadRequestException(`seo_invalid: ${err.message}`);
        }
        throw err;
      }
    });
    return { connection: connectionSummary(scope.connection), siteUrl, ...result };
  }

  private async resolveSiteUrl(scope: ConnectionScope, siteUrl?: string): Promise<string> {
    if (siteUrl) return siteUrl;
    const adapter = scope.adapter as SeoAdapter;
    const properties = await this.connectors.vendorCall(() =>
      adapter.listProperties(this.connectors.connectionContext(scope.connection)),
    );
    const verified = properties.filter((p) => p.verified);
    if (verified.length === 0) {
      throw new BadRequestException(
        'seo_invalid: this connection has no verified properties — verify the site with the search engine first',
      );
    }
    if (verified.length > 1) {
      throw new BadRequestException(
        `seo_invalid: multiple verified properties — pass siteUrl. Available: ${verified
          .map((p) => p.siteUrl)
          .join(', ')}`,
      );
    }
    return verified[0]!.siteUrl;
  }
}

function resolveWindow(from?: string, to?: string): { from: string; to: string } {
  const resolvedTo = to ?? isoDate(Date.now());
  const resolvedFrom = from ?? isoDate(Date.parse(resolvedTo) - DEFAULT_WINDOW_DAYS * MS_PER_DAY);
  if (resolvedFrom > resolvedTo) {
    throw new BadRequestException('seo_invalid: from must not be later than to');
  }
  return { from: resolvedFrom, to: resolvedTo };
}

function isoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function belongsTo(url: string, siteUrl: string): boolean {
  try {
    const target = new URL(url);
    const site = new URL(siteUrl);
    return (
      target.hostname.toLowerCase() === site.hostname.toLowerCase() &&
      target.pathname.startsWith(site.pathname === '/' ? '/' : site.pathname)
    );
  } catch {
    return false;
  }
}
