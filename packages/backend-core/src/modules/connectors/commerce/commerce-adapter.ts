import type { ConnectorAdapter, ConnectorConnectionContext } from '../connector.ts';

/**
 * Commerce-domain connector contract (orders). Every order query takes the
 * customer's email and the adapter is responsible for enforcing ownership —
 * an order that does not belong to that email must come back as `null` /
 * excluded, never as data. The service layer resolves which email to use
 * (the calling end-user's, or an admin-supplied one) and never lets a
 * self-service caller choose it.
 */
export interface CommerceAdapter extends ConnectorAdapter {
  readonly domain: 'commerce';

  listOrdersForCustomer(
    ctx: ConnectorConnectionContext,
    args: { email: string; limit: number },
  ): Promise<CommerceOrderSummary[]>;

  /**
   * Fetch one order by adapter-native ref or human-facing order number,
   * returning `null` when it does not exist OR does not belong to `email`
   * (indistinguishable on purpose — no order-ref oracle).
   */
  getOrderForCustomer(
    ctx: ConnectorConnectionContext,
    args: { email: string; orderRef?: string; orderNumber?: string },
  ): Promise<CommerceOrderDetail | null>;
}

export interface CommerceOrderSummary {
  /** Adapter-native order id; pass back to commerce_get_my_order / commerce_lookup_order. */
  orderRef: string;
  /** Human-facing order number, e.g. Shopify "#1001" or Magento "000000123". */
  orderNumber: string;
  status: string;
  financialStatus: string | null;
  fulfillmentStatus: string | null;
  currency: string;
  total: string;
  itemCount: number;
  createdAt: string;
}

export interface CommerceOrderLineItem {
  title: string;
  quantity: number;
  sku: string | null;
}

export interface CommerceShipment {
  status: string | null;
  carrier: string | null;
  trackingNumbers: string[];
  trackingUrls: string[];
}

export interface CommerceOrderDetail extends CommerceOrderSummary {
  items: CommerceOrderLineItem[];
  shipments: CommerceShipment[];
}
