import { describe, it, expect } from 'vitest';
import {
  applyAssetExpansion,
  buildInlineAssetSidecar,
  buildSearchText,
  collectAssetIds,
  extractAssetReferences,
  remapInlineAssetUris,
  rewriteInlineAssets,
  type AssetSummary,
  type FieldDef,
} from './cms.fields.ts';

const fields: FieldDef[] = [
  { name: 'title', type: 'text' },
  { name: 'hero', type: 'asset' },
  { name: 'gallery', type: 'array', options: { items: { name: 'item', type: 'asset' } } },
  { name: 'tags', type: 'array', options: { items: { name: 'item', type: 'text' } } },
];

const bodyFields: FieldDef[] = [
  { name: 'title', type: 'text' },
  { name: 'hero', type: 'asset' },
  { name: 'body', type: 'markdown' },
];

const assetMap = new Map<string, AssetSummary>([
  [
    'cma_a',
    { id: 'cma_a', publicUrl: 'https://cdn/a.png', altText: 'A', mime: 'image/png', sizeBytes: 1 },
  ],
  [
    'cma_b',
    { id: 'cma_b', publicUrl: 'https://cdn/b.png', altText: null, mime: 'image/png', sizeBytes: 2 },
  ],
]);

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

  it('collects inline ids from markdown/rich_text bodies alongside fields', () => {
    const ids = collectAssetIds(bodyFields, {
      hero: 'cma_a',
      body: 'intro ![one](asset://cma_b) and ![two](asset://cma_c)',
    });
    expect(ids.sort()).toEqual(['cma_a', 'cma_b', 'cma_c']);
  });
});

describe('rewriteInlineAssets', () => {
  it('replaces known asset:// tokens with public urls and leaves unknown intact', () => {
    const out = rewriteInlineAssets(
      bodyFields,
      { body: '![a](asset://cma_a) then ![x](asset://cma_missing)' },
      assetMap,
    );
    expect(out.body).toBe('![a](https://cdn/a.png) then ![x](asset://cma_missing)');
  });

  it('does not touch typed asset fields', () => {
    const out = rewriteInlineAssets(bodyFields, { hero: 'cma_a' }, assetMap);
    expect(out.hero).toBe('cma_a');
  });
});

describe('buildInlineAssetSidecar', () => {
  it('maps only resolvable inline ids in body fields', () => {
    const sidecar = buildInlineAssetSidecar(
      bodyFields,
      { body: '![a](asset://cma_a) ![x](asset://cma_missing)', hero: 'cma_b' },
      assetMap,
    );
    expect(Object.keys(sidecar)).toEqual(['cma_a']);
    expect(sidecar.cma_a).toMatchObject({ id: 'cma_a', publicUrl: 'https://cdn/a.png' });
  });
});

describe('extractAssetReferences', () => {
  it('yields field, array, and inline references with kind', () => {
    const refs = [
      ...extractAssetReferences(
        [
          { name: 'hero', type: 'asset' },
          { name: 'gallery', type: 'array', options: { items: { name: 'item', type: 'asset' } } },
          { name: 'body', type: 'markdown' },
        ],
        {
          hero: 'cma_a',
          gallery: ['cma_b', 'cma_c'],
          body: 'x ![y](asset://cma_d)',
        },
      ),
    ];
    expect(refs).toEqual([
      { fieldName: 'hero', assetId: 'cma_a', position: 0, kind: 'field' },
      { fieldName: 'gallery', assetId: 'cma_b', position: 0, kind: 'field' },
      { fieldName: 'gallery', assetId: 'cma_c', position: 1, kind: 'field' },
      { fieldName: 'body', assetId: 'cma_d', position: 0, kind: 'inline' },
    ]);
  });
});

describe('remapInlineAssetUris', () => {
  it('rewrites ids present in the map, leaves others unchanged', () => {
    const out = remapInlineAssetUris(
      '![a](asset://old1) ![b](asset://old2)',
      (id) => (id === 'old1' ? 'new1' : id),
    );
    expect(out).toBe('![a](asset://new1) ![b](asset://old2)');
  });
});

describe('buildSearchText', () => {
  it('strips asset:// sentinels so ids do not pollute search text', () => {
    const text = buildSearchText(bodyFields, {
      title: 'Title',
      body: 'See ![diagram](asset://cma_a) here',
    });
    expect(text).not.toContain('asset://');
    expect(text).toContain('Title');
    expect(text).toContain('See');
    expect(text).toContain('diagram');
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
