import { describe, it, expect } from 'vitest';
import { mergeFingerprint } from './merge-fingerprint.ts';

const base = {
  contactAId: 'ccon_a',
  contactBId: 'ccon_b',
  recommendedKeeperId: 'ccon_a',
  recommendedPatch: { title: 'Head of Ops', tags: ['vip'] },
  confidence: 'high',
};

describe('mergeFingerprint', () => {
  it('is stable for the same proposal', () => {
    expect(mergeFingerprint(base)).toBe(mergeFingerprint({ ...base }));
  });

  it('changes when the keeper is flipped', () => {
    expect(mergeFingerprint({ ...base, recommendedKeeperId: 'ccon_b' })).not.toBe(
      mergeFingerprint(base),
    );
  });

  it('changes when the patch or the confidence changes', () => {
    expect(mergeFingerprint({ ...base, recommendedPatch: { title: 'Head of Sales' } })).not.toBe(
      mergeFingerprint(base),
    );
    expect(mergeFingerprint({ ...base, confidence: 'medium' })).not.toBe(mergeFingerprint(base));
  });

  it('ignores key order inside the patch', () => {
    expect(
      mergeFingerprint({ ...base, recommendedPatch: { a: 1, b: { c: 2, d: 3 } } }),
    ).toBe(mergeFingerprint({ ...base, recommendedPatch: { b: { d: 3, c: 2 }, a: 1 } }));
  });

  it('does not ignore array order inside the patch', () => {
    expect(mergeFingerprint({ ...base, recommendedPatch: { tags: ['a', 'b'] } })).not.toBe(
      mergeFingerprint({ ...base, recommendedPatch: { tags: ['b', 'a'] } }),
    );
  });

  it('treats an absent patch as an empty one', () => {
    expect(mergeFingerprint({ ...base, recommendedPatch: {} })).toBe(
      mergeFingerprint({ ...base, recommendedPatch: undefined as never }),
    );
  });
});
