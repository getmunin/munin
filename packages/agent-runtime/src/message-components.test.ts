import { describe, expect, it, vi } from 'vitest';
import {
  SHOW_PRODUCTS_TOOL,
  deriveMessageComponents,
  withProductCards,
} from './message-components.ts';
import type { McpTool, McpToolHandle, McpToolResult, ToolCallTrace } from './types.ts';

function json(payload: unknown, isError = false): McpToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(payload) }], ...(isError ? { isError: true } : {}) };
}

function call(name: string, payload: unknown, isError = false, args: Record<string, unknown> = {}): ToolCallTrace {
  return { name, args, result: json(payload, isError) };
}

function show(...productRefs: string[]): ToolCallTrace {
  return call(SHOW_PRODUCTS_TOOL, { shown: productRefs }, false, { productRefs });
}

const connection = { id: 'conn_1', name: 'Nordic Supply', vendor: 'shopify' };

const product = {
  productRef: 'gid://shopify/Product/1',
  title: 'Fjell Shell 3L',
  url: 'https://nordicsupply.test/products/fjell-shell',
  imageUrl: 'https://cdn.shopify.com/fjell.jpg',
  currency: 'NOK',
  priceMin: '1890.00',
  priceMax: '1890.00',
};

const anorak = { ...product, productRef: 'gid://shopify/Product/2', title: 'Storm Anorak' };
const strap = { ...product, productRef: 'gid://shopify/Product/3', title: 'Watch Strap Black' };

describe('deriveMessageComponents', () => {
  it('renders the products the agent chose to show', () => {
    const components = deriveMessageComponents([
      call('commerce_search_products', { connection, products: [product] }),
      show(product.productRef),
    ]);
    expect(components).toEqual([
      {
        type: 'product_list',
        source: { connectionId: 'conn_1', vendor: 'shopify', label: 'Nordic Supply' },
        items: [
          {
            productRef: 'gid://shopify/Product/1',
            title: 'Fjell Shell 3L',
            url: 'https://nordicsupply.test/products/fjell-shell',
            imageUrl: 'https://cdn.shopify.com/fjell.jpg',
            currency: 'NOK',
            priceMin: '1890.00',
            priceMax: '1890.00',
          },
        ],
      },
    ]);
  });

  it('attaches nothing for a search the agent did not choose to show', () => {
    expect(
      deriveMessageComponents([
        call('commerce_search_products', { connection, products: [product, anorak, strap] }),
      ]),
    ).toBeUndefined();
  });

  it('shows only the chosen subset of a broad search, in the chosen order', () => {
    const items = deriveMessageComponents([
      call('commerce_search_products', { connection, products: [strap, product, anorak] }),
      show(anorak.productRef, product.productRef),
    ])?.[0]?.items;
    expect(items?.map((i) => i.title)).toEqual(['Storm Anorak', 'Fjell Shell 3L']);
  });

  it('can show a product found by any search or product lookup in the turn', () => {
    const items = deriveMessageComponents([
      call('commerce_search_products', { connection, products: [product] }),
      call('commerce_get_product', { connection, product: { ...anorak, description: null, variants: [] } }),
      call('commerce_search_products', { connection, products: [strap] }),
      show(product.productRef, anorak.productRef),
    ])?.[0]?.items;
    expect(items?.map((i) => i.title)).toEqual(['Fjell Shell 3L', 'Storm Anorak']);
  });

  it('prefers the latest catalog data for a product', () => {
    const items = deriveMessageComponents([
      call('commerce_search_products', { connection, products: [{ ...product, priceMin: null, priceMax: null }] }),
      call('commerce_get_product', {
        connection,
        product: { ...product, priceMin: '1590.00', description: null, variants: [] },
      }),
      show(product.productRef),
    ])?.[0]?.items;
    expect(items?.[0]?.priceMin).toBe('1590.00');
  });

  it('ignores refs that no catalog result in the turn returned', () => {
    const items = deriveMessageComponents([
      call('commerce_search_products', { connection, products: [product] }),
      show('gid://shopify/Product/404', product.productRef),
    ])?.[0]?.items;
    expect(items?.map((i) => i.productRef)).toEqual([product.productRef]);
    expect(
      deriveMessageComponents([
        call('commerce_search_products', { connection, products: [product] }),
        show('gid://shopify/Product/404'),
      ]),
    ).toBeUndefined();
  });

  it('uses the last successful show_products call', () => {
    const items = deriveMessageComponents([
      call('commerce_search_products', { connection, products: [product, anorak] }),
      show(product.productRef),
      show(anorak.productRef),
      call(SHOW_PRODUCTS_TOOL, { error: 'no_matching_products' }, true, { productRefs: ['nope'] }),
    ])?.[0]?.items;
    expect(items?.map((i) => i.title)).toEqual(['Storm Anorak']);
  });

  it('skips errored catalog calls', () => {
    expect(
      deriveMessageComponents([
        call('commerce_search_products', { connection, products: [product] }, true),
        show(product.productRef),
      ]),
    ).toBeUndefined();
  });

  it('returns undefined when nothing was shown', () => {
    expect(deriveMessageComponents([call('kb_search', { hits: [] })])).toBeUndefined();
    expect(deriveMessageComponents([])).toBeUndefined();
  });

  it('caps the gallery at eight items and drops duplicate refs', () => {
    const many = Array.from({ length: 12 }, (_, i) => ({
      ...product,
      productRef: `gid://shopify/Product/${i}`,
      title: `Jacket ${i}`,
    }));
    const items = deriveMessageComponents([
      call('commerce_search_products', { connection, products: many }),
      call(SHOW_PRODUCTS_TOOL, {}, false, {
        productRefs: ['gid://shopify/Product/0', 'gid://shopify/Product/0', ...many.map((p) => p.productRef)],
      }),
    ])?.[0]?.items;
    expect(items).toHaveLength(8);
    expect(items?.filter((i) => i.productRef === 'gid://shopify/Product/0')).toHaveLength(1);
  });

  it('groups products from different connections into separate galleries', () => {
    const other = { id: 'conn_2', name: 'Outlet', vendor: 'magento' };
    const components = deriveMessageComponents([
      call('commerce_search_products', { connection, products: [product] }),
      call('commerce_search_products', { connection: other, products: [anorak] }),
      show(product.productRef, anorak.productRef),
    ]);
    expect(components?.map((c) => c.source.connectionId)).toEqual(['conn_1', 'conn_2']);
  });

  it('nulls insecure and malformed urls instead of dropping the product', () => {
    const items = deriveMessageComponents([
      call('commerce_search_products', {
        connection,
        products: [{ ...product, imageUrl: 'http://insecure.example/a.jpg', url: 'javascript:alert(1)' }],
      }),
      show(product.productRef),
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
        show('p1'),
      ]),
    ).toBeUndefined();
  });

  it('falls back to the vendor name when the connection has no label', () => {
    const components = deriveMessageComponents([
      call('commerce_search_products', {
        connection: { id: 'conn_1', name: '', vendor: 'magento' },
        products: [product],
      }),
      show(product.productRef),
    ]);
    expect(components?.[0]?.source.label).toBe('magento');
  });

  it('ignores a non-json tool result', () => {
    expect(
      deriveMessageComponents([
        { name: 'commerce_search_products', args: {}, result: { content: [{ type: 'text', text: 'not json' }] } },
        show(product.productRef),
      ]),
    ).toBeUndefined();
  });
});

describe('withProductCards', () => {
  function handle(tools: McpTool[], results: Record<string, McpToolResult> = {}): McpToolHandle {
    return {
      listTools: vi.fn(() => Promise.resolve(tools)),
      callTool: vi.fn((name: string) => Promise.resolve(results[name] ?? json({ ok: true }))),
    };
  }

  const search: McpTool = { name: 'commerce_search_products', inputSchema: { type: 'object' } };
  const kb: McpTool = { name: 'kb_search', inputSchema: { type: 'object' } };

  it('offers show_products only when catalog tools are available', async () => {
    expect((await withProductCards(handle([kb])).listTools()).map((t) => t.name)).toEqual(['kb_search']);
    expect((await withProductCards(handle([kb, search])).listTools()).map((t) => t.name)).toEqual([
      'kb_search',
      'commerce_search_products',
      SHOW_PRODUCTS_TOOL,
    ]);
  });

  it('answers show_products locally and confirms products found this turn', async () => {
    const inner = handle([search], {
      commerce_search_products: json({ connection, products: [product, anorak] }),
    });
    const wrapped = withProductCards(inner);
    await wrapped.callTool('commerce_search_products', { query: 'jacket' });
    const result = await wrapped.callTool(SHOW_PRODUCTS_TOOL, {
      productRefs: [anorak.productRef, 'gid://shopify/Product/404'],
    });
    expect(result.isError).toBeUndefined();
    expect(JSON.parse((result.content[0] as { text: string }).text)).toEqual({
      shown: ['Storm Anorak'],
      unknown: ['gid://shopify/Product/404'],
    });
    expect(inner.callTool).not.toHaveBeenCalledWith(SHOW_PRODUCTS_TOOL, expect.anything());
  });

  it('errors when none of the refs were looked up this turn', async () => {
    const wrapped = withProductCards(handle([search]));
    const result = await wrapped.callTool(SHOW_PRODUCTS_TOOL, { productRefs: [product.productRef] });
    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain('no_matching_products');
  });
});
