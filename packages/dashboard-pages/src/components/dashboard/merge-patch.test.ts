import { describe, expect, it } from 'vitest';
import { formatFieldValue, mergePatchChanges } from './merge-patch';
import type { CrmContactSummary } from './queue-drawers/types';

function keeper(overrides: Partial<CrmContactSummary> = {}): CrmContactSummary {
  return {
    id: 'cct_keeper',
    name: 'Sofie Berg',
    email: 'sofie.berg@fjordware.com',
    phone: '+47 986 54 321',
    tags: [],
    customFields: {},
    ...overrides,
  };
}

describe('mergePatchChanges', () => {
  it('returns nothing for an empty or absent patch', () => {
    expect(mergePatchChanges(keeper(), undefined)).toEqual([]);
    expect(mergePatchChanges(keeper(), {})).toEqual([]);
  });

  it('marks a field the keeper already has as differing, carrying both values', () => {
    const changes = mergePatchChanges(keeper({ title: 'Head of Support' }), {
      title: 'Director of Customer Operations',
    });
    expect(changes).toEqual([
      {
        field: 'title',
        kind: 'differs',
        before: 'Head of Support',
        after: 'Director of Customer Operations',
        dropped: [],
      },
    ]);
  });

  it('marks a field the keeper lacks as added rather than differing', () => {
    const changes = mergePatchChanges(keeper({ title: null }), { title: 'CTO' });
    expect(changes[0]).toMatchObject({ kind: 'added', before: null, after: 'CTO' });
  });

  it('marks tags and customFields as replaced — the apply overwrites, it does not merge', () => {
    const changes = mergePatchChanges(keeper({ tags: ['retail', 'newsletter'] }), {
      tags: ['retail', 'enterprise'],
    });
    expect(changes[0]).toEqual({
      field: 'tags',
      kind: 'replaced',
      before: 'retail · newsletter',
      after: 'retail · enterprise',
      dropped: ['newsletter'],
    });
  });

  it('drops a patch entry that would not actually change the keeper', () => {
    expect(mergePatchChanges(keeper({ title: 'CTO' }), { title: 'CTO' })).toEqual([]);
    expect(mergePatchChanges(keeper({ tags: ['a', 'b'] }), { tags: ['a', 'b'] })).toEqual([]);
  });

  it('drops a patch entry whose value is empty, so it never reads as a change to nothing', () => {
    expect(mergePatchChanges(keeper({ title: 'CTO' }), { title: '   ' })).toEqual([]);
    expect(mergePatchChanges(keeper({ tags: ['a'] }), { tags: [] })).toEqual([]);
  });

  it('calls a wholesale field added, not replaced, when the keeper has nothing to overwrite', () => {
    const changes = mergePatchChanges(keeper({ customFields: {} }), {
      customFields: { linkedin: 'https://example.com/x' },
    });
    expect(changes[0]).toMatchObject({ kind: 'added', before: null, dropped: [] });
  });

  it('reports nothing dropped when a replacement is purely additive', () => {
    const changes = mergePatchChanges(keeper({ tags: ['retail'] }), {
      tags: ['retail', 'enterprise'],
    });
    expect(changes[0]).toMatchObject({ kind: 'replaced', dropped: [] });
  });

  it('orders rows canonically rather than by jsonb key order', () => {
    const changes = mergePatchChanges(
      keeper({ title: 'Head of Support', tags: ['retail'], address: 'Bergen' }),
      {
        tags: ['retail', 'enterprise'],
        somethingCustom: 'x',
        title: 'Director of Customer Operations',
        address: 'Oslo',
      },
    );
    expect(changes.map((c) => c.field)).toEqual([
      'title',
      'address',
      'tags',
      'somethingCustom',
    ]);
  });
});

describe('formatFieldValue', () => {
  it('renders the value shapes a patch can legally carry', () => {
    expect(formatFieldValue('Head of Ops')).toBe('Head of Ops');
    expect(formatFieldValue(87)).toBe('87');
    expect(formatFieldValue(true)).toBe('yes');
    expect(formatFieldValue(false)).toBe('no');
    expect(formatFieldValue(['a', 'b'])).toBe('a · b');
    expect(formatFieldValue({ linkedin: 'x', role: 'y' })).toBe('linkedin: x · role: y');
  });

  it('treats empty and blank as absent so a row is never rendered for nothing', () => {
    expect(formatFieldValue(null)).toBeNull();
    expect(formatFieldValue(undefined)).toBeNull();
    expect(formatFieldValue('  ')).toBeNull();
    expect(formatFieldValue([])).toBeNull();
    expect(formatFieldValue({})).toBeNull();
  });
});
