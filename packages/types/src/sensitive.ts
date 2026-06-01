import type { z } from 'zod';

const SENSITIVE_SCHEMAS = new WeakSet<object>();

export function sensitive<T extends z.ZodType>(schema: T): T {
  SENSITIVE_SCHEMAS.add(schema);
  return schema;
}

export function isSensitiveSchema(schema: unknown): boolean {
  return typeof schema === 'object' && schema !== null && SENSITIVE_SCHEMAS.has(schema);
}
