import type { ConnectorAdapter, ConnectorConnectionContext } from '../connectors/connector.ts';

export interface CommerceAdapter extends ConnectorAdapter {
  readonly domain: 'commerce';

  listOrdersForCustomer(
    ctx: ConnectorConnectionContext,
    args: { email: string; limit: number },
  ): Promise<CommerceOrderSummary[]>;

  getOrderForCustomer(
    ctx: ConnectorConnectionContext,
    args: { email: string; orderRef?: string; orderNumber?: string },
  ): Promise<CommerceOrderDetail | null>;
}

export interface CommerceOrderSummary {
  orderRef: string;
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
