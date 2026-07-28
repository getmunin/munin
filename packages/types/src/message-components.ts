import { z } from 'zod';

export const MESSAGE_COMPONENT_MAX_ITEMS = 8;
export const MESSAGE_COMPONENTS_MAX = 2;

const HTTPS_URL_RE = /^https:\/\/[^\s/?#]+[^\s]*$/i;

const HttpsUrl = z
  .string()
  .min(1)
  .max(2048)
  .regex(HTTPS_URL_RE, 'must be an absolute https URL');

export const ProductListItemSchema = z.object({
  productRef: z.string().min(1).max(128),
  title: z.string().min(1).max(300),
  imageUrl: HttpsUrl.nullable(),
  url: HttpsUrl.nullable(),
  currency: z.string().min(1).max(8),
  priceMin: z.string().min(1).max(32).nullable(),
  priceMax: z.string().min(1).max(32).nullable(),
});

export const ComponentSourceSchema = z.object({
  connectionId: z.string().min(1).max(64),
  vendor: z.string().min(1).max(64),
  label: z.string().min(1).max(120),
});

export const ProductListComponentSchema = z.object({
  type: z.literal('product_list'),
  source: ComponentSourceSchema,
  items: z.array(ProductListItemSchema).min(1).max(MESSAGE_COMPONENT_MAX_ITEMS),
});

export const MessageComponentSchema = z.discriminatedUnion('type', [ProductListComponentSchema]);

export const MessageComponentsSchema = z
  .array(MessageComponentSchema)
  .min(1)
  .max(MESSAGE_COMPONENTS_MAX);

export type ProductListItem = z.infer<typeof ProductListItemSchema>;
export type ComponentSource = z.infer<typeof ComponentSourceSchema>;
export type ProductListComponent = z.infer<typeof ProductListComponentSchema>;
export type MessageComponent = z.infer<typeof MessageComponentSchema>;

export function parseMessageComponents(value: unknown): MessageComponent[] | null {
  const parsed = MessageComponentsSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
