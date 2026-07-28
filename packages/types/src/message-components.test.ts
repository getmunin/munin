import { describe, expect, it } from 'vitest';
import { MessageComponentsSchema, parseMessageComponents } from './message-components.ts';
import { formatPriceRange } from './message-format.ts';

const item = {
  productRef: 'p1',
  title: 'Fjell Shell 3L',
  imageUrl: 'https://cdn.shopify.com/fjell.jpg',
  url: 'https://example.test/p/fjell',
  currency: 'NOK',
  priceMin: '1890',
  priceMax: '1890',
};

const component = {
  type: 'product_list' as const,
  source: { connectionId: 'conn_1', vendor: 'shopify', label: 'Nordic Supply' },
  items: [item],
};

describe('MessageComponentsSchema', () => {
  it('accepts a product list', () => {
    expect(MessageComponentsSchema.safeParse([component]).success).toBe(true);
  });

  it('rejects insecure image and storefront urls', () => {
    expect(
      MessageComponentsSchema.safeParse([
        { ...component, items: [{ ...item, imageUrl: 'http://insecure.test/a.jpg' }] },
      ]).success,
    ).toBe(false);
    expect(
      MessageComponentsSchema.safeParse([
        { ...component, items: [{ ...item, url: 'javascript:alert(1)' }] },
      ]).success,
    ).toBe(false);
  });

  it('rejects an unknown component type', () => {
    expect(MessageComponentsSchema.safeParse([{ ...component, type: 'iframe' }]).success).toBe(false);
  });

  it('rejects an empty or oversized item list', () => {
    expect(MessageComponentsSchema.safeParse([{ ...component, items: [] }]).success).toBe(false);
    const nine = Array.from({ length: 9 }, (_, i) => ({ ...item, productRef: `p${i}` }));
    expect(MessageComponentsSchema.safeParse([{ ...component, items: nine }]).success).toBe(false);
  });

  it('parseMessageComponents returns null for anything unrecognised', () => {
    expect(parseMessageComponents(undefined)).toBeNull();
    expect(parseMessageComponents([])).toBeNull();
    expect(parseMessageComponents({ components: [component] })).toBeNull();
    expect(parseMessageComponents([component])).toHaveLength(1);
  });
});

describe('formatPriceRange', () => {
  it('formats a single price with its currency', () => {
    expect(formatPriceRange({ currency: 'NOK', priceMin: '1890', priceMax: '1890' }, 'nb-NO')).toContain(
      '1',
    );
  });

  it('formats a range with one currency marker', () => {
    const range = formatPriceRange({ currency: 'NOK', priceMin: '1450', priceMax: '1690' }, 'nb-NO');
    expect(range).toMatch(/–/);
  });

  it('treats a missing bound as a single price', () => {
    expect(formatPriceRange({ currency: 'NOK', priceMin: null, priceMax: '1690' }, 'nb-NO')).not.toMatch(
      /–/,
    );
  });

  it('returns null when there is no price at all', () => {
    expect(formatPriceRange({ currency: 'NOK', priceMin: null, priceMax: null }, 'nb-NO')).toBeNull();
  });

  it('falls back to a plain number plus code for an invalid currency', () => {
    expect(formatPriceRange({ currency: 'XYZZY', priceMin: '10', priceMax: '10' }, 'en-US')).toBe(
      '10 XYZZY',
    );
  });

  it('ignores unparseable amounts', () => {
    expect(formatPriceRange({ currency: 'NOK', priceMin: 'n/a', priceMax: null }, 'nb-NO')).toBeNull();
  });
});
