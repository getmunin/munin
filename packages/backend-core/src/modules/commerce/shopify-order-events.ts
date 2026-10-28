import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { ProductEventInput } from '../analytics/product-events.service.ts';

export const SHOPIFY_ORDER_TOPICS: Readonly<Record<string, string>> = {
  'orders/create': 'order.created',
  'orders/paid': 'order.paid',
  'orders/fulfilled': 'order.fulfilled',
  'orders/cancelled': 'order.cancelled',
};

export const SHOPIFY_EVENT_MAX_AGE_MS = 3 * 86_400_000;

export function verifyShopifyHmac(rawBody: Buffer, secret: string, header: string | undefined): boolean {
  if (!header) return false;
  const expected = createHmac('sha256', secret).update(rawBody).digest();
  let given: Buffer;
  try {
    given = Buffer.from(header, 'base64');
  } catch {
    return false;
  }
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export function shopifyOrderEvent(input: {
  topic: string;
  shopDomain: string;
  rawBody: Buffer;
  body: Record<string, unknown>;
  now?: Date;
}): ProductEventInput | null {
  const name = SHOPIFY_ORDER_TOPICS[input.topic];
  if (!name) return null;
  const { body } = input;
  const customerEmail = isRecord(body.customer) ? body.customer.email : undefined;
  const email = typeof body.email === 'string' && body.email ? body.email : typeof customerEmail === 'string' ? customerEmail : null;
  if (!email) return null;
  const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : typeof v === 'number' ? String(v) : null);
  const date = (v: unknown): string | null => {
    const text = str(v);
    return text && !Number.isNaN(Date.parse(text)) ? new Date(text).toISOString() : null;
  };
  const occurredAt =
    date(input.topic === 'orders/cancelled' ? body.cancelled_at : null) ??
    date(input.topic === 'orders/paid' ? body.processed_at : null) ??
    date(body.updated_at) ??
    date(body.created_at);
  const changedAt = date(body.updated_at) ?? date(body.created_at);
  if (changedAt && (input.now ?? new Date()).getTime() - Date.parse(changedAt) > SHOPIFY_EVENT_MAX_AGE_MS) return null;
  const customer = isRecord(body.customer) ? body.customer : null;
  const verified =
    customer?.verified_email === true && typeof customer.email === 'string' && customer.email.toLowerCase() === email.toLowerCase();
  const bodyHash = createHash('sha256').update(input.rawBody).digest('hex').slice(0, 40);
  const lineItems = Array.isArray(body.line_items) ? body.line_items.length : null;
  return {
    id: `shopify:${input.topic}:${bodyHash}`,
    name,
    ...(occurredAt ? { occurredAt } : {}),
    identity: { email, ...(verified ? {} : { verified: false }) },
    properties: {
      source: 'shopify',
      shop: input.shopDomain,
      orderId: str(body.id),
      orderNumber: str(body.name),
      totalPrice: str(body.total_price),
      currency: str(body.currency),
      financialStatus: str(body.financial_status),
      lineItemCount: lineItems,
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
