import { describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import { shopifyOrderEvent, verifyShopifyHmac } from './shopify-order-events.ts';

const secret = 'shpss_test_signing_secret_0001';
const sign = (body: string) => createHmac('sha256', secret).update(body).digest('base64');

describe('Shopify order events', () => {
  it('accepts only a body signed with the connection secret', () => {
    const body = Buffer.from('{"id":1}');
    expect(verifyShopifyHmac(body, secret, sign('{"id":1}'))).toBe(true);
    expect(verifyShopifyHmac(body, secret, sign('{"id":2}'))).toBe(false);
    expect(verifyShopifyHmac(body, 'another-secret-entirely', sign('{"id":1}'))).toBe(false);
    expect(verifyShopifyHmac(body, secret, undefined)).toBe(false);
    expect(verifyShopifyHmac(body, secret, 'not base64 at all')).toBe(false);
  });

  it('turns a paid order into an order.paid product event with no address or name', () => {
    const event = shopifyOrderEvent({
      topic: 'orders/paid',
      webhookId: 'wh_1',
      shopDomain: 'acme.myshopify.com',
      body: {
        id: 450789469,
        name: '#1001',
        email: 'ola@kunde.test',
        total_price: '199.00',
        currency: 'NOK',
        financial_status: 'paid',
        processed_at: '2026-10-27T10:00:00Z',
        line_items: [{}, {}],
        shipping_address: { address1: 'Storgata 1' },
        customer: { first_name: 'Ola' },
      },
    });
    expect(event).toEqual({
      id: 'shopify:wh_1',
      name: 'order.paid',
      occurredAt: '2026-10-27T10:00:00.000Z',
      identity: { email: 'ola@kunde.test' },
      properties: {
        source: 'shopify',
        shop: 'acme.myshopify.com',
        orderId: '450789469',
        orderNumber: '#1001',
        totalPrice: '199.00',
        currency: 'NOK',
        financialStatus: 'paid',
        lineItemCount: 2,
      },
    });
    expect(JSON.stringify(event)).not.toContain('Storgata');
  });

  it('ignores topics it does not map and orders without a customer email', () => {
    expect(shopifyOrderEvent({ topic: 'products/update', webhookId: 'wh', shopDomain: 's', body: { email: 'a@b.test' } })).toBeNull();
    expect(shopifyOrderEvent({ topic: 'orders/paid', webhookId: 'wh', shopDomain: 's', body: { id: 1 } })).toBeNull();
    expect(
      shopifyOrderEvent({ topic: 'orders/create', webhookId: 'wh', shopDomain: 's', body: { customer: { email: 'kari@kunde.test' } } })
        ?.identity,
    ).toEqual({ email: 'kari@kunde.test' });
  });
});
