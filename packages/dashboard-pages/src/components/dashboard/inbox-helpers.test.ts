import { describe, it, expect } from 'vitest';
import { canScheduleQueueItem, clearKey, truncate } from './inbox-helpers';

describe('canScheduleQueueItem', () => {
  it('offers a time only for the kinds whose approve endpoint takes one', () => {
    expect(canScheduleQueueItem({ kind: 'cms' })).toBe(true);
    expect(canScheduleQueueItem({ kind: 'outreach' })).toBe(true);
  });

  it('withholds it from kinds that apply immediately', () => {
    expect(canScheduleQueueItem({ kind: 'kb' })).toBe(false);
    expect(canScheduleQueueItem({ kind: 'crm' })).toBe(false);
    expect(canScheduleQueueItem({ kind: 'feedback' })).toBe(false);
  });
});

describe('truncate', () => {
  it('leaves a string that already fits alone', () => {
    expect(truncate('short', 10)).toBe('short');
  });

  it('never exceeds the requested length, ellipsis included', () => {
    expect(truncate('abcdefghij', 5)).toHaveLength(5);
  });
});

describe('clearKey', () => {
  it('returns the same object when the key is absent so renders do not churn', () => {
    const obj = { a: 1 };
    expect(clearKey(obj, 'b')).toBe(obj);
  });

  it('returns a copy without the key when it is present', () => {
    const obj = { a: 1, b: 2 };
    expect(clearKey(obj, 'b')).toEqual({ a: 1 });
    expect(obj).toEqual({ a: 1, b: 2 });
  });
});
