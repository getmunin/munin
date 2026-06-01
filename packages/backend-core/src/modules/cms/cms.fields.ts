export const FIELD_TYPES = [
  'text',
  'rich_text',
  'markdown',
  'number',
  'integer',
  'boolean',
  'date',
  'datetime',
  'select',
  'multi_select',
  'asset',
  'reference',
  'array',
  'json',
] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

export interface FieldDef {
  name: string;
  type: FieldType;
  required?: boolean;
  localized?: boolean;
  description?: string;
  default?: unknown;
  options?: {
    choices?: string[];
    targetCollection?: string;
    items?: FieldDef;
  };
}

const SEARCH_TEXT_FIELD_TYPES = new Set<FieldType>(['text', 'rich_text', 'markdown']);

export interface ValidationError {
  field: string;
  message: string;
}

export function validateEntryData(
  fields: FieldDef[],
  data: Record<string, unknown>,
): ValidationError[] {
  const errors: ValidationError[] = [];
  for (const field of fields) {
    const value = data[field.name];
    const present = value !== undefined && value !== null;
    if (!present) {
      if (field.required) errors.push({ field: field.name, message: 'required' });
      continue;
    }
    const err = validateValue(field, value);
    if (err) errors.push({ field: field.name, message: err });
  }
  return errors;
}

function validateValue(field: FieldDef, value: unknown): string | null {
  switch (field.type) {
    case 'text':
    case 'rich_text':
    case 'markdown':
      return typeof value === 'string' ? null : 'expected string';
    case 'number':
      return typeof value === 'number' && Number.isFinite(value) ? null : 'expected number';
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value) ? null : 'expected integer';
    case 'boolean':
      return typeof value === 'boolean' ? null : 'expected boolean';
    case 'date':
      return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
        ? null
        : 'expected ISO date (YYYY-MM-DD)';
    case 'datetime':
      return typeof value === 'string' && !Number.isNaN(Date.parse(value))
        ? null
        : 'expected ISO 8601 datetime';
    case 'select': {
      const choices = field.options?.choices ?? [];
      if (typeof value !== 'string') return 'expected string';
      return choices.includes(value) ? null : `not in choices: ${choices.join(', ')}`;
    }
    case 'multi_select': {
      const choices = field.options?.choices ?? [];
      if (!Array.isArray(value)) return 'expected array';
      for (const v of value) {
        if (typeof v !== 'string' || !choices.includes(v)) {
          return `each value must be one of: ${choices.join(', ')}`;
        }
      }
      return null;
    }
    case 'asset':
      return typeof value === 'string' ? null : 'expected asset id (string)';
    case 'reference':
      return typeof value === 'string' ? null : 'expected reference id (string)';
    case 'array': {
      if (!Array.isArray(value)) return 'expected array';
      const inner = field.options?.items;
      if (!inner) return null;
      for (let i = 0; i < value.length; i++) {
        const err = validateValue({ ...inner, name: `${field.name}[${i}]` }, value[i]);
        if (err) return `[${i}]: ${err}`;
      }
      return null;
    }
    case 'json':
      return null;
    default:
      return null;
  }
}

export function projectData(
  fields: FieldDef[],
  data: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of fields) {
    out[field.name] = data[field.name] ?? field.default ?? null;
  }
  return out;
}

export function buildSearchText(
  fields: FieldDef[],
  data: Record<string, unknown>,
  override?: string[],
): string {
  const targets = new Set(override ?? []);
  const parts: string[] = [];
  for (const field of fields) {
    const include = override
      ? targets.has(field.name)
      : SEARCH_TEXT_FIELD_TYPES.has(field.type);
    if (!include) continue;
    const value = data[field.name];
    if (typeof value === 'string') parts.push(value);
    else if (Array.isArray(value)) {
      for (const v of value) if (typeof v === 'string') parts.push(v);
    }
  }
  return parts.join('\n\n');
}

export interface AssetSummary {
  id: string;
  publicUrl: string;
  altText: string | null;
  mime: string;
  sizeBytes: number;
}

export function collectAssetIds(
  fields: FieldDef[],
  data: Record<string, unknown>,
): string[] {
  const out: string[] = [];
  for (const field of fields) {
    const value = data[field.name];
    if (value === undefined || value === null) continue;
    if (field.type === 'asset' && typeof value === 'string') {
      out.push(value);
    } else if (
      field.type === 'array' &&
      field.options?.items?.type === 'asset' &&
      Array.isArray(value)
    ) {
      for (const v of value) if (typeof v === 'string') out.push(v);
    }
  }
  return out;
}

export function applyAssetExpansion(
  fields: FieldDef[],
  data: Record<string, unknown>,
  assets: Map<string, AssetSummary>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...data };
  for (const field of fields) {
    const value = out[field.name];
    if (value === undefined || value === null) continue;
    if (field.type === 'asset' && typeof value === 'string') {
      out[field.name] = assets.get(value) ?? null;
    } else if (
      field.type === 'array' &&
      field.options?.items?.type === 'asset' &&
      Array.isArray(value)
    ) {
      out[field.name] = value.map((v) =>
        typeof v === 'string' ? assets.get(v) ?? null : null,
      );
    }
  }
  return out;
}

export function* extractReferences(
  fields: FieldDef[],
  data: Record<string, unknown>,
): Generator<{ fieldName: string; toEntryId: string; position: number }> {
  for (const field of fields) {
    const value = data[field.name];
    if (value === undefined || value === null) continue;
    if (field.type === 'reference' && typeof value === 'string') {
      yield { fieldName: field.name, toEntryId: value, position: 0 };
    } else if (
      field.type === 'array' &&
      field.options?.items?.type === 'reference' &&
      Array.isArray(value)
    ) {
      let i = 0;
      for (const v of value) {
        if (typeof v === 'string') {
          yield { fieldName: field.name, toEntryId: v, position: i };
        }
        i++;
      }
    }
  }
}
