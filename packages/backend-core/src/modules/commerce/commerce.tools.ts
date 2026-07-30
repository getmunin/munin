import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { McpTool } from '@getmunin/mcp-toolkit';
import { INSPECTOR_APP_URI } from '../../mcp/inspector.resource.ts';
import { CommerceService } from './commerce.service.ts';

const LookupOrdersInput = z.object({
  email: z.string().email(),
  connectionId: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(50).default(10),
});

const LookupOrderInput = z.object({
  email: z.string().email(),
  connectionId: z.string().min(1).optional(),
  orderRef: z.string().min(1).max(64).optional(),
  orderNumber: z.string().min(1).max(64).optional(),
});

const SearchProductsInput = z.object({
  query: z.string().trim().min(1).max(200),
  connectionId: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(25).default(10),
});

const GetProductInput = z.object({
  connectionId: z.string().min(1).optional(),
  productRef: z.string().min(1).max(64).optional(),
  sku: z.string().min(1).max(64).optional(),
});

@Injectable()
export class CommerceAdminTools {
  constructor(@Inject(CommerceService) private readonly commerce: CommerceService) {}

  @McpTool({
    name: 'commerce_list_customer_orders',
    title: 'Commerce: List a customer’s orders',
    description:
      'List a customer’s recent store orders by email (newest first), e.g. while handling their support conversation. `connectionId` is only needed when multiple commerce connections are active.',
    audiences: ['admin'],
    scopes: ['commerce:read'],
    input: LookupOrdersInput,
    readOnlyHint: true,
    destructiveHint: false,
  })
  lookupOrders(args: z.infer<typeof LookupOrdersInput>) {
    return this.commerce.lookupOrders(args);
  }

  @McpTool({
    name: 'commerce_lookup_order',
    title: 'Commerce: Look up one order with tracking',
    description:
      'Fetch one order for a customer email, including line items and shipment tracking. Identify the order by `orderRef` (from an order listing) or the human-facing `orderNumber` the customer knows. Returns not-found unless the order belongs to that email.',
    audiences: ['admin'],
    scopes: ['commerce:read'],
    input: LookupOrderInput,
    readOnlyHint: true,
    destructiveHint: false,
  })
  lookupOrder(args: z.infer<typeof LookupOrderInput>) {
    return this.commerce.lookupOrder(args);
  }

  @McpTool({
    name: 'commerce_search_products',
    title: 'Commerce: Search the product catalog',
    description:
      'Search the connected store’s live product catalog by name or SKU. Returns published products with price range, currency, image, and storefront link. Only published/enabled products are visible. `connectionId` is only needed when multiple commerce connections are active. In hosts that support MCP Apps this renders an inline product gallery.',
    audiences: ['admin', 'self_service'],
    scopes: ['commerce:read'],
    input: SearchProductsInput,
    readOnlyHint: true,
    destructiveHint: false,
    _meta: { ui: { resourceUri: INSPECTOR_APP_URI }, 'ui/resourceUri': INSPECTOR_APP_URI },
  })
  searchProducts(args: z.infer<typeof SearchProductsInput>) {
    return this.commerce.searchProducts(args);
  }

  @McpTool({
    name: 'commerce_get_product',
    title: 'Commerce: Get one product',
    description:
      'Fetch one published product from the connected store, including description and per-variant price and availability (`availableForSale`; null when the store doesn’t expose stock). Identify it by `productRef` (from a catalog search) or `sku`. Returns not-found for unpublished products.',
    audiences: ['admin', 'self_service'],
    scopes: ['commerce:read'],
    input: GetProductInput,
    readOnlyHint: true,
    destructiveHint: false,
  })
  getProduct(args: z.infer<typeof GetProductInput>) {
    return this.commerce.getProduct(args);
  }
}
