import {
  MESSAGE_COMPONENT_MAX_ITEMS,
  MessageComponentsSchema,
  type MessageComponent,
  type ProductListItem,
} from '@getmunin/types';
import type { McpToolResult, ToolCallTrace } from './types.ts';

const PRODUCT_SEARCH_TOOL = 'commerce_search_products';

export function deriveMessageComponents(
  toolCalls: ToolCallTrace[],
): MessageComponent[] | undefined {
  const call = lastSuccessfulCall(toolCalls, PRODUCT_SEARCH_TOOL);
  if (!call) return undefined;
  const payload = resultJson(call.result);
  if (!isRecord(payload)) return undefined;

  const connection = payload.connection;
  const products = payload.products;
  if (!isRecord(connection) || !Array.isArray(products) || products.length === 0) return undefined;
  if (typeof connection.id !== 'string' || typeof connection.vendor !== 'string') return undefined;

  const items: ProductListItem[] = [];
  const seen = new Set<string>();
  for (const raw of products) {
    if (items.length >= MESSAGE_COMPONENT_MAX_ITEMS) break;
    const item = toProductItem(raw);
    if (!item || seen.has(item.productRef)) continue;
    seen.add(item.productRef);
    items.push(item);
  }
  if (items.length === 0) return undefined;

  const candidate = [
    {
      type: 'product_list' as const,
      source: {
        connectionId: connection.id,
        vendor: connection.vendor,
        label: typeof connection.name === 'string' && connection.name ? connection.name : connection.vendor,
      },
      items,
    },
  ];
  const parsed = MessageComponentsSchema.safeParse(candidate);
  return parsed.success ? parsed.data : undefined;
}

function lastSuccessfulCall(toolCalls: ToolCallTrace[], name: string): ToolCallTrace | undefined {
  for (let i = toolCalls.length - 1; i >= 0; i -= 1) {
    const call = toolCalls[i];
    if (call && call.name === name && !call.result.isError) return call;
  }
  return undefined;
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

function resultJson(result: McpToolResult): unknown {
  for (const item of result.content) {
    if (item.type === 'text' && typeof item.text === 'string') {
      try {
        return JSON.parse(item.text);
      } catch {
        return null;
      }
    }
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
