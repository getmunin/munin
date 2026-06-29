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
  'blocks',
  'json',
] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

export interface BlockTypeDef {
  name: string;
  label?: string;
  fields: FieldDef[];
}

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
    blockTypes?: BlockTypeDef[];
  };
}

const SEARCH_TEXT_FIELD_TYPES = new Set<FieldType>(['text', 'rich_text', 'markdown']);

const INLINE_ASSET_FIELD_TYPES = new Set<FieldType>(['rich_text', 'markdown']);

const ASSET_URI_PATTERN = /asset:\/\/([A-Za-z0-9_]+)/g;
const ASSET_URI_TEST = /asset:\/\/[A-Za-z0-9_]+/;

function inlineAssetIdsIn(value: unknown): string[] {
  if (typeof value !== 'string') return [];
  return [...value.matchAll(ASSET_URI_PATTERN)].map((m) => m[1]!);
}

export interface BlockInstance {
  type: string;
  key?: string;
  props: Record<string, unknown>;
}

export function asBlock(value: unknown): BlockInstance | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const type = (value as { type?: unknown }).type;
  if (typeof type !== 'string') return null;
  const key = (value as { key?: unknown }).key;
  const props = (value as { props?: unknown }).props;
  return {
    type,
    ...(typeof key === 'string' ? { key } : {}),
    props:
      props && typeof props === 'object' && !Array.isArray(props)
        ? (props as Record<string, unknown>)
        : {},
  };
}

function blockTypesOf(field: FieldDef): BlockTypeDef[] {
  return field.options?.blockTypes ?? [];
}

function resolveBlock(
  types: BlockTypeDef[],
  raw: unknown,
): { block: BlockInstance; blockType: BlockTypeDef } | null {
  const block = asBlock(raw);
  if (!block) return null;
  const blockType = types.find((t) => t.name === block.type);
  return blockType ? { block, blockType } : null;
}

function forEachBlock(
  field: FieldDef,
  value: unknown,
  fn: (blockFields: FieldDef[], props: Record<string, unknown>, index: number) => void,
): void {
  if (field.type !== 'blocks' || !Array.isArray(value)) return;
  const types = blockTypesOf(field);
  (value as unknown[]).forEach((raw, index) => {
    const resolved = resolveBlock(types, raw);
    if (resolved) fn(resolved.blockType.fields, resolved.block.props, index);
  });
}

function mapBlocks(
  field: FieldDef,
  value: unknown[],
  transformProps: (blockFields: FieldDef[], props: Record<string, unknown>) => Record<string, unknown>,
): unknown[] {
  const types = blockTypesOf(field);
  return value.map((raw) => {
    const resolved = resolveBlock(types, raw);
    if (!resolved) return raw;
    return {
      ...(raw as Record<string, unknown>),
      props: transformProps(resolved.blockType.fields, resolved.block.props),
    };
  });
}

function jsonContainsAssetUri(value: unknown): boolean {
  if (typeof value === 'string') return ASSET_URI_TEST.test(value);
  if (Array.isArray(value)) return value.some(jsonContainsAssetUri);
  if (value && typeof value === 'object') return Object.values(value).some(jsonContainsAssetUri);
  return false;
}

function jsonLooksLikeBlocks(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.some(
      (el) =>
        !!el &&
        typeof el === 'object' &&
        !Array.isArray(el) &&
        typeof (el as { type?: unknown }).type === 'string' &&
        typeof (el as { props?: unknown }).props === 'object' &&
        (el as { props?: unknown }).props !== null,
    )
  );
}

function stripInlineAssetUris(value: string): string {
  return value.replace(ASSET_URI_PATTERN, '');
}

export function remapInlineAssetUris(
  value: string,
  remap: (id: string) => string,
): string {
  return value.replace(ASSET_URI_PATTERN, (match, id: string) => {
    const next = remap(id);
    return next === id ? match : `asset://${next}`;
  });
}

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
    if (isFieldEmpty(value)) {
      if (field.required) errors.push({ field: field.name, message: 'required' });
      continue;
    }
    const err = validateValue(field, value);
    if (err) errors.push({ field: field.name, message: err });
  }
  return errors;
}

function isFieldEmpty(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === 'string' && value.length === 0) return true;
  if (Array.isArray(value) && value.length === 0) return true;
  return false;
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
    case 'blocks': {
      if (!Array.isArray(value)) return 'expected array of blocks';
      const types = blockTypesOf(field);
      const items = value as unknown[];
      for (let i = 0; i < items.length; i++) {
        const block = items[i];
        if (!block || typeof block !== 'object' || Array.isArray(block)) {
          return `[${i}]: expected a block object`;
        }
        const type = (block as { type?: unknown }).type;
        if (typeof type !== 'string') return `[${i}]: block is missing a string "type"`;
        const bt = types.find((t) => t.name === type);
        if (!bt) return `[${i}]: unknown block type "${type}"`;
        const rawProps = (block as { props?: unknown }).props;
        if (!rawProps || typeof rawProps !== 'object' || Array.isArray(rawProps)) {
          return `[${i}] (${type}): block "props" must be an object`;
        }
        const errs = validateEntryData(bt.fields, rawProps as Record<string, unknown>);
        if (errs.length > 0) {
          return `[${i}] (${type}): ${errs.map((e) => `${e.field}: ${e.message}`).join('; ')}`;
        }
      }
      return null;
    }
    case 'json':
      if (jsonContainsAssetUri(value)) {
        return 'json must not contain asset:// references — use a markdown, rich_text, or blocks field';
      }
      if (jsonLooksLikeBlocks(value)) {
        return 'json must not contain block-shaped data ({type, props}) — use a blocks field';
      }
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
    if (field.type === 'blocks') {
      const include = override ? targets.has(field.name) : true;
      if (include) {
        forEachBlock(field, data[field.name], (bf, props) => {
          const text = buildSearchText(bf, props);
          if (text) parts.push(text);
        });
      }
      continue;
    }
    const include = override
      ? targets.has(field.name)
      : SEARCH_TEXT_FIELD_TYPES.has(field.type);
    if (!include) continue;
    const value = data[field.name];
    if (typeof value === 'string') parts.push(stripInlineAssetUris(value));
    else if (Array.isArray(value)) {
      for (const v of value) if (typeof v === 'string') parts.push(stripInlineAssetUris(v));
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

export interface ExpandedEntry {
  id: string;
  slug: string;
  collection: string;
  locale: string;
  data: Record<string, unknown>;
}

export function collectReferenceIds(
  fields: FieldDef[],
  data: Record<string, unknown>,
): string[] {
  return [...extractReferences(fields, data)].map((r) => r.toEntryId);
}

export function applyReferenceExpansion(
  fields: FieldDef[],
  data: Record<string, unknown>,
  entries: Map<string, ExpandedEntry>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...data };
  for (const field of fields) {
    const value = out[field.name];
    if (value === undefined || value === null) continue;
    if (field.type === 'reference' && typeof value === 'string') {
      out[field.name] = entries.get(value) ?? null;
    } else if (
      field.type === 'array' &&
      field.options?.items?.type === 'reference' &&
      Array.isArray(value)
    ) {
      out[field.name] = value.map((v) =>
        typeof v === 'string' ? entries.get(v) ?? null : null,
      );
    } else if (field.type === 'blocks' && Array.isArray(value)) {
      out[field.name] = mapBlocks(field, value, (bf, props) =>
        applyReferenceExpansion(bf, props, entries),
      );
    }
  }
  return out;
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
    } else if (INLINE_ASSET_FIELD_TYPES.has(field.type)) {
      for (const id of inlineAssetIdsIn(value)) out.push(id);
    } else if (field.type === 'blocks') {
      forEachBlock(field, value, (bf, props) => {
        for (const id of collectAssetIds(bf, props)) out.push(id);
      });
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
    } else if (field.type === 'blocks' && Array.isArray(value)) {
      out[field.name] = mapBlocks(field, value, (bf, props) =>
        applyAssetExpansion(bf, props, assets),
      );
    }
  }
  return out;
}

export function rewriteInlineAssets(
  fields: FieldDef[],
  data: Record<string, unknown>,
  assets: Map<string, AssetSummary>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...data };
  for (const field of fields) {
    const value = out[field.name];
    if (INLINE_ASSET_FIELD_TYPES.has(field.type)) {
      if (typeof value !== 'string') continue;
      out[field.name] = value.replace(ASSET_URI_PATTERN, (match, id: string) => {
        const asset = assets.get(id);
        return asset ? asset.publicUrl : match;
      });
    } else if (field.type === 'blocks' && Array.isArray(value)) {
      out[field.name] = mapBlocks(field, value, (bf, props) =>
        rewriteInlineAssets(bf, props, assets),
      );
    }
  }
  return out;
}

export function buildInlineAssetSidecar(
  fields: FieldDef[],
  data: Record<string, unknown>,
  assets: Map<string, AssetSummary>,
): Record<string, AssetSummary> {
  const out: Record<string, AssetSummary> = {};
  for (const field of fields) {
    if (INLINE_ASSET_FIELD_TYPES.has(field.type)) {
      for (const id of inlineAssetIdsIn(data[field.name])) {
        const asset = assets.get(id);
        if (asset) out[id] = asset;
      }
    } else if (field.type === 'blocks') {
      forEachBlock(field, data[field.name], (bf, props) => {
        Object.assign(out, buildInlineAssetSidecar(bf, props, assets));
      });
    }
  }
  return out;
}

export function* extractAssetReferences(
  fields: FieldDef[],
  data: Record<string, unknown>,
): Generator<{
  fieldName: string;
  assetId: string;
  position: number;
  kind: 'field' | 'inline';
}> {
  for (const field of fields) {
    const value = data[field.name];
    if (value === undefined || value === null) continue;
    if (field.type === 'asset' && typeof value === 'string') {
      yield { fieldName: field.name, assetId: value, position: 0, kind: 'field' };
    } else if (
      field.type === 'array' &&
      field.options?.items?.type === 'asset' &&
      Array.isArray(value)
    ) {
      let i = 0;
      for (const v of value) {
        if (typeof v === 'string') {
          yield { fieldName: field.name, assetId: v, position: i, kind: 'field' };
        }
        i++;
      }
    } else if (INLINE_ASSET_FIELD_TYPES.has(field.type)) {
      let i = 0;
      for (const id of inlineAssetIdsIn(value)) {
        yield { fieldName: field.name, assetId: id, position: i, kind: 'inline' };
        i++;
      }
    } else if (field.type === 'blocks' && Array.isArray(value)) {
      const types = blockTypesOf(field);
      const blocks = value as unknown[];
      for (let index = 0; index < blocks.length; index++) {
        const resolved = resolveBlock(types, blocks[index]);
        if (!resolved) continue;
        for (const ref of extractAssetReferences(resolved.blockType.fields, resolved.block.props)) {
          yield { fieldName: field.name, assetId: ref.assetId, position: index, kind: ref.kind };
        }
      }
    }
  }
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
    } else if (field.type === 'blocks' && Array.isArray(value)) {
      const types = blockTypesOf(field);
      const blocks = value as unknown[];
      for (let index = 0; index < blocks.length; index++) {
        const resolved = resolveBlock(types, blocks[index]);
        if (!resolved) continue;
        for (const ref of extractReferences(resolved.blockType.fields, resolved.block.props)) {
          yield { fieldName: field.name, toEntryId: ref.toEntryId, position: index };
        }
      }
    }
  }
}
