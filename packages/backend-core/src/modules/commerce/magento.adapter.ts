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
  CommerceProductDetail,
  CommerceProductSummary,
  CommerceProductVariant,
} from './commerce-adapter.ts';
import { ConnectorVendorError, type ConnectorFetch, REQUEST_TIMEOUT_MS } from '../connectors/http.ts';
import { broadSearchLimit, rankByTokenCoverage } from './product-ranking.ts';

export const MagentoConfigInput = z.object({
  baseUrl: z
    .string()
    .trim()
    .url()
    .refine((u) => u.startsWith('https://'), 'baseUrl must be https')
    .transform((u) => u.replace(/\/+$/, '')),
  accessToken: z.string().min(10).max(256).optional(),
});

const StoredMagentoConfig = z.object({
  baseUrl: z.string(),
  encryptedAccessToken: z.string(),
});

interface MagentoOrderItem {
  name: string;
  sku: string | null;
  qty_ordered: number;
  parent_item_id?: number | null;
}

interface MagentoOrder {
  entity_id: number;
  increment_id: string;
  status: string;
  created_at: string;
  customer_email: string | null;
  grand_total: number;
  order_currency_code: string;
  total_qty_ordered: number;
  items?: MagentoOrderItem[];
}

interface MagentoSearchResult<T> {
  items: T[];
  total_count: number;
}

interface MagentoShipment {
  tracks?: Array<{ track_number: string | null; carrier_code: string | null; title: string | null }>;
}

interface MagentoProduct {
  id: number;
  sku: string;
  name: string;
  price?: number | null;
  status: number;
  type_id: string;
  custom_attributes?: Array<{ attribute_code: string; value: unknown }>;
}

interface MagentoStockItem {
  is_in_stock?: boolean;
}

const MAX_PRODUCT_VARIANTS = 50;

export class MagentoAdapter implements CommerceAdapter {
  readonly vendor = 'magento';
  readonly domain = 'commerce' as const;
  readonly displayName = 'Magento 2 / Adobe Commerce';
  readonly configInput = MagentoConfigInput;
  readonly configFields: ConnectorConfigFieldInfo[] = [
    {
      key: 'baseUrl',
      label: 'Store base URL (https, no /rest suffix)',
      required: true,
      placeholder: 'https://store.example.com',
    },
    {
      key: 'accessToken',
      label: 'Integration access token with Sales + Customers + Catalog read ACL',
      required: true,
      secret: true,
    },
  ];

  constructor(private readonly fetchImpl: ConnectorFetch = safeFetch) {}

  async buildStoredConfig(
    input: Record<string, unknown>,
    encryptSecret: (plaintext: string) => Promise<string>,
    previous?: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const parsed = MagentoConfigInput.parse(input);
    const prev = previous ? StoredMagentoConfig.safeParse(previous) : null;
    const encryptedAccessToken = parsed.accessToken
      ? await encryptSecret(parsed.accessToken)
      : prev?.success
        ? prev.data.encryptedAccessToken
        : null;
    if (!encryptedAccessToken) {
      throw new ConnectorVendorError('accessToken is required when creating a Magento connection');
    }
    return { baseUrl: parsed.baseUrl, encryptedAccessToken };
  }

  publicConfig(stored: Record<string, unknown>): Record<string, unknown> {
    const parsed = StoredMagentoConfig.parse(stored);
    return { baseUrl: parsed.baseUrl };
  }

  async testConnection(ctx: ConnectorConnectionContext): Promise<ConnectorTestResult> {
    const configs = await this.get<Array<{ code: string }>>(ctx, '/rest/V1/store/storeConfigs');
    return { ok: true, detail: `connected; ${configs.length} store view(s) visible` };
  }

  async listOrdersForCustomer(
    ctx: ConnectorConnectionContext,
    args: { email: string; limit: number },
  ): Promise<CommerceOrderSummary[]> {
    const result = await this.get<MagentoSearchResult<MagentoOrder>>(
      ctx,
      `/rest/V1/orders?${orderSearchParams(args.email, args.limit)}`,
    );
    return result.items
      .filter((order) => this.ownedBy(order, args.email))
      .map((order) => this.toSummary(order));
  }

  async getOrderForCustomer(
    ctx: ConnectorConnectionContext,
    args: { email: string; orderRef?: string; orderNumber?: string },
  ): Promise<CommerceOrderDetail | null> {
    const order = args.orderRef
      ? await this.orderById(ctx, args.orderRef)
      : args.orderNumber
        ? await this.orderByIncrementId(ctx, args.orderNumber)
        : null;
    if (!order || !this.ownedBy(order, args.email)) return null;
    const shipments = await this.shipmentsForOrder(ctx, order.entity_id);
    return this.toDetail(order, shipments);
  }

  async searchProducts(
    ctx: ConnectorConnectionContext,
    args: { query: string; limit: number },
  ): Promise<CommerceProductSummary[]> {
    const tokens = args.query.trim().split(/\s+/).filter(Boolean).slice(0, 8);
    if (!tokens.length) return [];
    const currency = await this.baseCurrency(ctx);
    const likes = tokens.map((t) => `%${t.replace(/([\\%_])/g, '\\$1')}%`);

    const all = await this.productSearch(ctx, currency, args.limit, (params) => {
      likes.forEach((like, index) => {
        setFilter(params, index, 'name', like, 'like', 0);
        setFilter(params, index, 'sku', like, 'like', 1);
      });
      return likes.length;
    });
    if (all.length > 0 || likes.length < 2) return all;

    const any = await this.productSearch(ctx, currency, broadSearchLimit(args.limit), (params) => {
      likes.forEach((like, index) => {
        setFilter(params, 0, 'name', like, 'like', index * 2);
        setFilter(params, 0, 'sku', like, 'like', index * 2 + 1);
      });
      return 1;
    });
    return rankByTokenCoverage(any, tokens).slice(0, args.limit);
  }

  private async productSearch(
    ctx: ConnectorConnectionContext,
    currency: string,
    limit: number,
    applyTermFilters: (params: URLSearchParams) => number,
  ): Promise<CommerceProductSummary[]> {
    const params = new URLSearchParams();
    const nextGroup = applyTermFilters(params);
    setFilter(params, nextGroup, 'status', '1', 'eq');
    setFilter(params, nextGroup + 1, 'visibility', '1', 'neq');
    params.set('searchCriteria[pageSize]', String(limit));
    const result = await this.get<MagentoSearchResult<MagentoProduct>>(
      ctx,
      `/rest/V1/products?${params.toString()}`,
    );
    return result.items.map((product) => this.toProductSummary(ctx, product, currency));
  }

  async getProduct(
    ctx: ConnectorConnectionContext,
    args: { productRef?: string; sku?: string },
  ): Promise<CommerceProductDetail | null> {
    const sku = (args.productRef ?? args.sku)?.trim();
    if (!sku) return null;
    let product: MagentoProduct;
    try {
      product = await this.get<MagentoProduct>(ctx, `/rest/V1/products/${encodeURIComponent(sku)}`);
    } catch (err) {
      if (err instanceof ConnectorVendorError && err.notFound) return null;
      throw err;
    }
    if (product.status !== 1) return null;
    const currency = await this.baseCurrency(ctx);
    const children =
      product.type_id === 'configurable' ? await this.configurableChildren(ctx, sku) : [product];
    const variants = await Promise.all(
      children.slice(0, MAX_PRODUCT_VARIANTS).map(
        async (child): Promise<CommerceProductVariant> => ({
          title: child.name,
          sku: child.sku,
          price: child.price != null ? child.price.toFixed(2) : null,
          availableForSale: await this.inStock(ctx, child.sku),
        }),
      ),
    );
    const summary = this.toProductSummary(ctx, product, currency);
    const prices = variants
      .map((variant) => variant.price)
      .filter((price): price is string => price !== null)
      .map(Number);
    return {
      ...summary,
      priceMin: prices.length ? Math.min(...prices).toFixed(2) : summary.priceMin,
      priceMax: prices.length ? Math.max(...prices).toFixed(2) : summary.priceMax,
      description: attributeValue(product, 'description'),
      variants,
    };
  }

  private async configurableChildren(
    ctx: ConnectorConnectionContext,
    sku: string,
  ): Promise<MagentoProduct[]> {
    try {
      return await this.get<MagentoProduct[]>(
        ctx,
        `/rest/V1/configurable-products/${encodeURIComponent(sku)}/children`,
      );
    } catch (err) {
      if (err instanceof ConnectorVendorError && err.notFound) return [];
      throw err;
    }
  }

  private async inStock(ctx: ConnectorConnectionContext, sku: string): Promise<boolean | null> {
    try {
      const item = await this.get<MagentoStockItem>(
        ctx,
        `/rest/V1/stockItems/${encodeURIComponent(sku)}`,
      );
      return typeof item.is_in_stock === 'boolean' ? item.is_in_stock : null;
    } catch {
      return null;
    }
  }

  private async baseCurrency(ctx: ConnectorConnectionContext): Promise<string> {
    const configs = await this.get<Array<{ base_currency_code?: string }>>(
      ctx,
      '/rest/V1/store/storeConfigs',
    );
    return configs[0]?.base_currency_code ?? '';
  }

  private toProductSummary(
    ctx: ConnectorConnectionContext,
    product: MagentoProduct,
    currency: string,
  ): CommerceProductSummary {
    const { baseUrl } = StoredMagentoConfig.parse(ctx.config);
    const image = attributeValue(product, 'image');
    const price = product.price != null ? product.price.toFixed(2) : null;
    return {
      productRef: product.sku,
      title: product.name,
      url: null,
      imageUrl: image
        ? `${baseUrl}/media/catalog/product${image.startsWith('/') ? '' : '/'}${image}`
        : null,
      currency,
      priceMin: price,
      priceMax: price,
    };
  }

  private async orderById(
    ctx: ConnectorConnectionContext,
    orderRef: string,
  ): Promise<MagentoOrder | null> {
    if (!/^\d+$/.test(orderRef)) return null;
    try {
      return await this.get<MagentoOrder>(ctx, `/rest/V1/orders/${orderRef}`);
    } catch (err) {
      if (err instanceof ConnectorVendorError && err.notFound) return null;
      throw err;
    }
  }

  private async orderByIncrementId(
    ctx: ConnectorConnectionContext,
    orderNumber: string,
  ): Promise<MagentoOrder | null> {
    const normalized = orderNumber.trim().replace(/^#/, '');
    if (!normalized) return null;
    const params = new URLSearchParams();
    setFilter(params, 0, 'increment_id', normalized, 'eq');
    params.set('searchCriteria[pageSize]', '1');
    const result = await this.get<MagentoSearchResult<MagentoOrder>>(
      ctx,
      `/rest/V1/orders?${params.toString()}`,
    );
    return result.items[0] ?? null;
  }

  private async shipmentsForOrder(
    ctx: ConnectorConnectionContext,
    orderId: number,
  ): Promise<MagentoShipment[]> {
    const params = new URLSearchParams();
    setFilter(params, 0, 'order_id', String(orderId), 'eq');
    const result = await this.get<MagentoSearchResult<MagentoShipment>>(
      ctx,
      `/rest/V1/shipments?${params.toString()}`,
    );
    return result.items;
  }

  private ownedBy(order: MagentoOrder, email: string): boolean {
    return !!order.customer_email && normalizeEmail(order.customer_email) === normalizeEmail(email);
  }

  private toSummary(order: MagentoOrder): CommerceOrderSummary {
    return {
      orderRef: String(order.entity_id),
      orderNumber: order.increment_id,
      status: order.status,
      financialStatus: null,
      fulfillmentStatus: null,
      currency: order.order_currency_code,
      total: order.grand_total.toFixed(2),
      itemCount: Math.round(order.total_qty_ordered),
      createdAt: magentoDateToIso(order.created_at),
    };
  }

  private toDetail(order: MagentoOrder, shipments: MagentoShipment[]): CommerceOrderDetail {
    return {
      ...this.toSummary(order),
      items: (order.items ?? [])
        .filter((item) => item.parent_item_id == null)
        .map((item) => ({
          title: item.name,
          quantity: Math.round(item.qty_ordered),
          sku: item.sku ?? null,
        })),
      shipments: shipments.map((shipment) => ({
        status: null,
        carrier:
          shipment.tracks?.map((t) => t.title ?? t.carrier_code).find((c) => !!c) ?? null,
        trackingNumbers: (shipment.tracks ?? [])
          .map((t) => t.track_number)
          .filter((n): n is string => !!n),
        trackingUrls: [],
      })),
    };
  }

  private async get<T>(ctx: ConnectorConnectionContext, path: string): Promise<T> {
    const config = StoredMagentoConfig.parse(ctx.config);
    const accessToken = await ctx.decryptSecret(config.encryptedAccessToken);
    const res = await this.fetchImpl(`${config.baseUrl}${path}`, {
      method: 'GET',
      headers: { authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (res.status === 401 || res.status === 403) {
      throw new ConnectorVendorError('magento rejected the access token (401/403)');
    }
    if (res.status === 404) {
      throw Object.assign(new ConnectorVendorError('magento resource not found'), {
        notFound: true,
      });
    }
    if (!res.ok) {
      throw new ConnectorVendorError(`magento request failed with HTTP ${res.status}`);
    }
    return (await res.json()) as T;
  }
}

function setFilter(
  params: URLSearchParams,
  group: number,
  field: string,
  value: string,
  conditionType: string,
  filter = 0,
): void {
  const prefix = `searchCriteria[filter_groups][${group}][filters][${filter}]`;
  params.set(`${prefix}[field]`, field);
  params.set(`${prefix}[value]`, value);
  params.set(`${prefix}[condition_type]`, conditionType);
}

function attributeValue(product: MagentoProduct, code: string): string | null {
  const value = product.custom_attributes?.find((a) => a.attribute_code === code)?.value;
  return typeof value === 'string' && value ? value : null;
}

function orderSearchParams(email: string, limit: number): string {
  const params = new URLSearchParams();
  setFilter(params, 0, 'customer_email', normalizeEmail(email), 'eq');
  params.set('searchCriteria[sortOrders][0][field]', 'created_at');
  params.set('searchCriteria[sortOrders][0][direction]', 'DESC');
  params.set('searchCriteria[pageSize]', String(limit));
  return params.toString();
}

function magentoDateToIso(value: string): string {
  return /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)
    ? `${value.replace(' ', 'T')}Z`
    : value;
}
