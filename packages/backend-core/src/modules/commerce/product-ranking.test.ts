import { describe, expect, it } from 'vitest';
import { broadSearchLimit, rankByTokenCoverage } from './product-ranking.ts';
import type { CommerceProductSummary } from './commerce-adapter.ts';

function product(title: string): CommerceProductSummary {
  return {
    productRef: title,
    title,
    url: null,
    imageUrl: null,
    currency: 'NOK',
    priceMin: '1',
    priceMax: '1',
  };
}

describe('rankByTokenCoverage', () => {
  it('puts products matching more query terms first', () => {
    const ranked = rankByTokenCoverage(
      [
        product('Samsung Galaxy Watch Borrelåsreim'),
        product('Xplora 4 Borrelåsreim Blå'),
        product('Xplora X6Play Pakkedeal'),
      ],
      ['borrelåsreim', 'xplora'],
    );
    expect(ranked.map((p) => p.title)).toEqual([
      'Xplora 4 Borrelåsreim Blå',
      'Samsung Galaxy Watch Borrelåsreim',
      'Xplora X6Play Pakkedeal',
    ]);
  });

  it('is stable: equal coverage keeps the vendor order', () => {
    const ranked = rankByTokenCoverage(
      [product('Xplora A'), product('Xplora B'), product('Xplora C')],
      ['xplora'],
    );
    expect(ranked.map((p) => p.title)).toEqual(['Xplora A', 'Xplora B', 'Xplora C']);
  });

  it('matches case-insensitively', () => {
    const ranked = rankByTokenCoverage([product('a'), product('LADEKABEL Xplora')], ['ladekabel']);
    expect(ranked[0]!.title).toBe('LADEKABEL Xplora');
  });

  it('leaves the order untouched when nothing matches', () => {
    const ranked = rankByTokenCoverage([product('a'), product('b')], ['zzz']);
    expect(ranked.map((p) => p.title)).toEqual(['a', 'b']);
  });

  it('handles an empty product list', () => {
    expect(rankByTokenCoverage([], ['x'])).toEqual([]);
  });

  it('over-fetches a flat pool for the broad pass, independent of the caller limit', () => {
    expect(broadSearchLimit(1)).toBe(50);
    expect(broadSearchLimit(3)).toBe(50);
    expect(broadSearchLimit(10)).toBe(50);
    expect(broadSearchLimit(25)).toBe(50);
    expect(broadSearchLimit(80)).toBe(80);
  });
});
