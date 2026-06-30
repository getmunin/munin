import {
  asBlock,
  blockTypeDef,
  type CmsBlockInstance,
  type CmsBlockTypeDef,
  type CmsFieldDef,
} from './types';

type EditableData = Record<string, unknown>;

const EMPTY_REVERSE = new Map<string, string>();
const INLINE_PROSE_TYPES = new Set<string>(['markdown', 'rich_text']);

export function computePatch(
  fields: CmsFieldDef[],
  initial: EditableData,
  edited: EditableData,
  inlineAssetReverse: Map<string, string>,
): EditableData {
  const patch: EditableData = {};
  for (const field of fields) {
    if (!fieldValuesEqual(field, initial[field.name], edited[field.name])) {
      patch[field.name] = serializeForPatch(field, edited[field.name], inlineAssetReverse);
    }
  }
  return patch;
}

export function fieldValuesEqual(field: CmsFieldDef, a: unknown, b: unknown): boolean {
  if (field.type === 'asset') return assetIdOf(a) === assetIdOf(b);
  if (field.type === 'blocks') {
    return deepEqual(
      serializeBlocksForPatch(field, a, EMPTY_REVERSE),
      serializeBlocksForPatch(field, b, EMPTY_REVERSE),
    );
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return false;
    return a.length === b.length && a.every((x, i) => x === b[i]);
  }
  if (a == null && b == null) return true;
  return a === b;
}

export function serializeForPatch(
  field: CmsFieldDef,
  value: unknown,
  inlineAssetReverse: Map<string, string>,
): unknown {
  if (value == null) return null;
  if (field.type === 'asset') return assetIdOf(value);
  if (field.type === 'blocks') return serializeBlocksForPatch(field, value, inlineAssetReverse);
  if (INLINE_PROSE_TYPES.has(field.type) && typeof value === 'string') {
    return reinlineAssets(value, inlineAssetReverse);
  }
  return value;
}

function serializeBlocksForPatch(
  field: CmsFieldDef,
  value: unknown,
  inlineAssetReverse: Map<string, string>,
): unknown {
  if (!Array.isArray(value)) return value ?? null;
  return (value as unknown[]).map((raw) => {
    const block = asBlock(raw);
    if (!block) return raw;
    const bt = blockTypeDef(field, block.type);
    if (!bt) return raw;
    const props: Record<string, unknown> = { ...block.props };
    for (const pf of bt.fields) {
      props[pf.name] = serializePropForPatch(pf, block.props[pf.name], inlineAssetReverse);
    }
    return {
      type: block.type,
      ...(block.key ? { key: block.key } : {}),
      props,
    };
  });
}

function serializePropForPatch(
  field: CmsFieldDef,
  value: unknown,
  inlineAssetReverse: Map<string, string>,
): unknown {
  if (value == null) return null;
  if (field.type === 'asset') return assetIdOf(value);
  if (field.type === 'array' && field.options?.items?.type === 'asset' && Array.isArray(value)) {
    return value.map((v) => assetIdOf(v));
  }
  if (INLINE_PROSE_TYPES.has(field.type) && typeof value === 'string') {
    return reinlineAssets(value, inlineAssetReverse);
  }
  return value;
}

export function reinlineAssets(value: string, reverse: Map<string, string>): string {
  if (reverse.size === 0) return value;
  let out = value;
  for (const [url, uri] of reverse) {
    if (out.includes(url)) out = out.split(url).join(uri);
  }
  return out;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null || b == null) return a === b;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((x, i) => deepEqual(x, b[i]));
  }
  if (typeof a === 'object' && typeof b === 'object') {
    const ak = Object.keys(a);
    const bk = Object.keys(b);
    if (ak.length !== bk.length) return false;
    return ak.every((k) =>
      deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
    );
  }
  return false;
}

export function assetIdOf(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'object') {
    const id = (value as Record<string, unknown>).id;
    return typeof id === 'string' ? id : null;
  }
  return null;
}

export function seedBlock(bt: CmsBlockTypeDef): CmsBlockInstance {
  const props: Record<string, unknown> = {};
  for (const pf of bt.fields) props[pf.name] = defaultForField(pf);
  return { type: bt.name, key: genBlockKey(), props };
}

function defaultForField(field: CmsFieldDef): unknown {
  if (field.default !== undefined) return field.default;
  switch (field.type) {
    case 'boolean':
      return false;
    case 'multi_select':
    case 'array':
      return [];
    case 'text':
    case 'rich_text':
    case 'markdown':
      return '';
    default:
      return null;
  }
}

function genBlockKey(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `block-${Math.random().toString(36).slice(2, 10)}`;
  }
}
