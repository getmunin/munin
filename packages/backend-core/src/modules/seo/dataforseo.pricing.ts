import type { SeoResearchMode, SeoResearchOperation } from './seo-adapter.ts';

export interface DataForSeoPrice {
  perTaskUsd: number;
  perItemUsd: number;
  perSerpPageUsd?: number;
  serpPageSize?: number;
}

export const DATAFORSEO_PRICING_VERIFIED_ON = '2026-09-26';

export const DATAFORSEO_PRICING: Record<
  SeoResearchMode,
  Record<SeoResearchOperation, DataForSeoPrice>
> = {
  live: {
    balance: { perTaskUsd: 0, perItemUsd: 0 },
    keyword_volume: { perTaskUsd: 0.09, perItemUsd: 0 },
    keyword_ideas: { perTaskUsd: 0.012, perItemUsd: 0.00012 },
    ranked_keywords: { perTaskUsd: 0.012, perItemUsd: 0.00012 },
    domain_intersection: { perTaskUsd: 0.012, perItemUsd: 0.00012 },
    serp_snapshot: { perTaskUsd: 0, perItemUsd: 0, perSerpPageUsd: 0.002, serpPageSize: 10 },
  },
};

export function estimateDataForSeoCostUsd(
  operation: SeoResearchOperation,
  args: { mode: SeoResearchMode; tasks: number; items: number; depth?: number },
): number {
  const price = DATAFORSEO_PRICING[args.mode][operation];
  let total = args.tasks * price.perTaskUsd + args.items * price.perItemUsd;
  if (price.perSerpPageUsd !== undefined && price.serpPageSize !== undefined) {
    const pages = Math.max(1, Math.ceil((args.depth ?? price.serpPageSize) / price.serpPageSize));
    total += args.tasks * pages * price.perSerpPageUsd;
  }
  return total;
}
