import { z } from 'zod';
import { safeFetch } from '@getmunin/core';
import type {
  ConnectorConfigFieldInfo,
  ConnectorConnectionContext,
  ConnectorTestResult,
} from '../connectors/connector.ts';
import { normalizeEmail } from '../connectors/connector.ts';
import type {
  CommerceAdapter,
  CommerceOrderDetail,
  CommerceOrderSummary,
} from './commerce-adapter.ts';
import { ConnectorVendorError, type ConnectorFetch, REQUEST_TIMEOUT_MS } from '../connectors/http.ts';

const DEFAULT_API_VERSION = '2025-01';
const SHOP_DOMAIN_RE = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;

export const ShopifyConfigInput = z.object({
  shopDomain: z
    .string()
    .trim()
    .toLowerCase()
    .regex(SHOP_DOMAIN_RE, 'expected a *.myshopify.com domain (no protocol, no path)'),
  /** Admin API access token (shpat_…). Optional on update to keep the stored one. */
  accessToken: z.string().min(10).max(256).optional(),
  apiVersion: z
    .string()
    .regex(/^\d{4}-\d{2}$/)
    .default(DEFAULT_API_VERSION),
});

const StoredShopifyConfig = z.object({
  shopDomain: z.string(),
  apiVersion: z.string(),
  encryptedAccessToken: z.string(),
});

type StoredConfig = z.infer<typeof StoredShopifyConfig>;

interface ShopifyMoney {
  amount: string;
  currencyCode: string;
}

interface ShopifyOrderNode {
  id: string;
  name: string;
  createdAt: string;
  cancelledAt: string | null;
  closedAt: string | null;
  displayFinancialStatus: string | null;
  displayFulfillmentStatus: string | null;
  subtotalLineItemsQuantity: number;
  currentTotalPriceSet: { shopMoney: ShopifyMoney };
  customer: { id: string; email: string | null } | null;
  lineItems?: { nodes: Array<{ title: string; quantity: number; sku: string | null }> };
  fulfillments?: Array<{
    displayStatus: string | null;
    trackingInfo: Array<{ company: string | null; number: string | null; url: string | null }>;
  }>;
}

const ORDER_SUMMARY_FIELDS = `
  id
  name
  createdAt
  cancelledAt
  closedAt
  displayFinancialStatus
  displayFulfillmentStatus
  subtotalLineItemsQuantity
  currentTotalPriceSet { shopMoney { amount currencyCode } }
  customer { id email }
`;

const ORDER_DETAIL_FIELDS = `
  ${ORDER_SUMMARY_FIELDS}
  lineItems(first: 100) { nodes { title quantity sku } }
  fulfillments { displayStatus trackingInfo { company number url } }
`;

export class ShopifyAdapter implements CommerceAdapter {
  readonly vendor = 'shopify';
  readonly domain = 'commerce' as const;
  readonly displayName = 'Shopify';
  readonly configInput = ShopifyConfigInput;
  readonly configFields: ConnectorConfigFieldInfo[] = [
    {
      key: 'shopDomain',
      label: 'Shop domain (your-store.myshopify.com)',
      required: true,
      placeholder: 'your-store.myshopify.com',
    },
    {
      key: 'accessToken',
      label: 'Admin API access token (shpat_…) with read_orders + read_customers',
      required: true,
      secret: true,
    },
    {
      key: 'apiVersion',
      label: `Admin API version (default ${DEFAULT_API_VERSION})`,
      required: false,
    },
  ];

  constructor(private readonly fetchImpl: ConnectorFetch = safeFetch) {}

  async buildStoredConfig(
    input: Record<string, unknown>,
    encryptSecret: (plaintext: string) => Promise<string>,
    previous?: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const parsed = ShopifyConfigInput.parse(input);
    const prev = previous ? StoredShopifyConfig.safeParse(previous) : null;
    const encryptedAccessToken = parsed.accessToken
      ? await encryptSecret(parsed.accessToken)
      : prev?.success
        ? prev.data.encryptedAccessToken
        : null;
    if (!encryptedAccessToken) {
      throw new ConnectorVendorError('accessToken is required when creating a Shopify connection');
    }
    return {
      shopDomain: parsed.shopDomain,
      apiVersion: parsed.apiVersion,
      encryptedAccessToken,
    } satisfies StoredConfig;
  }

  publicConfig(stored: Record<string, unknown>): Record<string, unknown> {
    const parsed = StoredShopifyConfig.parse(stored);
    return { shopDomain: parsed.shopDomain, apiVersion: parsed.apiVersion };
  }

  async testConnection(ctx: ConnectorConnectionContext): Promise<ConnectorTestResult> {
    const data = await this.graphql<{ shop: { name: string; myshopifyDomain: string } }>(
      ctx,
      `query { shop { name myshopifyDomain } }`,
      {},
    );
    return { ok: true, detail: `connected to ${data.shop.name} (${data.shop.myshopifyDomain})` };
  }

  async listOrdersForCustomer(
    ctx: ConnectorConnectionContext,
    args: { email: string; limit: number },
  ): Promise<CommerceOrderSummary[]> {
    const customerId = await this.findCustomerId(ctx, args.email);
    if (!customerId) return [];
    const data = await this.graphql<{ orders: { nodes: ShopifyOrderNode[] } }>(
      ctx,
      `query ($q: String!, $n: Int!) {
        orders(first: $n, reverse: true, query: $q) { nodes { ${ORDER_SUMMARY_FIELDS} } }
      }`,
      { q: `customer_id:${customerId}`, n: args.limit },
    );
    return data.orders.nodes
      .filter((node) => this.ownedBy(node, args.email))
      .map((node) => this.toSummary(node));
  }

  async getOrderForCustomer(
    ctx: ConnectorConnectionContext,
    args: { email: string; orderRef?: string; orderNumber?: string },
  ): Promise<CommerceOrderDetail | null> {
    const node = args.orderRef
      ? await this.orderById(ctx, args.orderRef)
      : args.orderNumber
        ? await this.orderByNumber(ctx, args.orderNumber)
        : null;
    if (!node || !this.ownedBy(node, args.email)) return null;
    return this.toDetail(node);
  }

  private async orderById(
    ctx: ConnectorConnectionContext,
    orderRef: string,
  ): Promise<ShopifyOrderNode | null> {
    if (!/^\d+$/.test(orderRef)) return null;
    const data = await this.graphql<{ order: ShopifyOrderNode | null }>(
      ctx,
      `query ($id: ID!) { order(id: $id) { ${ORDER_DETAIL_FIELDS} } }`,
      { id: `gid://shopify/Order/${orderRef}` },
    );
    return data.order;
  }

  private async orderByNumber(
    ctx: ConnectorConnectionContext,
    orderNumber: string,
  ): Promise<ShopifyOrderNode | null> {
    const normalized = orderNumber.trim().replace(/^#/, '');
    if (!normalized) return null;
    const data = await this.graphql<{ orders: { nodes: ShopifyOrderNode[] } }>(
      ctx,
      `query ($q: String!) { orders(first: 5, query: $q) { nodes { ${ORDER_DETAIL_FIELDS} } } }`,
      { q: `name:${searchTerm(normalized)}` },
    );
    return (
      data.orders.nodes.find((node) => node.name.replace(/^#/, '') === normalized) ?? null
    );
  }

  private async findCustomerId(
    ctx: ConnectorConnectionContext,
    email: string,
  ): Promise<string | null> {
    const normalized = normalizeEmail(email);
    const data = await this.graphql<{
      customers: { nodes: Array<{ id: string; email: string | null }> };
    }>(
      ctx,
      `query ($q: String!) { customers(first: 5, query: $q) { nodes { id email } } }`,
      { q: `email:${searchTerm(normalized)}` },
    );
    const match = data.customers.nodes.find(
      (c) => c.email && normalizeEmail(c.email) === normalized,
    );
    if (!match) return null;
    return numericGid(match.id);
  }

  private ownedBy(node: ShopifyOrderNode, email: string): boolean {
    return !!node.customer?.email && normalizeEmail(node.customer.email) === normalizeEmail(email);
  }

  private toSummary(node: ShopifyOrderNode): CommerceOrderSummary {
    const money = node.currentTotalPriceSet.shopMoney;
    return {
      orderRef: numericGid(node.id) ?? node.id,
      orderNumber: node.name,
      status: node.cancelledAt ? 'cancelled' : node.closedAt ? 'closed' : 'open',
      financialStatus: node.displayFinancialStatus?.toLowerCase() ?? null,
      fulfillmentStatus: node.displayFulfillmentStatus?.toLowerCase() ?? null,
      currency: money.currencyCode,
      total: money.amount,
      itemCount: node.subtotalLineItemsQuantity,
      createdAt: node.createdAt,
    };
  }

  private toDetail(node: ShopifyOrderNode): CommerceOrderDetail {
    return {
      ...this.toSummary(node),
      items: (node.lineItems?.nodes ?? []).map((item) => ({
        title: item.title,
        quantity: item.quantity,
        sku: item.sku ?? null,
      })),
      shipments: (node.fulfillments ?? []).map((f) => ({
        status: f.displayStatus?.toLowerCase() ?? null,
        carrier: f.trackingInfo.find((t) => t.company)?.company ?? null,
        trackingNumbers: f.trackingInfo.map((t) => t.number).filter((n): n is string => !!n),
        trackingUrls: f.trackingInfo.map((t) => t.url).filter((u): u is string => !!u),
      })),
    };
  }

  private async graphql<T>(
    ctx: ConnectorConnectionContext,
    query: string,
    variables: Record<string, unknown>,
  ): Promise<T> {
    const config = StoredShopifyConfig.parse(ctx.config);
    const accessToken = await ctx.decryptSecret(config.encryptedAccessToken);
    const url = `https://${config.shopDomain}/admin/api/${config.apiVersion}/graphql.json`;
    const res = await this.fetchImpl(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-shopify-access-token': accessToken,
      },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (res.status === 401 || res.status === 403) {
      throw new ConnectorVendorError('shopify rejected the access token (401/403)');
    }
    if (!res.ok) {
      throw new ConnectorVendorError(`shopify request failed with HTTP ${res.status}`);
    }
    const body = (await res.json()) as { data?: T; errors?: Array<{ message: string }> };
    if (body.errors?.length) {
      throw new ConnectorVendorError(`shopify graphql error: ${body.errors[0]!.message}`);
    }
    if (!body.data) {
      throw new ConnectorVendorError('shopify graphql returned no data');
    }
    return body.data;
  }
}

function numericGid(gid: string): string | null {
  const match = /\/(\d+)$/.exec(gid);
  return match ? match[1]! : null;
}

/** Quote a value for the Shopify search query syntax. */
function searchTerm(value: string): string {
  return `"${value.replace(/(["\\])/g, '\\$1')}"`;
}
