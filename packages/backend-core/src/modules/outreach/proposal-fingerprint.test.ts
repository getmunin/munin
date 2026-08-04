import { describe, it, expect } from 'vitest';
import { draftFingerprint } from './proposal-fingerprint.ts';

const base = {
  campaignId: 'ocmp_a',
  contactId: 'ccon_b',
  kind: 'initial',
  draftSubject: 'Quick question',
  draftBody: 'Hi there — worth a chat?',
  proposedSendAt: null,
};

describe('draftFingerprint', () => {
  it('is stable for the same draft', () => {
    expect(draftFingerprint(base)).toBe(draftFingerprint({ ...base }));
  });

  it('changes when the body, the subject, or the send time changes', () => {
    const original = draftFingerprint(base);
    expect(draftFingerprint({ ...base, draftBody: 'Hi there — worth a chat??' })).not.toBe(original);
    expect(draftFingerprint({ ...base, draftSubject: 'Quick question!' })).not.toBe(original);
    expect(draftFingerprint({ ...base, proposedSendAt: '2026-08-03T09:00:00.000Z' })).not.toBe(
      original,
    );
  });

  it('changes when the recipient or the campaign changes', () => {
    const original = draftFingerprint(base);
    expect(draftFingerprint({ ...base, contactId: 'ccon_c' })).not.toBe(original);
    expect(draftFingerprint({ ...base, campaignId: 'ocmp_b' })).not.toBe(original);
  });

  it('reads a Date and its ISO string as the same send time', () => {
    const iso = '2026-08-03T09:00:00.000Z';
    expect(draftFingerprint({ ...base, proposedSendAt: new Date(iso) })).toBe(
      draftFingerprint({ ...base, proposedSendAt: iso }),
    );
  });

  it('does not collide when text shifts across the subject/body boundary', () => {
    expect(draftFingerprint({ ...base, draftSubject: 'ab', draftBody: 'c' })).not.toBe(
      draftFingerprint({ ...base, draftSubject: 'a', draftBody: 'bc' }),
    );
  });
});
