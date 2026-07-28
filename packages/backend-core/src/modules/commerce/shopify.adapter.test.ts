import { describe, expect, it } from 'vitest';
import { ShopifyAdapter } from './shopify.adapter.ts';
import { ConnectorVendorError, type ConnectorFetch } from '../connectors/http.ts';
import type { ConnectorConnectionContext } from '../connectors/connector.ts';

interface RecordedRequest {
  url: string;
  body: { query: string; variables: Record<string, unknown> };
}

function stubGraphql(
  respond: (req: RecordedRequest) => unknown,
  status = 200,
): { fetch: ConnectorFetch; requests: RecordedRequest[] } {
  const requests: RecordedRequest[] = [];
  const fetch: ConnectorFetch = (url, init) => {
    const req = { url, body: JSON.parse(init.body!) as RecordedRequest['body'] };
    requests.push(req);
    const payload = status === 200 ? respond(req) : {};
    return Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(payload),
      text: () => Promise.resolve(JSON.stringify(payload)),
    });
  };
  return { fetch, requests };
}

function ctx(): ConnectorConnectionContext {
  return {
    config: {
      shopDomain: 'acme.myshopify.com',
      apiVersion: '2025-01',
      encryptedAccessToken: 'ct_abc',
    },
    decryptSecret: () => Promise.resolve('shpat_secret'),
  };
}

const orderNode = (over: Record<string, unknown> = {}) => ({
  id: 'gid://shopify/Order/1001',
  name: '#1001',
  createdAt: '2026-06-01T10:00:00Z',
  cancelledAt: null,
  closedAt: null,
  displayFinancialStatus: 'PAID',
  displayFulfillmentStatus: 'FULFILLED',
  subtotalLineItemsQuantity: 2,
  currentTotalPriceSet: { shopMoney: { amount: '49.90', currencyCode: 'EUR' } },
  customer: { id: 'gid://shopify/Customer/7', email: 'Jane@Example.com' },
  lineItems: { nodes: [{ title: 'Mug', quantity: 2, sku: 'MUG-1' }] },
  fulfillments: [
    {
      displayStatus: 'DELIVERED',
      trackingInfo: [{ company: 'DHL', number: 'JD1', url: 'https://t.example/JD1' }],
    },
  ],
  ...over,
});

const productNode = (over: Record<string, unknown> = {}) => ({
  id: 'gid://shopify/Product/501',
  title: 'Blue Mug',
  status: 'ACTIVE',
  onlineStoreUrl: 'https://acme.example/products/blue-mug',
  featuredMedia: { preview: { image: { url: 'https://cdn.example/mug.jpg' } } },
  priceRangeV2: {
    minVariantPrice: { amount: '19.90', currencyCode: 'EUR' },
    maxVariantPrice: { amount: '24.90', currencyCode: 'EUR' },
  },
  description: 'A sturdy blue mug.',
  variants: { nodes: [{ title: 'Default', sku: 'MUG-1', price: '19.90', availableForSale: true }] },
  ...over,
});

describe('ShopifyAdapter', () => {
  it('lists orders scoped to the customer id resolved from an exact email match', async () => {
    const { fetch, requests } = stubGraphql((req) => {
      if (req.body.query.includes('customers(')) {
        return {
          data: {
            customers: {
              nodes: [
                { id: 'gid://shopify/Customer/9', email: 'other@example.com' },
                { id: 'gid://shopify/Customer/7', email: 'jane@example.com' },
              ],
            },
          },
        };
      }
      return { data: { orders: { nodes: [orderNode()] } } };
    });
    const adapter = new ShopifyAdapter(fetch);

    const orders = await adapter.listOrdersForCustomer(ctx(), {
      email: 'JANE@example.com',
      limit: 5,
    });

    expect(requests[1]!.body.variables.q).toBe('customer_id:7');
    expect(orders).toHaveLength(1);
    expect(orders[0]).toMatchObject({
      orderRef: '1001',
      orderNumber: '#1001',
      status: 'open',
      financialStatus: 'paid',
      fulfillmentStatus: 'fulfilled',
      currency: 'EUR',
      total: '49.90',
      itemCount: 2,
    });
  });

  it('returns no orders when no customer matches the email exactly', async () => {
    const { fetch, requests } = stubGraphql(() => ({
      data: { customers: { nodes: [{ id: 'gid://shopify/Customer/9', email: 'close@example.com' }] } },
    }));
    const adapter = new ShopifyAdapter(fetch);

    const orders = await adapter.listOrdersForCustomer(ctx(), {
      email: 'jane@example.com',
      limit: 5,
    });

    expect(orders).toEqual([]);
    expect(requests).toHaveLength(1);
  });

  it('quotes and escapes the email in the customer search term', async () => {
    const { fetch, requests } = stubGraphql(() => ({ data: { customers: { nodes: [] } } }));
    const adapter = new ShopifyAdapter(fetch);

    await adapter.listOrdersForCustomer(ctx(), { email: 'a"b@example.com', limit: 5 });

    expect(requests[0]!.body.variables.q).toBe('email:"a\\"b@example.com"');
  });

  it('drops listed orders that belong to another customer', async () => {
    const { fetch } = stubGraphql((req) =>
      req.body.query.includes('customers(')
        ? { data: { customers: { nodes: [{ id: 'gid://shopify/Customer/7', email: 'jane@example.com' }] } } }
        : {
            data: {
              orders: {
                nodes: [
                  orderNode(),
                  orderNode({ customer: { id: 'gid://shopify/Customer/8', email: 'mallory@example.com' } }),
                ],
              },
            },
          },
    );
    const adapter = new ShopifyAdapter(fetch);

    const orders = await adapter.listOrdersForCustomer(ctx(), {
      email: 'jane@example.com',
      limit: 5,
    });

    expect(orders).toHaveLength(1);
  });

  it('fetches one order by number, normalizing a leading # and enforcing ownership', async () => {
    const { fetch, requests } = stubGraphql(() => ({
      data: { orders: { nodes: [orderNode()] } },
    }));
    const adapter = new ShopifyAdapter(fetch);

    const owned = await adapter.getOrderForCustomer(ctx(), {
      email: 'jane@example.com',
      orderNumber: '#1001',
    });
    const foreign = await adapter.getOrderForCustomer(ctx(), {
      email: 'mallory@example.com',
      orderNumber: '1001',
    });

    expect(requests[0]!.body.variables.q).toBe('name:"1001"');
    expect(owned?.items).toEqual([{ title: 'Mug', quantity: 2, sku: 'MUG-1' }]);
    expect(owned?.shipments).toEqual([
      {
        status: 'delivered',
        carrier: 'DHL',
        trackingNumbers: ['JD1'],
        trackingUrls: ['https://t.example/JD1'],
      },
    ]);
    expect(foreign).toBeNull();
  });

  it('rejects a non-numeric orderRef without calling the vendor', async () => {
    const { fetch, requests } = stubGraphql(() => ({ data: {} }));
    const adapter = new ShopifyAdapter(fetch);

    const result = await adapter.getOrderForCustomer(ctx(), {
      email: 'jane@example.com',
      orderRef: 'gid://shopify/Order/1001',
    });

    expect(result).toBeNull();
    expect(requests).toHaveLength(0);
  });

  it('searches published products with quoted tokens pinned to status:active', async () => {
    const { fetch, requests } = stubGraphql(() => ({
      data: { products: { nodes: [productNode(), productNode({ status: 'DRAFT' })] } },
    }));
    const adapter = new ShopifyAdapter(fetch);

    const products = await adapter.searchProducts(ctx(), {
      query: 'blue mug OR status:draft',
      limit: 10,
    });

    expect(requests[0]!.body.variables.q).toBe('status:active "blue" "mug" "OR" "status:draft"');
    expect(products).toHaveLength(1);
    expect(products[0]).toEqual({
      productRef: '501',
      title: 'Blue Mug',
      url: 'https://acme.example/products/blue-mug',
      imageUrl: 'https://cdn.example/mug.jpg',
      currency: 'EUR',
      priceMin: '19.90',
      priceMax: '24.90',
    });
  });

  it('fetches one product by ref with variants, refusing non-active products', async () => {
    const { fetch, requests } = stubGraphql((req) => ({
      data: {
        product: productNode(
          String(req.body.variables.id).endsWith('/502') ? { id: 'gid://shopify/Product/502', status: 'ARCHIVED' } : {},
        ),
      },
    }));
    const adapter = new ShopifyAdapter(fetch);

    const active = await adapter.getProduct(ctx(), { productRef: '501' });
    const archived = await adapter.getProduct(ctx(), { productRef: '502' });

    expect(requests[0]!.body.variables.id).toBe('gid://shopify/Product/501');
    expect(active?.description).toBe('A sturdy blue mug.');
    expect(active?.variants).toEqual([
      { title: 'Default', sku: 'MUG-1', price: '19.90', availableForSale: true },
    ]);
    expect(archived).toBeNull();
  });

  it('rejects a non-numeric productRef without calling the vendor', async () => {
    const { fetch, requests } = stubGraphql(() => ({ data: {} }));
    const adapter = new ShopifyAdapter(fetch);

    const result = await adapter.getProduct(ctx(), { productRef: 'gid://shopify/Product/501' });

    expect(result).toBeNull();
    expect(requests).toHaveLength(0);
  });

  it('fetches one product by sku with an escaped search term', async () => {
    const { fetch, requests } = stubGraphql(() => ({
      data: { products: { nodes: [productNode()] } },
    }));
    const adapter = new ShopifyAdapter(fetch);

    const product = await adapter.getProduct(ctx(), { sku: 'MUG-1' });

    expect(requests[0]!.body.variables.q).toBe('status:active sku:"MUG-1"');
    expect(product?.productRef).toBe('501');
  });

  it('maps 401 responses to a vendor error', async () => {
    const { fetch } = stubGraphql(() => ({}), 401);
    const adapter = new ShopifyAdapter(fetch);

    await expect(adapter.testConnection(ctx())).rejects.toBeInstanceOf(ConnectorVendorError);
  });

  it('surfaces graphql-level errors as vendor errors', async () => {
    const { fetch } = stubGraphql(() => ({ errors: [{ message: 'field not found' }] }));
    const adapter = new ShopifyAdapter(fetch);

    await expect(
      adapter.listOrdersForCustomer(ctx(), { email: 'jane@example.com', limit: 5 }),
    ).rejects.toThrow(/field not found/);
  });

  describe('buildStoredConfig', () => {
    const adapter = new ShopifyAdapter(stubGraphql(() => ({})).fetch);
    const encrypt = (plain: string) => Promise.resolve(`enc(${plain})`);

    it('encrypts a fresh access token and normalizes the domain', async () => {
      const stored = await adapter.buildStoredConfig(
        { shopDomain: 'Acme.myshopify.com', accessToken: 'shpat_new_token' },
        encrypt,
      );
      expect(stored).toEqual({
        shopDomain: 'acme.myshopify.com',
        apiVersion: '2025-01',
        encryptedAccessToken: 'enc(shpat_new_token)',
      });
    });

    it('keeps the previous ciphertext when accessToken is omitted on update', async () => {
      const stored = await adapter.buildStoredConfig(
        { shopDomain: 'acme.myshopify.com' },
        encrypt,
        { shopDomain: 'acme.myshopify.com', apiVersion: '2025-01', encryptedAccessToken: 'ct_old' },
      );
      expect(stored.encryptedAccessToken).toBe('ct_old');
    });

    it('requires an access token when there is no previous config', async () => {
      await expect(
        adapter.buildStoredConfig({ shopDomain: 'acme.myshopify.com' }, encrypt),
      ).rejects.toBeInstanceOf(ConnectorVendorError);
    });

    it('rejects non-myshopify domains', async () => {
      await expect(
        adapter.buildStoredConfig(
          { shopDomain: 'evil.example.com', accessToken: 'shpat_new_token' },
          encrypt,
        ),
      ).rejects.toThrow();
    });
  });
});
