import { describe, it, expect } from 'vitest';
import {
  applyAssetExpansion,
  applyReferenceExpansion,
  buildInlineAssetSidecar,
  buildSearchText,
  collectAssetIds,
  extractAssetReferences,
  extractReferences,
  remapInlineAssetUris,
  rewriteInlineAssets,
  validateEntryData,
  type AssetSummary,
  type ExpandedEntry,
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

const blockFields: FieldDef[] = [
  {
    name: 'body',
    type: 'blocks',
    options: {
      blockTypes: [
        {
          name: 'callout',
          fields: [
            { name: 'text', type: 'markdown' },
            { name: 'icon', type: 'asset' },
          ],
        },
        {
          name: 'gallery',
          fields: [
            { name: 'images', type: 'array', options: { items: { name: 'i', type: 'asset' } } },
          ],
        },
        {
          name: 'product_card',
          fields: [{ name: 'product', type: 'reference', options: { targetCollection: 'products' } }],
        },
      ],
    },
  },
];

const blockData = {
  body: [
    { type: 'callout', key: 'b1', props: { text: 'see ![x](asset://cma_a)', icon: 'cma_b' } },
    { type: 'gallery', key: 'b2', props: { images: ['cma_b', 'cma_c'] } },
    { type: 'product_card', key: 'b3', props: { product: 'ent_1' } },
    { type: 'unknown_type', key: 'b4', props: { foo: 1 } },
  ],
};

const blockAssetMap = new Map<string, AssetSummary>([
  ['cma_a', { id: 'cma_a', publicUrl: 'https://cdn/a.png', altText: 'A', mime: 'image/png', sizeBytes: 1 }],
  ['cma_b', { id: 'cma_b', publicUrl: 'https://cdn/b.png', altText: null, mime: 'image/png', sizeBytes: 2 }],
]);

describe('blocks: validation', () => {
  it('accepts well-formed blocks of known types', () => {
    const data = { body: [{ type: 'callout', key: 'b1', props: { text: 'hi' } }] };
    expect(validateEntryData(blockFields, data)).toEqual([]);
  });

  it('rejects an unknown block type', () => {
    const data = { body: [{ type: 'nope', props: {} }] };
    const errs = validateEntryData(blockFields, data);
    expect(errs[0]?.message).toContain('unknown block type "nope"');
  });

  it('rejects a bad prop inside a block', () => {
    const data = { body: [{ type: 'callout', props: { icon: 123 } }] };
    const errs = validateEntryData(blockFields, data);
    expect(errs[0]?.message).toContain('icon');
  });

  it('rejects a non-array blocks value', () => {
    const errs = validateEntryData(blockFields, { body: { type: 'callout' } });
    expect(errs[0]?.message).toContain('expected array of blocks');
  });
});

describe('blocks: traversal helpers', () => {
  it('collectAssetIds recurses into block props (typed + inline)', () => {
    expect(collectAssetIds(blockFields, blockData).sort()).toEqual(['cma_a', 'cma_b', 'cma_b', 'cma_c']);
  });

  it('extractAssetReferences yields block refs with block index as position', () => {
    const refs = [...extractAssetReferences(blockFields, blockData)];
    expect(refs).toEqual([
      { fieldName: 'body', assetId: 'cma_a', position: 0, kind: 'inline' },
      { fieldName: 'body', assetId: 'cma_b', position: 0, kind: 'field' },
      { fieldName: 'body', assetId: 'cma_b', position: 1, kind: 'field' },
      { fieldName: 'body', assetId: 'cma_c', position: 1, kind: 'field' },
    ]);
  });

  it('extractReferences yields entry refs from block props', () => {
    expect([...extractReferences(blockFields, blockData)]).toEqual([
      { fieldName: 'body', toEntryId: 'ent_1', position: 2 },
    ]);
  });

  it('applyAssetExpansion expands typed asset props inside blocks', () => {
    const out = applyAssetExpansion(blockFields, blockData, blockAssetMap) as { body: Array<{ props: Record<string, unknown> }> };
    expect(out.body[0]?.props.icon).toMatchObject({ id: 'cma_b' });
    expect(out.body[1]?.props.images).toEqual([
      expect.objectContaining({ id: 'cma_b' }),
      null,
    ]);
    expect(out.body[3]).toMatchObject({ type: 'unknown_type' });
  });

  it('rewriteInlineAssets rewrites inline tokens in block prose', () => {
    const out = rewriteInlineAssets(blockFields, blockData, blockAssetMap) as { body: Array<{ props: Record<string, unknown> }> };
    expect(out.body[0]?.props.text).toBe('see ![x](https://cdn/a.png)');
  });

  it('buildInlineAssetSidecar collects inline assets from blocks', () => {
    const sidecar = buildInlineAssetSidecar(blockFields, blockData, blockAssetMap);
    expect(Object.keys(sidecar)).toEqual(['cma_a']);
  });

  it('buildSearchText indexes block prose (sentinels stripped)', () => {
    const text = buildSearchText(blockFields, blockData);
    expect(text).toContain('see');
    expect(text).not.toContain('asset://');
  });

  it('skips unknown block types without throwing', () => {
    expect(() => collectAssetIds(blockFields, blockData)).not.toThrow();
    const expanded = applyAssetExpansion(blockFields, { body: 'not-an-array' }, blockAssetMap);
    expect(expanded.body).toBe('not-an-array');
  });
});

describe('applyReferenceExpansion', () => {
  const entryMap = new Map<string, ExpandedEntry>([
    ['ent_1', { id: 'ent_1', slug: 'p1', collection: 'products', locale: 'en', data: { name: 'Widget' } }],
  ]);

  it('expands top-level and block reference fields one level; unknown -> null', () => {
    const fields: FieldDef[] = [{ name: 'author', type: 'reference' }, ...blockFields];
    const out = applyReferenceExpansion(
      fields,
      {
        author: 'ent_1',
        body: [
          { type: 'product_card', props: { product: 'ent_1' } },
          { type: 'product_card', props: { product: 'ent_x' } },
        ],
      },
      entryMap,
    ) as { author: unknown; body: Array<{ props: Record<string, unknown> }> };
    expect(out.author).toMatchObject({ id: 'ent_1', data: { name: 'Widget' } });
    expect(out.body[0]?.props.product).toMatchObject({ id: 'ent_1' });
    expect(out.body[1]?.props.product).toBeNull();
  });
});

describe('json misuse lint', () => {
  const jsonFields: FieldDef[] = [{ name: 'meta', type: 'json' }];

  it('rejects asset:// references nested anywhere in json', () => {
    const errs = validateEntryData(jsonFields, { meta: { nested: { url: 'asset://cma_a' } } });
    expect(errs[0]?.message).toContain('asset://');
  });

  it('rejects block-shaped arrays in json', () => {
    const errs = validateEntryData(jsonFields, { meta: [{ type: 'callout', props: {} }] });
    expect(errs[0]?.message).toContain('block-shaped');
  });

  it('allows genuinely opaque json', () => {
    expect(validateEntryData(jsonFields, { meta: { ok: true, list: [1, 2], type: 'invoice' } })).toEqual([]);
  });
});
