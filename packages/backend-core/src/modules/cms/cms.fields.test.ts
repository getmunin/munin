import { describe, it, expect, beforeEach } from 'vitest';
import {
  applyAssetExpansion,
  applyBlockEdits,
  applyReferenceExpansion,
  buildInlineAssetSidecar,
  buildReferenceSidecar,
  buildSearchText,
  collectAssetIds,
  collectInlineReferenceIds,
  extractAssetReferences,
  extractReferences,
  remapInlineAssetUris,
  replaceFieldText,
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
    { id: 'cma_a', publicUrl: 'https://cdn/a.png', altText: 'A', mime: 'image/png', sizeBytes: 1, width: null, height: null, variants: [] },
  ],
  [
    'cma_b',
    { id: 'cma_b', publicUrl: 'https://cdn/b.png', altText: null, mime: 'image/png', sizeBytes: 2, width: null, height: null, variants: [] },
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

  it('prefers the widest variant over the master when variants exist', () => {
    const withVariants = new Map<string, AssetSummary>([
      [
        'cma_a',
        {
          id: 'cma_a',
          publicUrl: 'https://cdn/a.png',
          altText: 'A',
          mime: 'image/png',
          sizeBytes: 2_282_751,
          width: 1536,
          height: 1024,
          variants: [
            {
              width: 640,
              height: 427,
              format: 'webp',
              storageKey: 'a-640w.webp',
              publicUrl: 'https://cdn/a-640w.webp',
              sizeBytes: 34_826,
            },
            {
              width: 1536,
              height: 1024,
              format: 'webp',
              storageKey: 'a-1536w.webp',
              publicUrl: 'https://cdn/a-1536w.webp',
              sizeBytes: 112_406,
            },
          ],
        },
      ],
    ]);
    const out = rewriteInlineAssets(bodyFields, { body: '![a](asset://cma_a)' }, withVariants);
    expect(out.body).toBe('![a](https://cdn/a-1536w.webp)');
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
      { id: 'cma_a', publicUrl: 'https://cdn/a.png', altText: 'A', mime: 'image/png', sizeBytes: 1, width: null, height: null, variants: [] },
    ],
    [
      'cma_b',
      { id: 'cma_b', publicUrl: 'https://cdn/b.png', altText: null, mime: 'image/png', sizeBytes: 2, width: null, height: null, variants: [] },
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
  ['cma_a', { id: 'cma_a', publicUrl: 'https://cdn/a.png', altText: 'A', mime: 'image/png', sizeBytes: 1, width: null, height: null, variants: [] }],
  ['cma_b', { id: 'cma_b', publicUrl: 'https://cdn/b.png', altText: null, mime: 'image/png', sizeBytes: 2, width: null, height: null, variants: [] }],
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

describe('inline ref:// tokens', () => {
  const proseFields: FieldDef[] = [
    { name: 'title', type: 'text' },
    { name: 'body', type: 'markdown' },
  ];
  const entryMap = new Map<string, ExpandedEntry>([
    ['ent_1', { id: 'ent_1', slug: 'pricing', collection: 'pages', locale: 'en', data: { title: 'Pricing' } }],
  ]);

  it('collectInlineReferenceIds finds ref:// ids in prose and blocks', () => {
    expect(
      collectInlineReferenceIds(proseFields, { body: 'see [pricing](ref://ent_1) and ref://ent_2' }).sort(),
    ).toEqual(['ent_1', 'ent_2']);
    expect(
      collectInlineReferenceIds(blockFields, {
        body: [{ type: 'callout', props: { text: 'x ref://ent_9' } }],
      }),
    ).toEqual(['ent_9']);
  });

  it('buildReferenceSidecar resolves only known inline ref ids', () => {
    const sidecar = buildReferenceSidecar(
      proseFields,
      { body: '[a](ref://ent_1) [b](ref://ent_missing)' },
      entryMap,
    );
    expect(Object.keys(sidecar)).toEqual(['ent_1']);
    expect(sidecar.ent_1).toMatchObject({ slug: 'pricing', collection: 'pages' });
  });

  it('inline ref tokens are left in place (not rewritten) — sidecar only', () => {
    const out = rewriteInlineAssets(proseFields, { body: 'ref://ent_1' }, new Map());
    expect(out.body).toBe('ref://ent_1');
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

describe('replaceFieldText', () => {
  const markdown: FieldDef = { name: 'body', type: 'markdown' };
  const tags: FieldDef = { name: 'tags', type: 'array', options: { items: { name: 'item', type: 'text' } } };

  it('replaces inside a top-level markdown string', () => {
    const result = replaceFieldText(markdown, 'Hello brave world', [
      { oldText: 'brave', newText: 'new' },
    ]);
    expect(result).toEqual({ ok: true, value: 'Hello new world', applied: 1 });
  });

  it('reaches prose inside block props and leaves the block shape intact', () => {
    const blocks = blockFields[0]!;
    const result = replaceFieldText(blocks, blockData.body, [
      { oldText: 'see ![x]', newText: 'look ![x]' },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const next = result.value as Array<{ type: string; key: string; props: Record<string, unknown> }>;
    expect(next[0]).toEqual({
      type: 'callout',
      key: 'b1',
      props: { text: 'look ![x](asset://cma_a)', icon: 'cma_b' },
    });
    expect(next.slice(1)).toEqual(blockData.body.slice(1));
    expect(blockData.body[0]!.props.text).toBe('see ![x](asset://cma_a)');
  });

  it('treats a match across two blocks as ambiguous unless replaceAll is set', () => {
    const blocks = blockFields[0]!;
    const twice = [
      { type: 'callout', key: 'a', props: { text: 'Munin is great' } },
      { type: 'callout', key: 'b', props: { text: 'Munin is fast' } },
    ];
    const strict = replaceFieldText(blocks, twice, [{ oldText: 'Munin', newText: 'It' }]);
    expect(strict).toEqual({
      ok: false,
      reason: 'replacement',
      failure: { index: 0, reason: 'ambiguous', matches: 2 },
    });
    const all = replaceFieldText(blocks, twice, [
      { oldText: 'Munin', newText: 'It', replaceAll: true },
    ]);
    expect(all.ok).toBe(true);
    if (!all.ok) return;
    const next = all.value as Array<{ props: { text: string } }>;
    expect(next.map((b) => b.props.text)).toEqual(['It is great', 'It is fast']);
  });

  it('never matches block type names, keys, or non-text props', () => {
    const blocks = blockFields[0]!;
    expect(replaceFieldText(blocks, blockData.body, [{ oldText: 'callout', newText: 'x' }])).toEqual({
      ok: false,
      reason: 'replacement',
      failure: { index: 0, reason: 'no_match', matches: 0 },
    });
    expect(replaceFieldText(blocks, blockData.body, [{ oldText: 'cma_b', newText: 'x' }])).toEqual({
      ok: false,
      reason: 'replacement',
      failure: { index: 0, reason: 'no_match', matches: 0 },
    });
  });

  it('edits items of an array<text> field', () => {
    const result = replaceFieldText(tags, ['alpha', 'beta'], [{ oldText: 'beta', newText: 'gamma' }]);
    expect(result).toEqual({ ok: true, value: ['alpha', 'gamma'], applied: 1 });
  });

  it('reports no_text for fields that hold no editable prose', () => {
    expect(replaceFieldText({ name: 'n', type: 'integer' }, 3, [{ oldText: '3', newText: '4' }])).toEqual({
      ok: false,
      reason: 'no_text',
    });
    expect(replaceFieldText(markdown, null, [{ oldText: 'a', newText: 'b' }])).toEqual({
      ok: false,
      reason: 'no_text',
    });
  });
});

describe('applyBlockEdits', () => {
  const sample = [
    { type: 'prose', key: 'a', props: { markdown: 'A' } },
    { type: 'prose', key: 'b', props: { markdown: 'B' } },
    { type: 'prose', key: 'c', props: { markdown: 'C' } },
  ];
  const keys = (result: ReturnType<typeof applyBlockEdits>) => {
    if (!result.ok) throw new Error(`expected ok, got ${result.failure.code}`);
    return (result.value as Array<{ key: string }>).map((b) => b.key);
  };
  let counter = 0;
  const newKey = () => `gen${(counter += 1)}`;

  beforeEach(() => {
    counter = 0;
  });

  it('set replaces an existing block in place, keeping its position', () => {
    const result = applyBlockEdits(
      sample,
      [{ op: 'set', key: 'b', block: { type: 'quote', props: { quote: 'New' } } }],
      newKey,
    );
    expect(keys(result)).toEqual(['a', 'b', 'c']);
    if (!result.ok) return;
    expect(result.value[1]).toEqual({ type: 'quote', key: 'b', props: { quote: 'New' } });
    expect(sample[1]).toEqual({ type: 'prose', key: 'b', props: { markdown: 'B' } });
  });

  it('set with an unknown key appends, and honours before/after/position when given', () => {
    const block = { type: 'prose', props: { markdown: 'D' } };
    expect(keys(applyBlockEdits(sample, [{ op: 'set', key: 'd', block }], newKey))).toEqual([
      'a',
      'b',
      'c',
      'd',
    ]);
    expect(
      keys(applyBlockEdits(sample, [{ op: 'set', key: 'd', block, after: 'a' }], newKey)),
    ).toEqual(['a', 'd', 'b', 'c']);
    expect(
      keys(applyBlockEdits(sample, [{ op: 'set', key: 'd', block, before: 'a' }], newKey)),
    ).toEqual(['d', 'a', 'b', 'c']);
    expect(
      keys(applyBlockEdits(sample, [{ op: 'set', key: 'd', block, position: 'start' }], newKey)),
    ).toEqual(['d', 'a', 'b', 'c']);
  });

  it('set without a key inserts under a generated key', () => {
    const result = applyBlockEdits(
      sample,
      [{ op: 'set', block: { type: 'prose', props: { markdown: 'D' } }, after: 'b' }],
      newKey,
    );
    expect(keys(result)).toEqual(['a', 'b', 'gen1', 'c']);
  });

  it('set on an existing key with a placement replaces and repositions it', () => {
    const result = applyBlockEdits(
      sample,
      [{ op: 'set', key: 'a', block: { type: 'prose', props: { markdown: 'A2' } }, position: 'end' }],
      newKey,
    );
    expect(keys(result)).toEqual(['b', 'c', 'a']);
    if (!result.ok) return;
    expect(result.value[2]).toEqual({ type: 'prose', key: 'a', props: { markdown: 'A2' } });
  });

  it('delete removes a block and move repositions one', () => {
    expect(keys(applyBlockEdits(sample, [{ op: 'delete', key: 'b' }], newKey))).toEqual(['a', 'c']);
    expect(
      keys(applyBlockEdits(sample, [{ op: 'move', key: 'a', after: 'c' }], newKey)),
    ).toEqual(['b', 'c', 'a']);
    expect(
      keys(applyBlockEdits(sample, [{ op: 'move', key: 'c', position: 'start' }], newKey)),
    ).toEqual(['c', 'a', 'b']);
  });

  it('applies edits in order, so a later edit sees an earlier insert', () => {
    const result = applyBlockEdits(
      sample,
      [
        { op: 'set', key: 'd', block: { type: 'prose', props: { markdown: 'D' } } },
        { op: 'move', key: 'd', position: 'start' },
        { op: 'delete', key: 'b' },
      ],
      newKey,
    );
    expect(keys(result)).toEqual(['d', 'a', 'c']);
  });

  it('starts from an empty list when the field has no value yet', () => {
    const result = applyBlockEdits(
      null,
      [{ op: 'set', key: 'first', block: { type: 'prose', props: { markdown: 'A' } } }],
      newKey,
    );
    expect(keys(result)).toEqual(['first']);
  });

  it('reports cms_block_not_found for an unknown target or anchor, naming the failing edit', () => {
    expect(applyBlockEdits(sample, [{ op: 'delete', key: 'zz' }], newKey)).toEqual({
      ok: false,
      failure: {
        index: 0,
        code: 'cms_block_not_found',
        message: 'no block with key "zz" to delete',
      },
    });
    const badAnchor = applyBlockEdits(
      sample,
      [
        { op: 'delete', key: 'a' },
        { op: 'move', key: 'b', after: 'zz' },
      ],
      newKey,
    );
    expect(badAnchor.ok).toBe(false);
    if (badAnchor.ok) return;
    expect(badAnchor.failure.index).toBe(1);
    expect(badAnchor.failure.code).toBe('cms_block_not_found');
    expect(badAnchor.failure.message).toContain('place a block after');
  });

  it('reports cms_block_ambiguous when two blocks share the addressed key', () => {
    const dupes = [
      { type: 'prose', key: 'a', props: { markdown: 'A' } },
      { type: 'prose', key: 'a', props: { markdown: 'A again' } },
    ];
    const result = applyBlockEdits(dupes, [{ op: 'delete', key: 'a' }], newKey);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.code).toBe('cms_block_ambiguous');
    expect(result.failure.message).toContain('2 blocks share the key "a"');
  });

  it('rejects malformed edits with cms_block_invalid', () => {
    const cases: Array<[Parameters<typeof applyBlockEdits>[1][number], string]> = [
      [{ op: 'delete' }, 'requires key'],
      [{ op: 'set', key: 'a' }, 'requires block'],
      [{ op: 'move', key: 'a' }, 'requires one of before, after or position'],
      [{ op: 'move', key: 'a', before: 'b', after: 'c' }, 'at most one of before, after and position'],
    ];
    for (const [edit, fragment] of cases) {
      const result = applyBlockEdits(sample, [edit], newKey);
      expect(result.ok).toBe(false);
      if (result.ok) continue;
      expect(result.failure.code).toBe('cms_block_invalid');
      expect(result.failure.message).toContain(fragment);
    }
    const notList = applyBlockEdits('nope', [{ op: 'delete', key: 'a' }], newKey);
    expect(notList.ok).toBe(false);
    if (notList.ok) return;
    expect(notList.failure.message).toContain('does not hold a list of blocks');
  });
});
