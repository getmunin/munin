import { describe, it, expect } from 'vitest';
import {
  applyAssetExpansion,
  collectAssetIds,
  type AssetSummary,
  type FieldDef,
} from './cms.fields.ts';

const fields: FieldDef[] = [
  { name: 'title', type: 'text' },
  { name: 'hero', type: 'asset' },
  { name: 'gallery', type: 'array', options: { items: { name: 'item', type: 'asset' } } },
  { name: 'tags', type: 'array', options: { items: { name: 'item', type: 'text' } } },
];

describe('collectAssetIds', () => {
  it('collects ids from asset and array<asset> fields', () => {
    const ids = collectAssetIds(fields, {
      title: 'hi',
      hero: 'cma_a',
      gallery: ['cma_b', 'cma_c'],
      tags: ['x'],
    });
    expect(ids.sort()).toEqual(['cma_a', 'cma_b', 'cma_c']);
  });

  it('ignores null/undefined and non-asset arrays', () => {
    expect(collectAssetIds(fields, { hero: null, gallery: undefined, tags: ['a'] })).toEqual([]);
  });
});

describe('applyAssetExpansion', () => {
  const map = new Map<string, AssetSummary>([
    [
      'cma_a',
      { id: 'cma_a', publicUrl: 'https://cdn/a.png', altText: 'A', mime: 'image/png', sizeBytes: 1 },
    ],
    [
      'cma_b',
      { id: 'cma_b', publicUrl: 'https://cdn/b.png', altText: null, mime: 'image/png', sizeBytes: 2 },
    ],
  ]);

  it('replaces single asset id with summary; unknown id becomes null', () => {
    const out = applyAssetExpansion(fields, { hero: 'cma_a', gallery: [], tags: [] }, map);
    expect(out.hero).toMatchObject({ id: 'cma_a', publicUrl: 'https://cdn/a.png' });

    const miss = applyAssetExpansion(fields, { hero: 'cma_missing' }, map);
    expect(miss.hero).toBeNull();
  });

  it('replaces array<asset> values, mapping unknown ids to null entries', () => {
    const out = applyAssetExpansion(
      fields,
      { gallery: ['cma_a', 'cma_missing', 'cma_b'] },
      map,
    );
    expect(out.gallery).toEqual([
      expect.objectContaining({ id: 'cma_a' }),
      null,
      expect.objectContaining({ id: 'cma_b' }),
    ]);
  });

  it('leaves non-asset fields untouched', () => {
    const out = applyAssetExpansion(fields, { title: 'hi', tags: ['x', 'y'] }, map);
    expect(out).toMatchObject({ title: 'hi', tags: ['x', 'y'] });
  });
});
