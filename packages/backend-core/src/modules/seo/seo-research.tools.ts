import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { McpTool } from '@getmunin/mcp-toolkit';
import { SeoResearchService } from './seo-research.service.ts';

const Location = z
  .enum(['norway', 'sweden', 'denmark', 'uk'])
  .default('norway')
  .describe('Market to research. Defaults to norway.');

const Language = z
  .enum(['norwegian', 'swedish', 'danish', 'english'])
  .optional()
  .describe('Search language. Defaults to the market’s own language.');

const MaxCostUsd = z
  .number()
  .positive()
  .max(100)
  .optional()
  .describe(
    'Refuse the call, without contacting the provider, when its worst-case estimated cost exceeds this many US dollars.',
  );

const ConnectionId = z.string().min(1).optional();

const Keyword = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .refine((k) => k.split(/\s+/).length <= 10, 'a keyword may have at most 10 words');

const Domain = z.string().trim().min(3).max(253).describe('A domain such as example.com.');

const BalanceInput = z.object({
  connectionId: ConnectionId,
});

const KeywordVolumeInput = z.object({
  connectionId: ConnectionId,
  keywords: z.array(Keyword).min(1).max(1000),
  location: Location,
  language: Language,
  limit: z.number().int().min(1).max(1000).optional(),
  maxCostUsd: MaxCostUsd,
});

const KeywordIdeasInput = z.object({
  connectionId: ConnectionId,
  seeds: z.array(Keyword).min(1).max(20),
  location: Location,
  language: Language,
  limit: z.number().int().min(1).max(500).default(100),
  maxCostUsd: MaxCostUsd,
});

const RankedKeywordsInput = z.object({
  connectionId: ConnectionId,
  domain: Domain,
  location: Location,
  language: Language,
  limit: z.number().int().min(1).max(1000).default(100),
  maxCostUsd: MaxCostUsd,
});

const KeywordGapInput = z.object({
  connectionId: ConnectionId,
  domain: Domain.describe('The domain to find missing keywords for.'),
  competitors: z.array(Domain).min(1).max(3),
  location: Location,
  language: Language,
  limit: z.number().int().min(1).max(500).default(100),
  maxCostUsd: MaxCostUsd,
});

const SerpSnapshotInput = z.object({
  connectionId: ConnectionId,
  keyword: Keyword,
  location: Location,
  language: Language,
  limit: z.number().int().min(1).max(100).default(10),
  maxCostUsd: MaxCostUsd,
});

@Injectable()
export class SeoResearchTools {
  constructor(@Inject(SeoResearchService) private readonly research: SeoResearchService) {}

  @McpTool({
    name: 'seo_get_provider_balance',
    title: 'SEO: Get the keyword-research provider balance',
    description:
      'Report the connected keyword-research provider account’s balance, total deposited and today’s spend, in US dollars. Every other research tool is billed to this balance, so this is how to check headroom before a large request.',
    audiences: ['admin'],
    scopes: ['seo:read'],
    input: BalanceInput,
    readOnlyHint: true,
    destructiveHint: false,
  })
  providerBalance(args: z.infer<typeof BalanceInput>) {
    return this.research.providerBalance(args);
  }

  @McpTool({
    name: 'seo_get_keyword_volume',
    title: 'SEO: Get keyword search volume',
    description:
      'Look up monthly Google search volume, cost-per-click (USD) and advertiser competition (0–1) for up to 1,000 keywords in one market, plus the last 12 months of volume per keyword. Billed to the connected keyword-research account; every result reports the estimated and actual `cost`. Keywords with no data come back with null metrics.',
    audiences: ['admin'],
    scopes: ['seo:read'],
    input: KeywordVolumeInput,
    readOnlyHint: true,
    destructiveHint: false,
  })
  keywordVolume(args: z.infer<typeof KeywordVolumeInput>) {
    return this.research.keywordVolume(args);
  }

  @McpTool({
    name: 'seo_list_keyword_ideas',
    title: 'SEO: List keyword ideas from seed keywords',
    description:
      'Find related keywords for up to 20 seed keywords in one market, each with search volume, CPC, competition, keyword difficulty (0–100) and main search intent, sorted by relevance. Billed per returned row to the connected keyword-research account, so `limit` drives the cost; every result reports the estimated and actual `cost`.',
    audiences: ['admin'],
    scopes: ['seo:read'],
    input: KeywordIdeasInput,
    readOnlyHint: true,
    destructiveHint: false,
  })
  keywordIdeas(args: z.infer<typeof KeywordIdeasInput>) {
    return this.research.keywordIdeas(args);
  }

  @McpTool({
    name: 'seo_list_ranked_keywords',
    title: 'SEO: List the keywords a domain ranks for',
    description:
      'List the Google organic keywords any domain ranks for in one market, with its position, the ranking URL, search volume, CPC and intent, highest volume first. Works for any public domain, not only the org’s own. Billed per returned row to the connected keyword-research account; every result reports the estimated and actual `cost`.',
    audiences: ['admin'],
    scopes: ['seo:read'],
    input: RankedKeywordsInput,
    readOnlyHint: true,
    destructiveHint: false,
  })
  rankedKeywords(args: z.infer<typeof RankedKeywordsInput>) {
    return this.research.rankedKeywords(args);
  }

  @McpTool({
    name: 'seo_list_keyword_gaps',
    title: 'SEO: List keyword gaps against competitors',
    description:
      'Find keywords that up to 3 competitor domains rank for in Google organic results and the target domain does not, merged across competitors and sorted by search volume. Each row lists which competitors rank, at what position and with which URL. Runs one provider request per competitor, billed per returned row to the connected keyword-research account; the result reports the estimated and actual `cost`.',
    audiences: ['admin'],
    scopes: ['seo:read'],
    input: KeywordGapInput,
    readOnlyHint: true,
    destructiveHint: false,
  })
  keywordGap(args: z.infer<typeof KeywordGapInput>) {
    return this.research.keywordGap(args);
  }

  @McpTool({
    name: 'seo_get_serp_snapshot',
    title: 'SEO: Get a live SERP snapshot for a keyword',
    description:
      'Fetch the current top Google organic results for one keyword in one market — position, URL, domain and title — up to 100 results. A live snapshot, not history. Billed to the connected keyword-research account; the result reports the estimated and actual `cost`.',
    audiences: ['admin'],
    scopes: ['seo:read'],
    input: SerpSnapshotInput,
    readOnlyHint: true,
    destructiveHint: false,
  })
  serpSnapshot(args: z.infer<typeof SerpSnapshotInput>) {
    return this.research.serpSnapshot(args);
  }
}
