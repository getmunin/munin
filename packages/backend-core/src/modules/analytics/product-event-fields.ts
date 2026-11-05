import { BadRequestException, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { eq, sql } from 'drizzle-orm';
import { schema, type Db, type Tx } from '@getmunin/db';
import { getCurrentContext } from '@getmunin/core';

export const PRODUCT_EVENT_FIELDS_SETTINGS_KEY = 'analytics.productEventFields';
export const PRODUCT_EVENT_FIELD_MAX_MAPPINGS = 20;
export const PRODUCT_EVENT_FIELD_MAX_VALUE_CHARS = 500;

const EVENT_NAME = /^[a-z0-9_.-]{1,64}$/;

export const ProductEventFieldMapping = z.object({
  property: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[A-Za-z0-9_.-]+$/, 'must be a top-level property name of letters, digits, _, . or -')
    .describe('Top-level key in the event\'s `properties`, e.g. "threllName".'),
  field: z
    .string()
    .regex(/^[a-z][a-z0-9_]{0,63}$/, 'must be snake_case: a lowercase letter, then lowercase letters, digits or _')
    .describe('Contact custom field to write, e.g. "threll_name".'),
  events: z
    .array(z.string().regex(EVENT_NAME, 'must be a product event name'))
    .min(1)
    .max(50)
    .optional()
    .describe('Only copy from these event names; leave out to copy from any event that carries the property.'),
});
export type ProductEventFieldMapping = z.infer<typeof ProductEventFieldMapping>;

export const ProductEventFieldsInput = z.object({
  mappings: z
    .array(ProductEventFieldMapping)
    .max(PRODUCT_EVENT_FIELD_MAX_MAPPINGS)
    .describe('The complete list of mappings; it replaces the current one. Pass [] to stop copying.'),
});
export type ProductEventFieldsInputValue = z.infer<typeof ProductEventFieldsInput>;

export interface ProductEventFieldsDto {
  mappings: ProductEventFieldMapping[];
  configured: boolean;
}

export function parseProductEventFields(settings: Record<string, unknown> | null | undefined): ProductEventFieldMapping[] {
  const raw = settings?.[PRODUCT_EVENT_FIELDS_SETTINGS_KEY];
  const parsed = ProductEventFieldsInput.safeParse(raw);
  return parsed.success ? parsed.data.mappings : [];
}

export async function readProductEventFields(db: Db | Tx, orgId: string): Promise<ProductEventFieldsDto> {
  const [row] = await db
    .select({ settings: schema.orgs.settings })
    .from(schema.orgs)
    .where(eq(schema.orgs.id, orgId))
    .limit(1);
  const settings = row?.settings ?? {};
  return {
    mappings: parseProductEventFields(settings),
    configured: PRODUCT_EVENT_FIELDS_SETTINGS_KEY in settings,
  };
}

export function mappingsForEvent(
  mappings: readonly ProductEventFieldMapping[],
  eventName: string,
  properties: Record<string, unknown>,
): { mapping: ProductEventFieldMapping; value: string }[] {
  const out: { mapping: ProductEventFieldMapping; value: string }[] = [];
  for (const mapping of mappings) {
    if (mapping.events && !mapping.events.includes(eventName)) continue;
    if (!Object.hasOwn(properties, mapping.property)) continue;
    const value = fieldValue(properties[mapping.property]);
    if (value !== null) out.push({ mapping, value });
  }
  return out;
}

function fieldValue(raw: unknown): string | null {
  let value: string;
  if (typeof raw === 'string') value = raw;
  else if (typeof raw === 'number' && Number.isFinite(raw)) value = String(raw);
  else if (typeof raw === 'boolean') value = String(raw);
  else return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, PRODUCT_EVENT_FIELD_MAX_VALUE_CHARS) : null;
}

@Injectable()
export class ProductEventFieldsService {
  async get(): Promise<ProductEventFieldsDto> {
    const ctx = getCurrentContext();
    return readProductEventFields(ctx.db, ctx.actor!.orgId);
  }

  async configure(input: ProductEventFieldsInputValue): Promise<ProductEventFieldsDto> {
    const ctx = getCurrentContext();
    const parsed = ProductEventFieldsInput.safeParse(input);
    if (!parsed.success) {
      throw new BadRequestException(
        `analytics_invalid: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`,
      );
    }
    const keys = parsed.data.mappings.map((m) => `${m.field} ${[...(m.events ?? ['*'])].sort().join(',')}`);
    if (new Set(keys).size !== keys.length) {
      throw new BadRequestException('analytics_invalid: the same field is mapped twice for the same events');
    }
    const value = { mappings: parsed.data.mappings };
    await ctx.db
      .update(schema.orgs)
      .set({
        settings: sql`${schema.orgs.settings} || ${JSON.stringify({ [PRODUCT_EVENT_FIELDS_SETTINGS_KEY]: value })}::jsonb`,
        updatedAt: new Date(),
      })
      .where(eq(schema.orgs.id, ctx.actor!.orgId));
    return { mappings: value.mappings, configured: true };
  }
}
