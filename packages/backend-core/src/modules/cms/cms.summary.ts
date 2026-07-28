import type { FieldDef } from './cms.fields.ts';

export const SUMMARY_LEAD_CHARS = 200;
export const SUMMARY_LEAD_STEPS = [200, 60, 0];
export const SUMMARY_RESULT_CHARS_MAX = 30_000;
const COMPACT_VALUE_CHARS = 200;

export interface FieldSummaryNote {
  words?: number;
  items?: number;
  truncated?: true;
  omitted?: true;
}

export interface EntryDataSummary {
  data: Record<string, unknown>;
  fieldSummary: Record<string, FieldSummaryNote>;
  truncated: boolean;
}

interface ExpandedEntryValue {
  id: string;
  slug: string;
  collection: string;
  locale?: string;
  data: Record<string, unknown>;
}

export function countWords(value: string): number {
  const matches = value.match(/\S+/g);
  return matches ? matches.length : 0;
}

export function summarizeEntryData(
  fields: FieldDef[],
  data: Record<string, unknown>,
  opts?: { leadChars?: number; verbatim?: ReadonlySet<string> },
): EntryDataSummary {
  const leadChars = opts?.leadChars ?? SUMMARY_LEAD_CHARS;
  const entries = fields.map(
    (field) => [field.name, data[field.name] ?? field.default ?? null] as const,
  );
  return summarizePairs(entries, leadChars, opts?.verbatim);
}

export function summarizeValues(
  data: Record<string, unknown>,
  leadChars: number,
): EntryDataSummary {
  return summarizePairs(Object.entries(data), leadChars);
}

function summarizePairs(
  pairs: ReadonlyArray<readonly [string, unknown]>,
  leadChars: number,
  verbatim?: ReadonlySet<string>,
): EntryDataSummary {
  const out: Record<string, unknown> = {};
  const fieldSummary: Record<string, FieldSummaryNote> = {};

  for (const [name, value] of pairs) {
    if (verbatim?.has(name)) {
      out[name] = value;
      continue;
    }
    const result = summarizeValue(value, leadChars);
    if ('value' in result) out[name] = result.value;
    if (result.note) fieldSummary[name] = result.note;
  }

  return {
    data: out,
    fieldSummary,
    truncated: Object.keys(fieldSummary).length > 0,
  };
}

function summarizeValue(
  value: unknown,
  leadChars: number,
): { value?: unknown; note?: FieldSummaryNote } {
  if (typeof value === 'string') {
    if (value.length <= leadChars) return { value };
    const words = countWords(value);
    if (leadChars === 0) return { note: { words, omitted: true } };
    return {
      value: `${value.slice(0, leadChars).trimEnd()}…`,
      note: { words, truncated: true },
    };
  }

  if (value === null || typeof value !== 'object') return { value };

  if (!Array.isArray(value) && isExpandedEntry(value)) {
    const nested = summarizeValues(value.data, leadChars);
    return {
      value: {
        id: value.id,
        slug: value.slug,
        collection: value.collection,
        ...(value.locale === undefined ? {} : { locale: value.locale }),
        data: nested.data,
        ...(nested.truncated ? { fieldSummary: nested.fieldSummary } : {}),
      },
    };
  }

  const serialized = JSON.stringify(value) ?? '';
  if (serialized.length <= COMPACT_VALUE_CHARS) return { value };

  return {
    note: Array.isArray(value) ? { items: value.length, omitted: true } : { omitted: true },
  };
}

function isExpandedEntry(value: object): value is ExpandedEntryValue {
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.slug === 'string' &&
    typeof candidate.collection === 'string' &&
    typeof candidate.data === 'object' &&
    candidate.data !== null
  );
}

export function fitWithinBudget<T>(
  build: (leadChars: number) => T[],
  opts?: { budget?: number; steps?: readonly number[] },
): { items: T[]; dropped: number } {
  const budget = opts?.budget ?? SUMMARY_RESULT_CHARS_MAX;
  const steps = opts?.steps ?? SUMMARY_LEAD_STEPS;

  let items: T[] = [];
  for (const leadChars of steps) {
    items = build(leadChars);
    if (measure(items) <= budget) return { items, dropped: 0 };
  }

  const total = items.length;
  while (items.length > 1 && measure(items) > budget) {
    items = items.slice(0, Math.floor(items.length * 0.8) || 1);
  }
  return { items, dropped: total - items.length };
}

function measure(items: unknown[]): number {
  return JSON.stringify(items).length;
}
