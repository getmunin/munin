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

  const now = new Date('2026-10-28T10:00:00Z');
  const event = (topic: string, body: Record<string, unknown>) =>
    shopifyOrderEvent({ topic, shopDomain: 'acme.myshopify.com', rawBody: Buffer.from(JSON.stringify(body)), body, now });

  it('turns a paid order into an order.paid product event with no address or name', () => {
    const body = {
      id: 450789469,
      name: '#1001',
      email: 'ola@kunde.test',
      total_price: '199.00',
      currency: 'NOK',
      financial_status: 'paid',
      processed_at: '2026-10-27T10:00:00Z',
      updated_at: '2026-10-27T10:00:00Z',
      line_items: [{}, {}],
      shipping_address: { address1: 'Storgata 1' },
      customer: { first_name: 'Ola', email: 'ola@kunde.test', verified_email: true },
    };
    const paid = event('orders/paid', body);
    const { id, ...rest } = paid!;
    expect(id).toMatch(/^shopify:orders\/paid:[0-9a-f]{40}$/);
    expect(rest).toEqual({
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
    expect(JSON.stringify(paid)).not.toContain('Storgata');
  });

  it('keys an event on its signed body, so a replay under another webhook id is the same event', () => {
    const body = { id: 1, email: 'ola@kunde.test', updated_at: '2026-10-28T09:00:00Z' };
    expect(event('orders/paid', body)!.id).toBe(event('orders/paid', { ...body })!.id);
    expect(event('orders/paid', body)!.id).not.toBe(event('orders/paid', { ...body, financial_status: 'refunded' })!.id);
    expect(event('orders/paid', body)!.id).not.toBe(event('orders/fulfilled', body)!.id);
  });

  it('ignores an order last changed more than three days ago', () => {
    expect(event('orders/paid', { id: 1, email: 'ola@kunde.test', updated_at: '2026-10-24T09:00:00Z' })).toBeNull();
    expect(event('orders/paid', { id: 1, email: 'ola@kunde.test', updated_at: '2026-10-26T09:00:00Z' })).not.toBeNull();
  });

  it('marks an address the shopper typed as unverified unless Shopify verified the customer email', () => {
    expect(event('orders/create', { email: 'kari@kunde.test' })!.identity).toEqual({ email: 'kari@kunde.test', verified: false });
    expect(
      event('orders/create', { email: 'kari@kunde.test', customer: { email: 'other@kunde.test', verified_email: true } })!.identity,
    ).toEqual({ email: 'kari@kunde.test', verified: false });
    expect(event('orders/create', { email: 'Kari@kunde.test', customer: { email: 'kari@kunde.test', verified_email: true } })!.identity).toEqual({
      email: 'Kari@kunde.test',
    });
  });

  it('ignores topics it does not map and orders without a customer email', () => {
    expect(event('products/update', { email: 'a@b.test' })).toBeNull();
    expect(event('orders/paid', { id: 1 })).toBeNull();
    expect(event('orders/create', { customer: { email: 'kari@kunde.test' } })?.identity).toEqual({ email: 'kari@kunde.test', verified: false });
  });
});
