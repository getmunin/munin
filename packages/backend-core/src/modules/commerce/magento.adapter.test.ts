import { describe, expect, it } from 'vitest';
import { MagentoAdapter } from './magento.adapter.ts';
import { ConnectorVendorError, type ConnectorFetch } from '../connectors/http.ts';
import type { ConnectorConnectionContext } from '../connectors/connector.ts';

function stubRest(
  respond: (url: string) => { status?: number; body: unknown },
): { fetch: ConnectorFetch; urls: string[] } {
  const urls: string[] = [];
  const fetch: ConnectorFetch = (url) => {
    urls.push(url);
    const { status = 200, body } = respond(url);
    return Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(body),
      text: () => Promise.resolve(JSON.stringify(body)),
    });
  };
  return { fetch, urls };
}

function ctx(extra: Record<string, unknown> = {}): ConnectorConnectionContext {
  return {
    config: { baseUrl: 'https://store.example.com', encryptedAccessToken: 'ct_abc', ...extra },
    decryptSecret: () => Promise.resolve('integration_token'),
  };
}

const order = (over: Record<string, unknown> = {}) => ({
  entity_id: 42,
  increment_id: '000000042',
  status: 'processing',
  created_at: '2026-06-01 10:00:00',
  customer_email: 'jane@example.com',
  grand_total: 49.9,
  order_currency_code: 'EUR',
  total_qty_ordered: 2,
  items: [
    { name: 'Mug (Blue)', sku: 'MUG-1-BLUE', qty_ordered: 2, parent_item_id: 7 },
    { name: 'Mug', sku: 'MUG-1', qty_ordered: 2, parent_item_id: null },
  ],
  ...over,
});

const product = (over: Record<string, unknown> = {}) => ({
  id: 7,
  sku: 'MUG-1',
  name: 'Mug',
  price: 19.9,
  status: 1,
  type_id: 'simple',
  custom_attributes: [
    { attribute_code: 'image', value: '/m/u/mug.jpg' },
    { attribute_code: 'description', value: '<p>A mug.</p>' },
  ],
  ...over,
});

const storeConfigs = [{ code: 'default', base_currency_code: 'EUR' }];

describe('MagentoAdapter', () => {
  it('lists orders filtered by lowercased customer email, newest first', async () => {
    const { fetch, urls } = stubRest(() => ({
      body: { items: [order()], total_count: 1 },
    }));
    const adapter = new MagentoAdapter(fetch);

    const orders = await adapter.listOrdersForCustomer(ctx(), {
      email: 'Jane@Example.com',
      limit: 5,
    });

    const url = new URL(urls[0]!);
    expect(url.pathname).toBe('/rest/V1/orders');
    expect(url.searchParams.get('searchCriteria[filter_groups][0][filters][0][field]')).toBe(
      'customer_email',
    );
    expect(url.searchParams.get('searchCriteria[filter_groups][0][filters][0][value]')).toBe(
      'jane@example.com',
    );
    expect(url.searchParams.get('searchCriteria[sortOrders][0][direction]')).toBe('DESC');
    expect(url.searchParams.get('searchCriteria[pageSize]')).toBe('5');
    expect(orders[0]).toMatchObject({
      orderRef: '42',
      orderNumber: '000000042',
      status: 'processing',
      currency: 'EUR',
      total: '49.90',
      itemCount: 2,
      createdAt: '2026-06-01T10:00:00Z',
    });
  });

  it('drops listed orders whose customer_email does not match', async () => {
    const { fetch } = stubRest(() => ({
      body: { items: [order(), order({ customer_email: 'mallory@example.com' })], total_count: 2 },
    }));
    const adapter = new MagentoAdapter(fetch);

    const orders = await adapter.listOrdersForCustomer(ctx(), {
      email: 'jane@example.com',
      limit: 5,
    });

    expect(orders).toHaveLength(1);
  });

  it('fetches one order by ref with shipments, excluding child line items', async () => {
    const { fetch, urls } = stubRest((url) =>
      url.includes('/rest/V1/orders/42')
        ? { body: order() }
        : {
            body: {
              items: [
                {
                  tracks: [
                    { track_number: 'JD1', carrier_code: 'dhl', title: 'DHL' },
                    { track_number: null, carrier_code: null, title: null },
                  ],
                },
              ],
              total_count: 1,
            },
          },
    );
    const adapter = new MagentoAdapter(fetch);

    const detail = await adapter.getOrderForCustomer(ctx(), {
      email: 'jane@example.com',
      orderRef: '42',
    });

    expect(urls[1]).toContain('/rest/V1/shipments');
    expect(detail?.items).toEqual([{ title: 'Mug', quantity: 2, sku: 'MUG-1' }]);
    expect(detail?.shipments).toEqual([
      { status: null, carrier: 'DHL', trackingNumbers: ['JD1'], trackingUrls: [] },
    ]);
  });

  it('returns null for an order owned by someone else, without fetching shipments', async () => {
    const { fetch, urls } = stubRest(() => ({ body: order() }));
    const adapter = new MagentoAdapter(fetch);

    const detail = await adapter.getOrderForCustomer(ctx(), {
      email: 'mallory@example.com',
      orderRef: '42',
    });

    expect(detail).toBeNull();
    expect(urls).toHaveLength(1);
  });

  it('returns null when the order id does not exist (404)', async () => {
    const { fetch } = stubRest(() => ({ status: 404, body: { message: 'not found' } }));
    const adapter = new MagentoAdapter(fetch);

    const detail = await adapter.getOrderForCustomer(ctx(), {
      email: 'jane@example.com',
      orderRef: '999',
    });

    expect(detail).toBeNull();
  });

  it('finds an order by increment id, stripping a leading #', async () => {
    const { fetch, urls } = stubRest((url) =>
      url.includes('/rest/V1/shipments')
        ? { body: { items: [], total_count: 0 } }
        : { body: { items: [order()], total_count: 1 } },
    );
    const adapter = new MagentoAdapter(fetch);

    const detail = await adapter.getOrderForCustomer(ctx(), {
      email: 'jane@example.com',
      orderNumber: '#000000042',
    });

    const url = new URL(urls[0]!);
    expect(url.searchParams.get('searchCriteria[filter_groups][0][filters][0][field]')).toBe(
      'increment_id',
    );
    expect(url.searchParams.get('searchCriteria[filter_groups][0][filters][0][value]')).toBe(
      '000000042',
    );
    expect(detail?.orderNumber).toBe('000000042');
  });


  it('requires every term to appear, in any order, via one filter group per term', async () => {
    const { fetch, urls } = stubRest((url) =>
      url.includes('/rest/V1/store/storeConfigs')
        ? { body: storeConfigs }
        : { body: { items: [product()], total_count: 1 } },
    );
    const adapter = new MagentoAdapter(fetch);

    await adapter.searchProducts(ctx(), { query: 'reim acme', limit: 10 });

    const url = new URL(urls[1]!);
    const g = (group: number, filter: number, part: string) =>
      url.searchParams.get(`searchCriteria[filter_groups][${group}][filters][${filter}][${part}]`);
    expect(g(0, 0, 'value')).toBe('%reim%');
    expect(g(0, 1, 'field')).toBe('sku');
    expect(g(1, 0, 'value')).toBe('%acme%');
    expect(g(1, 1, 'field')).toBe('sku');
    expect(g(2, 0, 'field')).toBe('status');
    expect(g(3, 0, 'field')).toBe('visibility');
  });

  it('retries a multi-term search as one OR group when all-terms finds nothing', async () => {
    let productCalls = 0;
    const { fetch, urls } = stubRest((url) => {
      if (url.includes('/rest/V1/store/storeConfigs')) return { body: storeConfigs };
      productCalls += 1;
      return productCalls === 1
        ? { body: { items: [], total_count: 0 } }
        : { body: { items: [product()], total_count: 1 } };
    });
    const adapter = new MagentoAdapter(fetch);

    const products = await adapter.searchProducts(ctx(), {
      query: 'reim jenter',
      limit: 10,
    });

    expect(productCalls).toBe(2);
    const retry = new URL(urls[urls.length - 1]!);
    const g = (filter: number, part: string) =>
      retry.searchParams.get(`searchCriteria[filter_groups][0][filters][${filter}][${part}]`);
    expect(g(0, 'value')).toBe('%reim%');
    expect(g(1, 'field')).toBe('sku');
    expect(g(2, 'value')).toBe('%jenter%');
    expect(g(3, 'field')).toBe('sku');
    expect(retry.searchParams.get('searchCriteria[filter_groups][1][filters][0][field]')).toBe(
      'status',
    );
    expect(products).toHaveLength(1);
  });

  it('does not retry a single-term search that found nothing', async () => {
    let productCalls = 0;
    const { fetch } = stubRest((url) => {
      if (url.includes('/rest/V1/store/storeConfigs')) return { body: storeConfigs };
      productCalls += 1;
      return { body: { items: [], total_count: 0 } };
    });
    const adapter = new MagentoAdapter(fetch);

    const products = await adapter.searchProducts(ctx(), { query: 'nonesuch', limit: 10 });

    expect(productCalls).toBe(1);
    expect(products).toEqual([]);
  });

  it('searches enabled, visible products by name or sku with the store currency', async () => {
    const { fetch, urls } = stubRest((url) =>
      url.includes('/rest/V1/store/storeConfigs')
        ? { body: storeConfigs }
        : { body: { items: [product()], total_count: 1 } },
    );
    const adapter = new MagentoAdapter(fetch);

    const products = await adapter.searchProducts(ctx(), { query: 'mu_g', limit: 10 });

    const url = new URL(urls[1]!);
    expect(url.pathname).toBe('/rest/V1/products');
    expect(url.searchParams.get('searchCriteria[filter_groups][0][filters][0][field]')).toBe('name');
    expect(url.searchParams.get('searchCriteria[filter_groups][0][filters][0][value]')).toBe('%mu\\_g%');
    expect(url.searchParams.get('searchCriteria[filter_groups][0][filters][1][field]')).toBe('sku');
    expect(url.searchParams.get('searchCriteria[filter_groups][1][filters][0][field]')).toBe('status');
    expect(url.searchParams.get('searchCriteria[filter_groups][2][filters][0][field]')).toBe('visibility');
    expect(url.searchParams.get('searchCriteria[filter_groups][2][filters][0][condition_type]')).toBe('neq');
    expect(products).toEqual([
      {
        productRef: 'MUG-1',
        title: 'Mug',
        url: null,
        imageUrl: 'https://store.example.com/media/catalog/product/m/u/mug.jpg',
        currency: 'EUR',
        priceMin: '19.90',
        priceMax: '19.90',
      },
    ]);
  });

  it('fetches a simple product with a single variant and live stock', async () => {
    const { fetch, urls } = stubRest((url) =>
      url.includes('/storeConfigs')
        ? { body: storeConfigs }
        : url.includes('/stockItems/')
          ? { body: { is_in_stock: true } }
          : { body: product() },
    );
    const adapter = new MagentoAdapter(fetch);

    const detail = await adapter.getProduct(ctx(), { sku: 'MUG-1' });

    expect(urls[0]).toContain('/rest/V1/products/MUG-1');
    expect(detail?.description).toBe('<p>A mug.</p>');
    expect(detail?.variants).toEqual([
      { title: 'Mug', sku: 'MUG-1', price: '19.90', availableForSale: true },
    ]);
  });

  it('expands configurable products into children with a price range from variants', async () => {
    const { fetch } = stubRest((url) =>
      url.includes('/storeConfigs')
        ? { body: storeConfigs }
        : url.includes('/configurable-products/')
          ? {
              body: [
                product({ sku: 'MUG-1-S', name: 'Mug S', price: 17.5 }),
                product({ sku: 'MUG-1-L', name: 'Mug L', price: 22 }),
              ],
            }
          : url.includes('/stockItems/MUG-1-S')
            ? { body: { is_in_stock: false } }
            : url.includes('/stockItems/')
              ? { body: { is_in_stock: true } }
              : { body: product({ sku: 'MUG-1', type_id: 'configurable', price: null }) },
    );
    const adapter = new MagentoAdapter(fetch);

    const detail = await adapter.getProduct(ctx(), { productRef: 'MUG-1' });

    expect(detail?.priceMin).toBe('17.50');
    expect(detail?.priceMax).toBe('22.00');
    expect(detail?.variants).toEqual([
      { title: 'Mug S', sku: 'MUG-1-S', price: '17.50', availableForSale: false },
      { title: 'Mug L', sku: 'MUG-1-L', price: '22.00', availableForSale: true },
    ]);
  });

  it('treats disabled products and unknown skus as not found', async () => {
    const { fetch } = stubRest((url) =>
      url.includes('/rest/V1/products/GONE')
        ? { status: 404, body: { message: 'not found' } }
        : { body: product({ status: 2 }) },
    );
    const adapter = new MagentoAdapter(fetch);

    expect(await adapter.getProduct(ctx(), { sku: 'MUG-1' })).toBeNull();
    expect(await adapter.getProduct(ctx(), { sku: 'GONE' })).toBeNull();
  });

  it('reports null availability when the stock endpoint is not accessible', async () => {
    const { fetch } = stubRest((url) =>
      url.includes('/storeConfigs')
        ? { body: storeConfigs }
        : url.includes('/stockItems/')
          ? { status: 401, body: {} }
          : { body: product() },
    );
    const adapter = new MagentoAdapter(fetch);

    const detail = await adapter.getProduct(ctx(), { sku: 'MUG-1' });

    expect(detail?.variants[0]!.availableForSale).toBeNull();
  });

  it('maps 401 responses to a vendor error', async () => {
    const { fetch } = stubRest(() => ({ status: 401, body: {} }));
    const adapter = new MagentoAdapter(fetch);

    await expect(adapter.testConnection(ctx())).rejects.toBeInstanceOf(ConnectorVendorError);
  });

  describe('buildStoredConfig', () => {
    const adapter = new MagentoAdapter(stubRest(() => ({ body: {} })).fetch);
    const encrypt = (plain: string) => Promise.resolve(`enc(${plain})`);

    it('strips trailing slashes and encrypts the token', async () => {
      const stored = await adapter.buildStoredConfig(
        { baseUrl: 'https://store.example.com//', accessToken: 'integration_token' },
        encrypt,
      );
      expect(stored).toEqual({
        baseUrl: 'https://store.example.com',
        encryptedAccessToken: 'enc(integration_token)',
      });
    });

    it('rejects plain-http base urls', async () => {
      await expect(
        adapter.buildStoredConfig(
          { baseUrl: 'http://store.example.com', accessToken: 'integration_token' },
          encrypt,
        ),
      ).rejects.toThrow(/https/);
    });

    it('keeps the previous ciphertext when accessToken is omitted on update', async () => {
      const stored = await adapter.buildStoredConfig(
        { baseUrl: 'https://store.example.com' },
        encrypt,
        { baseUrl: 'https://store.example.com', encryptedAccessToken: 'ct_old' },
      );
      expect(stored.encryptedAccessToken).toBe('ct_old');
    });
  });

  describe('with a storeCode', () => {
    const multiStoreConfigs = [
      { id: 1, code: 'default', website_id: 1, base_currency_code: 'EUR' },
      { id: 2, code: 'acme', website_id: 2, base_currency_code: 'NOK' },
      { id: 3, code: 'acme_en', website_id: 2, base_currency_code: 'NOK' },
      { id: 4, code: 'globex', website_id: 3, base_currency_code: 'NOK' },
    ];
    const scoped = () => ctx({ storeCode: 'acme' });

    it('calls the store-scoped REST root and filters product search to that website', async () => {
      const { fetch, urls } = stubRest((url) =>
        url.includes('/store/storeConfigs')
          ? { body: multiStoreConfigs }
          : { body: { items: [product()], total_count: 1 } },
      );
      const adapter = new MagentoAdapter(fetch);

      const products = await adapter.searchProducts(scoped(), { query: 'mug', limit: 10 });

      expect(new URL(urls[0]!).pathname).toBe('/rest/acme/V1/store/storeConfigs');
      const url = new URL(urls[1]!);
      expect(url.pathname).toBe('/rest/acme/V1/products');
      expect(url.searchParams.get('searchCriteria[filter_groups][3][filters][0][field]')).toBe(
        'website_id',
      );
      expect(url.searchParams.get('searchCriteria[filter_groups][3][filters][0][value]')).toBe('2');
      expect(products[0]?.currency).toBe('NOK');
    });

    it('limits order lookups to every store view of the scoped website', async () => {
      const { fetch, urls } = stubRest((url) =>
        url.includes('/store/storeConfigs')
          ? { body: multiStoreConfigs }
          : {
              body: {
                items: [order({ store_id: 3 }), order({ entity_id: 43, store_id: 4 })],
                total_count: 2,
              },
            },
      );
      const adapter = new MagentoAdapter(fetch);

      const orders = await adapter.listOrdersForCustomer(scoped(), {
        email: 'jane@example.com',
        limit: 5,
      });

      const url = new URL(urls[1]!);
      expect(url.pathname).toBe('/rest/acme/V1/orders');
      expect(url.searchParams.get('searchCriteria[filter_groups][1][filters][0][field]')).toBe(
        'store_id',
      );
      expect(url.searchParams.get('searchCriteria[filter_groups][1][filters][0][value]')).toBe(
        '2,3',
      );
      expect(url.searchParams.get('searchCriteria[filter_groups][1][filters][0][condition_type]')).toBe(
        'in',
      );
      expect(orders.map((o) => o.orderRef)).toEqual(['42']);
    });

    it('treats an order from another website as not found', async () => {
      const { fetch, urls } = stubRest((url) =>
        url.includes('/store/storeConfigs')
          ? { body: multiStoreConfigs }
          : { body: order({ store_id: 4 }) },
      );
      const adapter = new MagentoAdapter(fetch);

      const detail = await adapter.getOrderForCustomer(scoped(), {
        email: 'jane@example.com',
        orderRef: '42',
      });

      expect(detail).toBeNull();
      expect(urls.some((u) => u.includes('/shipments'))).toBe(false);
    });

    it('scopes an increment-id lookup to the website, since increment ids repeat across stores', async () => {
      const { fetch, urls } = stubRest((url) =>
        url.includes('/store/storeConfigs')
          ? { body: multiStoreConfigs }
          : url.includes('/shipments')
            ? { body: { items: [], total_count: 0 } }
            : { body: { items: [order({ store_id: 2 })], total_count: 1 } },
      );
      const adapter = new MagentoAdapter(fetch);

      const detail = await adapter.getOrderForCustomer(scoped(), {
        email: 'jane@example.com',
        orderNumber: '000000042',
      });

      const url = new URL(urls[1]!);
      expect(url.searchParams.get('searchCriteria[filter_groups][1][filters][0][value]')).toBe(
        '2,3',
      );
      expect(detail?.orderNumber).toBe('000000042');
    });

    it('hides a product that is not assigned to the scoped website', async () => {
      const { fetch } = stubRest((url) =>
        url.includes('/store/storeConfigs')
          ? { body: multiStoreConfigs }
          : { body: product({ extension_attributes: { website_ids: [3] } }) },
      );
      const adapter = new MagentoAdapter(fetch);

      expect(await adapter.getProduct(scoped(), { sku: 'MUG-1' })).toBeNull();
    });

    it('fails the connection test with the known codes when the store code does not exist', async () => {
      const { fetch } = stubRest(() => ({ body: multiStoreConfigs }));
      const adapter = new MagentoAdapter(fetch);

      await expect(adapter.testConnection(ctx({ storeCode: 'nope' }))).rejects.toThrow(
        /no store view with code nope \(store views: default, acme, acme_en, globex\)/,
      );
      await expect(adapter.testConnection(scoped())).resolves.toMatchObject({
        ok: true,
        detail: 'connected; scoped to store view acme (website 2, 2 store view(s))',
      });
    });

    it('stores and exposes the store code, and drops a blank one', async () => {
      const adapter = new MagentoAdapter(stubRest(() => ({ body: {} })).fetch);
      const encrypt = (plain: string) => Promise.resolve(`enc(${plain})`);

      const stored = await adapter.buildStoredConfig(
        { baseUrl: 'https://store.example.com', accessToken: 'integration_token', storeCode: ' acme ' },
        encrypt,
      );
      expect(stored).toMatchObject({ storeCode: 'acme' });
      expect(adapter.publicConfig(stored)).toEqual({
        baseUrl: 'https://store.example.com',
        storeCode: 'acme',
      });

      const blank = await adapter.buildStoredConfig(
        { baseUrl: 'https://store.example.com', accessToken: 'integration_token', storeCode: '' },
        encrypt,
      );
      expect(blank).not.toHaveProperty('storeCode');
    });

    it('rejects a store code that is not a valid Magento code', () => {
      const adapter = new MagentoAdapter(stubRest(() => ({ body: {} })).fetch);
      expect(
        adapter.configInput.safeParse({ baseUrl: 'https://store.example.com', storeCode: '../admin' })
          .success,
      ).toBe(false);
    });
  });
});
