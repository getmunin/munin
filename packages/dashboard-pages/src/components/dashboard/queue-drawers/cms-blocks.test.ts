import { describe, expect, it } from 'vitest';
import {
  computePatch,
  defaultForField,
  fieldValuesEqual,
  reinlineAssets,
  seedBlock,
  serializeForPatch,
} from './cms-blocks';
import type { CmsBlockTypeDef, CmsFieldDef } from './types';

interface SBlock {
  type: string;
  key?: string;
  props: Record<string, unknown>;
}

const CALLOUT: CmsBlockTypeDef = {
  name: 'callout',
  label: 'Callout',
  fields: [
    { name: 'text', type: 'markdown' },
    { name: 'icon', type: 'asset' },
  ],
};

const HEADING: CmsBlockTypeDef = {
  name: 'heading',
  fields: [{ name: 'text', type: 'text' }],
};

const bodyField: CmsFieldDef = {
  name: 'body',
  type: 'blocks',
  options: { blockTypes: [CALLOUT, HEADING] },
};

// Mirrors the sidecar the draft API returns: asset id → public URL,
// reversed here to public URL → asset:// URI for save serialization.
const reverse = new Map<string, string>([
  ['https://cdn.example.com/logo.png', 'asset://asset_logo'],
  ['https://cdn.example.com/icon.png', 'asset://asset_1'],
]);

// How the drawer receives a blocks body: asset props expanded to objects,
// inline asset:// rewritten to public URLs.
function loadedBlocks(): SBlock[] {
  return [
    {
      type: 'callout',
      key: 'c1',
      props: {
        text: 'See ![logo](https://cdn.example.com/logo.png)',
        icon: { id: 'asset_1', publicUrl: 'https://cdn.example.com/icon.png', altText: null },
      },
    },
    { type: 'heading', key: 'h1', props: { text: 'Intro' } },
  ];
}

describe('serializeForPatch (blocks)', () => {
  it('converts expanded asset props back to ids', () => {
    const out = serializeForPatch(bodyField, loadedBlocks(), reverse) as SBlock[];
    expect(out[0]?.props.icon).toBe('asset_1');
    expect(out[0]?.key).toBe('c1');
  });

  it('re-inlines public URLs back to asset:// in prose props', () => {
    const out = serializeForPatch(bodyField, loadedBlocks(), reverse) as SBlock[];
    expect(out[0]?.props.text).toBe('See ![logo](asset://asset_logo)');
  });

  it('leaves non-asset scalar props untouched', () => {
    const out = serializeForPatch(bodyField, loadedBlocks(), reverse) as SBlock[];
    expect(out[1]?.props.text).toBe('Intro');
  });

  it('passes unknown block types through verbatim', () => {
    const out = serializeForPatch(
      bodyField,
      [{ type: 'mystery', props: { foo: 1 } }],
      reverse,
    ) as SBlock[];
    expect(out[0]).toEqual({ type: 'mystery', props: { foo: 1 } });
  });

  it('serializes a replaced asset prop to its new id', () => {
    const edited = loadedBlocks();
    edited[0]!.props.icon = { id: 'asset_2', publicUrl: 'x', altText: null };
    const out = serializeForPatch(bodyField, edited, reverse) as SBlock[];
    expect(out[0]?.props.icon).toBe('asset_2');
  });
});

describe('serializeForPatch (top-level fields)', () => {
  it('converts an asset field to its id', () => {
    const field: CmsFieldDef = { name: 'cover', type: 'asset' };
    expect(serializeForPatch(field, { id: 'a1', publicUrl: 'x' }, reverse)).toBe('a1');
  });

  it('re-inlines public URLs in a markdown field', () => {
    const field: CmsFieldDef = { name: 'intro', type: 'markdown' };
    expect(serializeForPatch(field, 'see https://cdn.example.com/logo.png', reverse)).toBe(
      'see asset://asset_logo',
    );
  });
});

describe('serializeForPatch (array fields)', () => {
  const textList: CmsFieldDef = {
    name: 'items',
    type: 'array',
    options: { items: { name: 'item', type: 'text' } },
  };
  const assetList: CmsFieldDef = {
    name: 'gallery',
    type: 'array',
    options: { items: { name: 'item', type: 'asset' } },
  };

  it('leaves a string array untouched', () => {
    const value = ['~44x | price jump', '~$3,000 | onboarding fee'];
    expect(serializeForPatch(textList, value, reverse)).toEqual(value);
  });

  it('converts an expanded asset array back to ids', () => {
    const value = [
      { id: 'asset_1', publicUrl: 'https://cdn.example.com/icon.png', altText: null },
      'asset_2',
    ];
    expect(serializeForPatch(assetList, value, reverse)).toEqual(['asset_1', 'asset_2']);
  });

  it('serializes a null array field to null', () => {
    expect(serializeForPatch(textList, null, reverse)).toBeNull();
  });
});

describe('fieldValuesEqual (array fields)', () => {
  const textList: CmsFieldDef = {
    name: 'items',
    type: 'array',
    options: { items: { name: 'item', type: 'text' } },
  };

  it('treats an unchanged string array as equal', () => {
    expect(fieldValuesEqual(textList, ['a', 'b'], ['a', 'b'])).toBe(true);
  });

  it('detects an edited item', () => {
    expect(fieldValuesEqual(textList, ['a', 'b'], ['a', 'B'])).toBe(false);
  });

  it('detects an added item', () => {
    expect(fieldValuesEqual(textList, ['a'], ['a', 'b'])).toBe(false);
  });

  it('detects a reordered array', () => {
    expect(fieldValuesEqual(textList, ['a', 'b'], ['b', 'a'])).toBe(false);
  });
});

describe('computePatch (array + multi_select)', () => {
  const fields: CmsFieldDef[] = [
    { name: 'items', type: 'array', options: { items: { name: 'item', type: 'text' } } },
    { name: 'tags', type: 'multi_select', options: { choices: ['a', 'b', 'c'] } },
  ];

  it('omits array + multi_select fields when unchanged', () => {
    const data = { items: ['x'], tags: ['a'] };
    expect(computePatch(fields, data, { items: ['x'], tags: ['a'] }, reverse)).toEqual({});
  });

  it('sends an edited string array verbatim', () => {
    const patch = computePatch(fields, { items: ['x'], tags: ['a'] }, { items: ['x', 'y'], tags: ['a'] }, reverse);
    expect(patch).toEqual({ items: ['x', 'y'] });
  });

  it('sends an edited multi_select selection', () => {
    const patch = computePatch(fields, { items: ['x'], tags: ['a'] }, { items: ['x'], tags: ['a', 'c'] }, reverse);
    expect(patch).toEqual({ tags: ['a', 'c'] });
  });
});

describe('defaultForField (list item seeds)', () => {
  it('seeds an empty string for a text item', () => {
    expect(defaultForField({ name: 'item', type: 'text' })).toBe('');
  });

  it('seeds null for an asset item', () => {
    expect(defaultForField({ name: 'item', type: 'asset' })).toBeNull();
  });

  it('seeds an empty array for nested arrays and multi_select', () => {
    expect(defaultForField({ name: 'x', type: 'array' })).toEqual([]);
    expect(defaultForField({ name: 'y', type: 'multi_select' })).toEqual([]);
  });

  it('honors a field default over the type seed', () => {
    expect(defaultForField({ name: 'item', type: 'text', default: 'hi' })).toBe('hi');
  });
});

describe('fieldValuesEqual (blocks)', () => {
  it('treats unchanged blocks as equal', () => {
    expect(fieldValuesEqual(bodyField, loadedBlocks(), loadedBlocks())).toBe(true);
  });

  it('detects an edited prop', () => {
    const edited = loadedBlocks();
    edited[1]!.props.text = 'Introduction';
    expect(fieldValuesEqual(bodyField, loadedBlocks(), edited)).toBe(false);
  });

  it('detects a replaced asset (object identity differs, id differs)', () => {
    const edited = loadedBlocks();
    edited[0]!.props.icon = { id: 'asset_2', publicUrl: 'y', altText: null };
    expect(fieldValuesEqual(bodyField, loadedBlocks(), edited)).toBe(false);
  });

  it('detects reordering', () => {
    const blocks = loadedBlocks();
    const reordered = [blocks[1]!, blocks[0]!];
    expect(fieldValuesEqual(bodyField, blocks, reordered)).toBe(false);
  });

  it('ignores a re-uploaded asset that resolves to the same id', () => {
    const edited = loadedBlocks();
    edited[0]!.props.icon = { id: 'asset_1', publicUrl: 'different-cdn-url', altText: 'new alt' };
    expect(fieldValuesEqual(bodyField, loadedBlocks(), edited)).toBe(true);
  });
});

describe('computePatch', () => {
  it('omits blocks when nothing changed', () => {
    const patch = computePatch([bodyField], { body: loadedBlocks() }, { body: loadedBlocks() }, reverse);
    expect(patch).toEqual({});
  });

  it('sends the whole blocks field, fully serialized, when one prop changes', () => {
    const edited = loadedBlocks();
    edited[1]!.props.text = 'Introduction';
    const patch = computePatch([bodyField], { body: loadedBlocks() }, { body: edited }, reverse);
    expect(Object.keys(patch)).toEqual(['body']);
    const body = patch.body as SBlock[];
    expect(body[1]?.props.text).toBe('Introduction');
    // Untouched callout is still normalized: asset object → id, public URL → asset://.
    expect(body[0]?.props.icon).toBe('asset_1');
    expect(body[0]?.props.text).toBe('See ![logo](asset://asset_logo)');
  });
});

describe('reinlineAssets', () => {
  it('replaces every known public URL with its asset:// URI', () => {
    expect(reinlineAssets('a https://cdn.example.com/logo.png b', reverse)).toBe(
      'a asset://asset_logo b',
    );
  });

  it('returns the input unchanged with an empty map', () => {
    expect(reinlineAssets('unchanged', new Map())).toBe('unchanged');
  });
});

describe('seedBlock', () => {
  it('seeds type-appropriate empty props and a key', () => {
    const block = seedBlock(CALLOUT);
    expect(block.type).toBe('callout');
    expect(block.props.text).toBe('');
    expect(block.props.icon).toBeNull();
    expect(typeof block.key).toBe('string');
    expect(block.key).not.toHaveLength(0);
  });

  it('honors a field default', () => {
    const block = seedBlock({
      name: 'banner',
      fields: [{ name: 'tone', type: 'select', default: 'info', options: { choices: ['info', 'warn'] } }],
    });
    expect(block.props.tone).toBe('info');
  });
});
