import { describe, expect, it } from 'vitest';
import { MagentoAdapter } from './magento.adapter.ts';
import { ConnectorVendorError, type ConnectorFetch } from '../http.ts';
import type { ConnectorConnectionContext } from '../connector.ts';

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

function ctx(): ConnectorConnectionContext {
  return {
    config: { baseUrl: 'https://store.example.com', encryptedAccessToken: 'ct_abc' },
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
});
