import { describe, expect, it } from 'vitest';
import type { FieldDef } from './cms.fields.ts';
import { fitWithinBudget, summarizeEntryData } from './cms.summary.ts';

const FIELDS: FieldDef[] = [
  { name: 'title', type: 'text', required: true },
  { name: 'body', type: 'markdown' },
  { name: 'wordsPerMinute', type: 'number' },
  { name: 'featured', type: 'boolean' },
  { name: 'hero', type: 'asset' },
  { name: 'tags', type: 'multi_select' },
  { name: 'blocks', type: 'blocks' },
];

const LONG_BODY = 'lorem ipsum dolor sit amet '.repeat(200);

function entry(overrides?: Record<string, unknown>): Record<string, unknown> {
  return {
    title: 'A short headline',
    body: LONG_BODY,
    wordsPerMinute: 240,
    featured: true,
    hero: 'asset://abc123',
    tags: ['news', 'product'],
    blocks: Array.from({ length: 12 }, (_, i) => ({ type: 'prose', props: { text: `b${i}` } })),
    ...overrides,
  };
}

describe('summarizeEntryData', () => {
  it('keeps short scalars verbatim and shortens long text to a lead with a word count', () => {
    const summary = summarizeEntryData(FIELDS, entry());

    expect(summary.data.title).toBe('A short headline');
    expect(summary.data.wordsPerMinute).toBe(240);
    expect(summary.data.featured).toBe(true);
    expect(summary.data.hero).toBe('asset://abc123');
    expect(summary.data.tags).toEqual(['news', 'product']);

    expect(summary.data.body).toMatch(/^lorem ipsum/);
    expect((summary.data.body as string).length).toBeLessThanOrEqual(201);
    expect(summary.fieldSummary.body).toEqual({ words: 1000, truncated: true });
    expect(summary.truncated).toBe(true);
  });

  it('replaces oversized collections with an item count', () => {
    const summary = summarizeEntryData(FIELDS, entry());

    expect(summary.data.blocks).toBeUndefined();
    expect(summary.fieldSummary.blocks).toEqual({ items: 12, omitted: true });
  });

  it('reports nothing truncated when every value is already compact', () => {
    const summary = summarizeEntryData(FIELDS, entry({ body: 'Two words', blocks: [] }));

    expect(summary.data.body).toBe('Two words');
    expect(summary.data.blocks).toEqual([]);
    expect(summary.fieldSummary).toEqual({});
    expect(summary.truncated).toBe(false);
  });

  it('returns requested fields verbatim', () => {
    const summary = summarizeEntryData(FIELDS, entry(), { verbatim: new Set(['body']) });

    expect(summary.data.body).toBe(LONG_BODY);
    expect(summary.fieldSummary.body).toBeUndefined();
  });

  it('omits long text entirely at a zero lead', () => {
    const summary = summarizeEntryData(FIELDS, entry(), { leadChars: 0 });

    expect(summary.data.body).toBeUndefined();
    expect(summary.fieldSummary.body).toEqual({ words: 1000, omitted: true });
  });

  it('summarizes a collection whose only field is long text', () => {
    const fields: FieldDef[] = [{ name: 'body', type: 'markdown' }];
    const summary = summarizeEntryData(fields, { body: LONG_BODY });

    expect(summary.data.body).toMatch(/^lorem ipsum/);
  });

  it('uses the field default when the entry has no value', () => {
    const fields: FieldDef[] = [{ name: 'status', type: 'select', default: 'idle' }];
    const summary = summarizeEntryData(fields, {});

    expect(summary.data.status).toBe('idle');
  });
});

describe('fitWithinBudget', () => {
  it('keeps the first pass when it already fits', () => {
    const result = fitWithinBudget((leadChars) => [{ leadChars }], { budget: 10_000 });

    expect(result.items).toEqual([{ leadChars: 200 }]);
    expect(result.dropped).toBe(0);
  });

  it('sheds lead characters until the payload fits', () => {
    const result = fitWithinBudget((leadChars) => [{ pad: 'x'.repeat(leadChars) }], {
      budget: 100,
    });

    expect(result.items).toEqual([{ pad: 'x'.repeat(60) }]);
    expect(result.dropped).toBe(0);
  });

  it('drops rows when even a zero lead overflows the budget', () => {
    const result = fitWithinBudget(
      () => Array.from({ length: 50 }, (_, i) => ({ id: `entry-${i}` })),
      { budget: 200 },
    );

    expect(result.items.length).toBeLessThan(50);
    expect(result.items.length).toBeGreaterThan(0);
    expect(result.dropped).toBe(50 - result.items.length);
    expect(JSON.stringify(result.items).length).toBeLessThanOrEqual(200);
  });

  it('never drops the last row', () => {
    const result = fitWithinBudget(() => [{ id: 'x'.repeat(500) }], { budget: 10 });

    expect(result.items).toHaveLength(1);
    expect(result.dropped).toBe(0);
  });
});
