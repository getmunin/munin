import { describe, it, expect } from 'vitest';
import { describeRef, refIdFromHref, refUrlTransform, remarkRefTokens } from './cms-refs';
import type { CmsRefExpanded } from './types';

const nbTarget: CmsRefExpanded = {
  id: 'cme_nb',
  slug: 'priser',
  collection: 'guides',
  locale: 'nb',
  data: { title: 'Priser' },
};

const enTarget: CmsRefExpanded = {
  id: 'cme_en',
  slug: 'pricing',
  collection: 'guides',
  locale: 'en',
  data: { title: 'Pricing' },
};

describe('refIdFromHref', () => {
  it('reads the id out of a ref:// href and ignores everything else', () => {
    expect(refIdFromHref('ref://cme_1')).toBe('cme_1');
    expect(refIdFromHref('https://example.test/x')).toBeNull();
    expect(refIdFromHref('ref://')).toBeNull();
    expect(refIdFromHref('ref://not an id')).toBeNull();
    expect(refIdFromHref(undefined)).toBeNull();
  });
});

describe('refUrlTransform', () => {
  it('carries ref:// past the sanitizer that would otherwise blank an unknown scheme', () => {
    expect(refUrlTransform('ref://cme_1')).toBe('ref://cme_1');
    expect(refUrlTransform('https://example.test/a')).toBe('https://example.test/a');
    expect(refUrlTransform('/relative')).toBe('/relative');
    expect(refUrlTransform('javascript:alert(1)')).toBe('');
  });
});

describe('describeRef', () => {
  it('labels a resolved ref by its title, falling back to the slug', () => {
    const titled = describeRef('cme_en', { cme_en: enTarget }, 'en');
    expect(titled).toMatchObject({ label: 'Pricing', collection: 'guides', resolved: true });

    const untitled = describeRef('cme_en', { cme_en: { ...enTarget, data: {} } }, 'en');
    expect(untitled.label).toBe('pricing');
  });

  it('flags a ref that resolved to a different locale than the entry being reviewed', () => {
    expect(describeRef('cme_x', { cme_x: nbTarget }, 'nb').localeFallback).toBe(false);
    expect(describeRef('cme_x', { cme_x: enTarget }, 'nb').localeFallback).toBe(true);
    expect(describeRef('cme_x', { cme_x: enTarget }, undefined).localeFallback).toBe(false);
  });

  it('marks an id with no sidecar entry unresolved rather than inventing a label', () => {
    const gone = describeRef('cme_gone', { cme_en: enTarget }, 'nb');
    expect(gone).toMatchObject({ resolved: false, label: 'cme_gone', collection: null });
    expect(describeRef('cme_gone', undefined, 'nb').resolved).toBe(false);
  });
});

describe('remarkRefTokens', () => {
  const run = (tree: unknown): unknown => {
    remarkRefTokens()(tree as never);
    return tree;
  };

  it('turns a bare ref:// token in prose into a link node', () => {
    const tree = {
      type: 'root',
      children: [
        { type: 'paragraph', children: [{ type: 'text', value: 'see ref://cme_1 now' }] },
      ],
    };
    expect(run(tree)).toEqual({
      type: 'root',
      children: [
        {
          type: 'paragraph',
          children: [
            { type: 'text', value: 'see ' },
            { type: 'link', url: 'ref://cme_1', children: [{ type: 'text', value: 'ref://cme_1' }] },
            { type: 'text', value: ' now' },
          ],
        },
      ],
    });
  });

  it('leaves text without a token untouched', () => {
    const children = [{ type: 'text', value: 'nothing here' }];
    const tree = { type: 'root', children: [{ type: 'paragraph', children }] };
    run(tree);
    expect(tree.children[0]?.children).toBe(children);
  });

  it('does not rewrite a token that is already a link target', () => {
    const tree = {
      type: 'root',
      children: [
        {
          type: 'paragraph',
          children: [
            {
              type: 'link',
              url: 'ref://cme_1',
              children: [{ type: 'text', value: 'ref://cme_1' }],
            },
          ],
        },
      ],
    };
    run(tree);
    const link = tree.children[0]?.children[0];
    expect(link?.children).toEqual([{ type: 'text', value: 'ref://cme_1' }]);
  });

  it('never reaches into a code node, which has no text children to split', () => {
    const tree = {
      type: 'root',
      children: [{ type: 'code', value: 'see ref://cme_1' }],
    };
    run(tree);
    expect(tree.children[0]).toEqual({ type: 'code', value: 'see ref://cme_1' });
  });
});
