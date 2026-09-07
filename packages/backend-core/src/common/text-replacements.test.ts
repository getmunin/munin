import { describe, it, expect } from 'vitest';
import {
  applyTextReplacements,
  countOccurrences,
  describeReplacementFailure,
} from './text-replacements.ts';

describe('countOccurrences', () => {
  it('counts non-overlapping occurrences and returns 0 for an empty needle', () => {
    expect(countOccurrences('aaaa', 'aa')).toBe(2);
    expect(countOccurrences('abcabc', 'abc')).toBe(2);
    expect(countOccurrences('abc', 'x')).toBe(0);
    expect(countOccurrences('abc', '')).toBe(0);
  });
});

describe('applyTextReplacements', () => {
  it('replaces a unique match and reports one applied edit', () => {
    const result = applyTextReplacements(['The quick brown fox'], [
      { oldText: 'brown', newText: 'red' },
    ]);
    expect(result).toEqual({ ok: true, texts: ['The quick red fox'], applied: 1 });
  });

  it('fails with no_match when oldText is absent anywhere', () => {
    const result = applyTextReplacements(['alpha', 'beta'], [{ oldText: 'gamma', newText: 'x' }]);
    expect(result).toEqual({ ok: false, failure: { index: 0, reason: 'no_match', matches: 0 } });
  });

  it('fails with ambiguous when oldText occurs more than once across texts', () => {
    const result = applyTextReplacements(['the cat', 'the dog'], [{ oldText: 'the', newText: 'a' }]);
    expect(result).toEqual({ ok: false, failure: { index: 0, reason: 'ambiguous', matches: 2 } });
  });

  it('replaceAll changes every occurrence across every text', () => {
    const result = applyTextReplacements(
      ['the cat and the hat', 'the dog'],
      [{ oldText: 'the', newText: 'a', replaceAll: true }],
    );
    expect(result).toEqual({ ok: true, texts: ['a cat and a hat', 'a dog'], applied: 3 });
  });

  it('applies edits in order so a later edit sees the earlier result', () => {
    const result = applyTextReplacements(['one two'], [
      { oldText: 'one', newText: 'three' },
      { oldText: 'three two', newText: 'done' },
    ]);
    expect(result).toEqual({ ok: true, texts: ['done'], applied: 2 });
  });

  it('reports the index of the failing edit and leaves nothing half-applied', () => {
    const result = applyTextReplacements(['one two'], [
      { oldText: 'one', newText: 'three' },
      { oldText: 'missing', newText: 'x' },
    ]);
    expect(result).toEqual({ ok: false, failure: { index: 1, reason: 'no_match', matches: 0 } });
  });

  it('matches exactly, so a whitespace difference is a miss', () => {
    const result = applyTextReplacements(['a  b'], [{ oldText: 'a b', newText: 'c' }]);
    expect(result.ok).toBe(false);
  });

  it('allows an empty newText to delete the match', () => {
    const result = applyTextReplacements(['keep drop keep'], [{ oldText: ' drop', newText: '' }]);
    expect(result).toEqual({ ok: true, texts: ['keep keep'], applied: 1 });
  });
});

describe('describeReplacementFailure', () => {
  it('names the failing index and the target for both reasons', () => {
    expect(
      describeReplacementFailure({ index: 2, reason: 'no_match', matches: 0 }, 'field "body"'),
    ).toMatch(/textReplacements\[2\].*not found in field "body"/);
    expect(
      describeReplacementFailure({ index: 0, reason: 'ambiguous', matches: 3 }, 'field "body"'),
    ).toMatch(/occurs 3 times in field "body".*replaceAll/);
  });
});
