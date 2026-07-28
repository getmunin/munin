import type { CommerceProductSummary } from './commerce-adapter.ts';

const BROAD_SEARCH_POOL = 50;

export function broadSearchLimit(limit: number): number {
  return Math.max(limit, BROAD_SEARCH_POOL);
}

export function rankByTokenCoverage(
  products: CommerceProductSummary[],
  tokens: string[],
): CommerceProductSummary[] {
  const needles = tokens.map((token) => token.toLowerCase());
  return products
    .map((product, index) => ({
      product,
      index,
      hits: needles.filter((needle) => product.title.toLowerCase().includes(needle)).length,
    }))
    .sort((a, b) => b.hits - a.hits || a.index - b.index)
    .map((row) => row.product);
}
