import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { McpTool } from '@getmunin/mcp-toolkit';
import { SeoService } from './seo.service.ts';

const IsoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'expected a YYYY-MM-DD date');

const ListPropertiesInput = z.object({
  connectionId: z.string().min(1).optional(),
});

const StatsInput = z.object({
  connectionId: z.string().min(1).optional(),
  siteUrl: z.string().url().optional(),
  from: IsoDate.optional(),
  to: IsoDate.optional(),
  limit: z.number().int().min(1).max(200).default(50),
});

const InspectUrlInput = z.object({
  connectionId: z.string().min(1).optional(),
  siteUrl: z.string().url().optional(),
  url: z.string().url(),
});

const SubmitUrlsInput = z.object({
  connectionId: z.string().min(1).optional(),
  siteUrl: z.string().url().optional(),
  urls: z.array(z.string().url()).min(1).max(500),
});

@Injectable()
export class SeoAdminTools {
  constructor(@Inject(SeoService) private readonly seo: SeoService) {}

  @McpTool({
    name: 'seo_list_properties',
    title: 'SEO: List verified search properties',
    description:
      'List the verified sites the connected search-engine account can report on. Use it to discover the `siteUrl` values the other seo_* tools accept. `connectionId` is only needed when multiple seo connections are active.',
    audiences: ['admin'],
    scopes: ['seo:read'],
    input: ListPropertiesInput,
    readOnlyHint: true,
    destructiveHint: false,
  })
  listProperties(args: z.infer<typeof ListPropertiesInput>) {
    return this.seo.listProperties(args);
  }

  @McpTool({
    name: 'seo_list_queries',
    title: 'SEO: List search queries for a property',
    description:
      'List the search queries a property was impressed and clicked for, aggregated over a date window and sorted by impressions. Each row carries impressions, clicks, ctr and avgPosition. Search-engine reporting lags 2–3 days and Bing reports in whole weeks, so the returned `window` is the range actually covered and can be narrower than the `from`/`to` requested; it is null when no data fell in range. Defaults to the last 90 days. `siteUrl` is only needed when the account has multiple verified properties.',
    audiences: ['admin'],
    scopes: ['seo:read'],
    input: StatsInput,
    readOnlyHint: true,
    destructiveHint: false,
  })
  listQueries(args: z.infer<typeof StatsInput>) {
    return this.seo.listQueries(args);
  }

  @McpTool({
    name: 'seo_list_pages',
    title: 'SEO: List search-traffic pages for a property',
    description:
      'List the property’s pages by search impressions over a date window, each with impressions, clicks, ctr and avgPosition. Same reporting caveats as seo_list_queries: results lag 2–3 days, Bing aggregates by week, and the returned `window` is the range actually covered. Defaults to the last 90 days.',
    audiences: ['admin'],
    scopes: ['seo:read'],
    input: StatsInput,
    readOnlyHint: true,
    destructiveHint: false,
  })
  listPages(args: z.infer<typeof StatsInput>) {
    return this.seo.listPages(args);
  }

  @McpTool({
    name: 'seo_inspect_url',
    title: 'SEO: Inspect one URL’s index status',
    description:
      'Fetch what the search engine knows about one URL on a verified property: whether it is indexed, plus whichever of `detail` (the engine’s own coverage state), `httpStatus`, `lastCrawledAt`, `discoveredAt` and `inboundAnchorCount` that engine exposes — the set differs by engine, and a null field means it is not reported rather than zero. Returns not-found when the engine holds no record for the URL.',
    audiences: ['admin'],
    scopes: ['seo:read'],
    input: InspectUrlInput,
    readOnlyHint: true,
    destructiveHint: false,
  })
  inspectUrl(args: z.infer<typeof InspectUrlInput>) {
    return this.seo.inspectUrl(args);
  }

  @McpTool({
    name: 'seo_submit_urls',
    title: 'SEO: Submit URLs for indexing',
    description:
      'Submit up to 500 URLs on a verified property to the search engine for (re)crawling, e.g. after publishing or updating a page. URLs must be under the property. Returns how many were submitted plus the remaining daily and monthly quota; the call is rejected up front when the batch exceeds the quota left, rather than partially submitting. Submissions count against a per-site daily cap, so submit only URLs whose content actually changed. Not every engine offers URL submission — Bing does, Google Search Console does not, and the call fails with a clear message for engines that don’t.',
    audiences: ['admin'],
    scopes: ['seo:write'],
    input: SubmitUrlsInput,
    destructiveHint: true,
  })
  submitUrls(args: z.infer<typeof SubmitUrlsInput>) {
    return this.seo.submitUrls(args);
  }
}
