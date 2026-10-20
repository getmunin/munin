import {
  MESSAGE_COMPONENT_MAX_ITEMS,
  MESSAGE_COMPONENTS_MAX,
  MessageComponentsSchema,
  type ComponentSource,
  type MessageComponent,
  type ProductListComponent,
  type ProductListItem,
} from '@getmunin/types';
import type { McpTool, McpToolHandle, McpToolResult, ToolCallTrace } from './types.ts';
import { isRecord, lastSuccessfulCall, resultJson } from './tool-result.ts';

export const SHOW_PRODUCTS_TOOL = 'show_products';

const CATALOG_TOOLS = new Set(['commerce_search_products', 'commerce_get_product']);

const SHOW_PRODUCTS_DEFINITION: McpTool = {
  name: SHOW_PRODUCTS_TOOL,
  description:
    'Show product cards (image, title, price, storefront link) under your reply. Cards appear only for the products you pass here — search results are never shown on their own. Pass the `productRef` of each product your reply is about, most relevant first; it must come from a commerce_search_products or commerce_get_product result earlier in this turn, so look a product up again if it was only mentioned in an earlier turn. Leave out products that merely matched the search words but are not what the customer asked about. Skip the tool when the reply is not about specific products.',
  inputSchema: {
    type: 'object',
    properties: {
      productRefs: {
        type: 'array',
        items: { type: 'string' },
        minItems: 1,
        maxItems: MESSAGE_COMPONENT_MAX_ITEMS,
        description: 'productRef values from this turn’s catalog results, most relevant first.',
      },
    },
    required: ['productRefs'],
    additionalProperties: false,
  },
};

interface CatalogEntry {
  source: ComponentSource;
  item: ProductListItem;
}

export function withProductCards(mcp: McpToolHandle): McpToolHandle {
  const catalogCalls: ToolCallTrace[] = [];
  return {
    async listTools() {
      const tools = await mcp.listTools();
      if (!tools.some((tool) => CATALOG_TOOLS.has(tool.name))) return tools;
      return [...tools.filter((tool) => tool.name !== SHOW_PRODUCTS_TOOL), SHOW_PRODUCTS_DEFINITION];
    },
    async callTool(name, args) {
      if (name === SHOW_PRODUCTS_TOOL) return showProductsResult(catalogCalls, args);
      const result = await mcp.callTool(name, args);
      if (CATALOG_TOOLS.has(name)) catalogCalls.push({ name, args, result });
      return result;
    },
  };
}

function showProductsResult(
  catalogCalls: ToolCallTrace[],
  args: Record<string, unknown>,
): McpToolResult {
  const catalog = collectCatalog(catalogCalls);
  const refs = requestedRefs(args);
  const shown = refs.filter((ref) => catalog.has(ref));
  const unknown = refs.filter((ref) => !catalog.has(ref));
  if (shown.length === 0) {
    return {
      isError: true,
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            error: 'no_matching_products',
            message:
              'None of these productRefs came from a commerce_search_products or commerce_get_product result in this turn. Look the product up first, then pass its productRef.',
            unknown,
          }),
        },
      ],
    };
  }
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          shown: shown.map((ref) => catalog.get(ref)!.item.title),
          ...(unknown.length > 0 ? { unknown } : {}),
        }),
      },
    ],
  };
}

export function deriveMessageComponents(
  toolCalls: ToolCallTrace[],
): MessageComponent[] | undefined {
  const call = lastSuccessfulCall(toolCalls, SHOW_PRODUCTS_TOOL);
  if (!call) return undefined;
  const catalog = collectCatalog(toolCalls.filter((c) => CATALOG_TOOLS.has(c.name)));

  const components: ProductListComponent[] = [];
  for (const ref of requestedRefs(call.args)) {
    const entry = catalog.get(ref);
    if (!entry) continue;
    let component = components.find((c) => c.source.connectionId === entry.source.connectionId);
    if (!component) {
      if (components.length >= MESSAGE_COMPONENTS_MAX) continue;
      component = { type: 'product_list', source: entry.source, items: [] };
      components.push(component);
    }
    if (component.items.length < MESSAGE_COMPONENT_MAX_ITEMS) component.items.push(entry.item);
  }
  if (components.length === 0) return undefined;

  const parsed = MessageComponentsSchema.safeParse(components);
  return parsed.success ? parsed.data : undefined;
}

function requestedRefs(args: Record<string, unknown>): string[] {
  const raw = args.productRefs;
  if (!Array.isArray(raw)) return [];
  const refs = raw.filter((ref): ref is string => typeof ref === 'string' && ref.length > 0);
  return [...new Set(refs)].slice(0, MESSAGE_COMPONENT_MAX_ITEMS);
}

function collectCatalog(calls: ToolCallTrace[]): Map<string, CatalogEntry> {
  const catalog = new Map<string, CatalogEntry>();
  for (const call of calls) {
    if (call.result.isError) continue;
    const payload = resultJson(call.result);
    if (!isRecord(payload)) continue;
    const source = toSource(payload.connection);
    if (!source) continue;
    const products = Array.isArray(payload.products) ? payload.products : [payload.product];
    for (const raw of products) {
      const item = toProductItem(raw);
      if (item) catalog.set(item.productRef, { source, item });
    }
  }
  return catalog;
}

function toSource(connection: unknown): ComponentSource | null {
  if (!isRecord(connection)) return null;
  if (typeof connection.id !== 'string' || typeof connection.vendor !== 'string') return null;
  return {
    connectionId: connection.id,
    vendor: connection.vendor,
    label: typeof connection.name === 'string' && connection.name ? connection.name : connection.vendor,
  };
}

function toProductItem(raw: unknown): ProductListItem | null {
  if (!isRecord(raw)) return null;
  const { productRef, title, currency } = raw;
  if (typeof productRef !== 'string' || !productRef) return null;
  if (typeof title !== 'string' || !title) return null;
  if (typeof currency !== 'string' || !currency) return null;
  return {
    productRef: productRef.slice(0, 128),
    title: title.slice(0, 300),
    imageUrl: httpsOrNull(raw.imageUrl),
    url: httpsOrNull(raw.url),
    currency: currency.slice(0, 8),
    priceMin: decimalOrNull(raw.priceMin),
    priceMax: decimalOrNull(raw.priceMax),
  };
}

function httpsOrNull(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > 2048) return null;
  try {
    return new URL(value).protocol === 'https:' ? value : null;
  } catch {
    return null;
  }
}

function decimalOrNull(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value !== 'string' || value.length === 0 || value.length > 32) return null;
  return Number.isFinite(Number(value)) ? value : null;
}
