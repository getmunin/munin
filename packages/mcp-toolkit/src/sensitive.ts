import type { z } from 'zod';
import { isSensitiveSchema } from '@getmunin/types';

const REDACTED = '[REDACTED]';

export function redactSensitive(schema: z.ZodType | undefined, value: unknown): unknown {
  if (!schema) return value;
  if (isSensitiveSchema(schema)) {
    return value === undefined ? undefined : REDACTED;
  }
  const inner = unwrap(schema);
  if (isSensitiveSchema(inner)) {
    return value === undefined ? undefined : REDACTED;
  }
  const def = (inner as { _zod?: { def?: ZodDef } })._zod?.def;
  if (!def) return value;
  switch (def.type) {
    case 'object': {
      if (value === null || typeof value !== 'object' || Array.isArray(value)) return value;
      const shape = (def as ZodObjectDef).shape;
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        const childSchema = shape[k];
        out[k] = childSchema ? redactSensitive(childSchema, v) : v;
      }
      return out;
    }
    case 'array': {
      if (!Array.isArray(value)) return value;
      const element = (def as ZodArrayDef).element;
      return value.map((v) => redactSensitive(element, v));
    }
    case 'union':
    case 'discriminated_union': {
      if (value === null || typeof value !== 'object') return value;
      const options = (def as ZodUnionDef).options ?? [];
      const variant = pickUnionVariant(options, value);
      return redactSensitive(variant ?? undefined, value);
    }
    case 'record': {
      if (value === null || typeof value !== 'object' || Array.isArray(value)) return value;
      const valueSchema = (def as ZodRecordDef).valueType;
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        out[k] = redactSensitive(valueSchema, v);
      }
      return out;
    }
    default:
      return value;
  }
}

interface ZodDef {
  type: string;
  innerType?: z.ZodType;
}
interface ZodObjectDef extends ZodDef {
  type: 'object';
  shape: Record<string, z.ZodType>;
}
interface ZodArrayDef extends ZodDef {
  type: 'array';
  element: z.ZodType;
}
interface ZodUnionDef extends ZodDef {
  type: 'union' | 'discriminated_union';
  options: z.ZodType[];
}
interface ZodRecordDef extends ZodDef {
  type: 'record';
  valueType: z.ZodType;
}

function unwrap(schema: z.ZodType): z.ZodType {
  let current = schema;
  for (let i = 0; i < 8; i++) {
    const def = (current as { _zod?: { def?: ZodDef } })._zod?.def;
    if (!def) return current;
    if (
      (def.type === 'optional' ||
        def.type === 'nullable' ||
        def.type === 'default' ||
        def.type === 'readonly' ||
        def.type === 'pipe' ||
        def.type === 'catch' ||
        def.type === 'transform' ||
        def.type === 'lazy') &&
      def.innerType
    ) {
      current = def.innerType;
      continue;
    }
    return current;
  }
  return current;
}

function pickUnionVariant(options: z.ZodType[], value: object): z.ZodType | null {
  for (const opt of options) {
    const result = opt.safeParse(value);
    if (result.success) return opt;
  }
  return null;
}
