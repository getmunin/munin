import { describe, expect, it } from 'vitest';
import { deriveMessageComponents } from './message-components.ts';
import type { ToolCallTrace } from './types.ts';

function call(name: string, payload: unknown, isError = false): ToolCallTrace {
  return {
    name,
    args: {},
    result: { content: [{ type: 'text', text: JSON.stringify(payload) }], ...(isError ? { isError: true } : {}) },
  };
}

const connection = { id: 'conn_1', name: 'Nordic Supply', vendor: 'shopify' };

const product = {
  productRef: 'gid://shopify/Product/1',
  title: 'Fjell Shell 3L',
  url: 'https://nordicsupply.no/products/fjell-shell',
  imageUrl: 'https://cdn.shopify.com/fjell.jpg',
  currency: 'NOK',
  priceMin: '1890.00',
  priceMax: '1890.00',
};

describe('deriveMessageComponents', () => {
  it('derives a product list from a catalog search', () => {
    const components = deriveMessageComponents([
      call('commerce_search_products', { connection, products: [product] }),
    ]);
    expect(components).toEqual([
      {
        type: 'product_list',
        source: { connectionId: 'conn_1', vendor: 'shopify', label: 'Nordic Supply' },
        items: [
          {
            productRef: 'gid://shopify/Product/1',
            title: 'Fjell Shell 3L',
            url: 'https://nordicsupply.no/products/fjell-shell',
            imageUrl: 'https://cdn.shopify.com/fjell.jpg',
            currency: 'NOK',
            priceMin: '1890.00',
            priceMax: '1890.00',
          },
        ],
      },
    ]);
  });

  it('returns undefined when no catalog search ran', () => {
    expect(deriveMessageComponents([call('kb_search', { hits: [] })])).toBeUndefined();
    expect(deriveMessageComponents([])).toBeUndefined();
  });

  it('uses the last search of the turn so a refined query wins', () => {
    const refined = { ...product, productRef: 'gid://shopify/Product/2', title: 'Storm Anorak' };
    const components = deriveMessageComponents([
      call('commerce_search_products', { connection, products: [product] }),
      call('commerce_search_products', { connection, products: [refined] }),
    ]);
    expect(components?.[0]?.items.map((i) => i.title)).toEqual(['Storm Anorak']);
  });

  it('skips errored searches and falls back to an earlier successful one', () => {
    const components = deriveMessageComponents([
      call('commerce_search_products', { connection, products: [product] }),
      call('commerce_search_products', { error: 'vendor timeout' }, true),
    ]);
    expect(components?.[0]?.items).toHaveLength(1);
  });

  it('attaches nothing when the search returned no products', () => {
    expect(
      deriveMessageComponents([call('commerce_search_products', { connection, products: [] })]),
    ).toBeUndefined();
  });

  it('caps the gallery at eight items and drops duplicate refs', () => {
    const many = Array.from({ length: 12 }, (_, i) => ({
      ...product,
      productRef: `gid://shopify/Product/${i}`,
      title: `Jacket ${i}`,
    }));
    many.push({ ...product, productRef: 'gid://shopify/Product/0', title: 'Duplicate' });
    const items = deriveMessageComponents([
      call('commerce_search_products', { connection, products: many }),
    ])?.[0]?.items;
    expect(items).toHaveLength(8);
    expect(items?.map((i) => i.title)).not.toContain('Duplicate');
  });

  it('nulls insecure and malformed urls instead of dropping the product', () => {
    const items = deriveMessageComponents([
      call('commerce_search_products', {
        connection,
        products: [{ ...product, imageUrl: 'http://insecure.example/a.jpg', url: 'javascript:alert(1)' }],
      }),
    ])?.[0]?.items;
    expect(items?.[0]?.imageUrl).toBeNull();
    expect(items?.[0]?.url).toBeNull();
    expect(items?.[0]?.title).toBe('Fjell Shell 3L');
  });

  it('drops products missing the fields the gallery renders', () => {
    expect(
      deriveMessageComponents([
        call('commerce_search_products', {
          connection,
          products: [{ productRef: 'p1', imageUrl: null, currency: 'NOK' }],
        }),
      ]),
    ).toBeUndefined();
  });

  it('falls back to the vendor name when the connection has no label', () => {
    const components = deriveMessageComponents([
      call('commerce_search_products', {
        connection: { id: 'conn_1', name: '', vendor: 'magento' },
        products: [product],
      }),
    ]);
    expect(components?.[0]?.source.label).toBe('magento');
  });

  it('ignores a non-json tool result', () => {
    expect(
      deriveMessageComponents([
        { name: 'commerce_search_products', args: {}, result: { content: [{ type: 'text', text: 'not json' }] } },
      ]),
    ).toBeUndefined();
  });
});
