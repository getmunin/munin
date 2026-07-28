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

  searchProducts(
    ctx: ConnectorConnectionContext,
    args: { query: string; limit: number },
  ): Promise<CommerceProductSummary[]>;

  getProduct(
    ctx: ConnectorConnectionContext,
    args: { productRef?: string; sku?: string },
  ): Promise<CommerceProductDetail | null>;
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

export interface CommerceProductSummary {
  productRef: string;
  title: string;
  url: string | null;
  imageUrl: string | null;
  currency: string;
  priceMin: string | null;
  priceMax: string | null;
}

export interface CommerceProductVariant {
  title: string;
  sku: string | null;
  price: string | null;
  availableForSale: boolean | null;
}

export interface CommerceProductDetail extends CommerceProductSummary {
  description: string | null;
  variants: CommerceProductVariant[];
}
