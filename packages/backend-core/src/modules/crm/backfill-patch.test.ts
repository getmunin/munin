import { describe, expect, it } from 'vitest';
import { computeBackfillPatch } from './crm.service.ts';

describe('computeBackfillPatch', () => {
  it('fills a null field', () => {
    const r = computeBackfillPatch({ name: null, phone: null }, { name: 'Jane' });
    expect(r.apply).toEqual({ name: 'Jane' });
    expect(r.skipped).toEqual([]);
  });

  it('fills an empty-string field', () => {
    const r = computeBackfillPatch({ name: '' }, { name: 'Jane' });
    expect(r.apply).toEqual({ name: 'Jane' });
    expect(r.skipped).toEqual([]);
  });

  it('skips a field that has an existing non-null value', () => {
    const r = computeBackfillPatch({ name: 'Existing' }, { name: 'Jane' });
    expect(r.apply).toEqual({});
    expect(r.skipped).toEqual(['name']);
  });

  it('mixed: fills null, skips non-null in the same call', () => {
    const r = computeBackfillPatch(
      { name: 'Existing', phone: null, title: '' },
      { name: 'Jane', phone: '+47 555', title: 'Head of Ops' },
    );
    expect(r.apply).toEqual({ phone: '+47 555', title: 'Head of Ops' });
    expect(r.skipped).toEqual(['name']);
  });

  it('ignores undefined values in patch', () => {
    const r = computeBackfillPatch(
      { name: null },
      { name: undefined, phone: '+47 555' },
    );
    expect(r.apply).toEqual({ phone: '+47 555' });
    expect(r.skipped).toEqual([]);
  });

  it('treats missing key on existing as fill-able', () => {
    const r = computeBackfillPatch({}, { name: 'Jane' });
    expect(r.apply).toEqual({ name: 'Jane' });
    expect(r.skipped).toEqual([]);
  });

  it('returns empty apply when patch is empty', () => {
    const r = computeBackfillPatch({ name: 'Existing' }, {});
    expect(r.apply).toEqual({});
    expect(r.skipped).toEqual([]);
  });
});
