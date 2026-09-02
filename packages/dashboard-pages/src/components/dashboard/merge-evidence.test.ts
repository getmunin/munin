import { describe, expect, it } from 'vitest';
import { readMergeEvidence } from './merge-evidence';

describe('readMergeEvidence', () => {
  it('returns nothing to say when there is no evidence', () => {
    expect(readMergeEvidence(undefined)).toEqual({
      matchSentence: null,
      keeperReason: null,
      signals: [],
    });
    expect(readMergeEvidence({})).toEqual({
      matchSentence: null,
      keeperReason: null,
      signals: [],
    });
  });

  it('reads the shape sitting in the dev database today', () => {
    const parsed = readMergeEvidence({
      phoneInB: '+47 986 54 321',
      sameName: 'Sofie Berg',
      keeperReason: 'B has complete phone number and more descriptive title',
      emailVariation: { a: 's.berg@fjordware.com', b: 'sofie.berg@fjordware.com' },
      sameCompanyDomain: 'fjordware.com',
    });
    expect(parsed.signals).toEqual([
      'same phone',
      'same name',
      'alias of the same email',
      'same company domain',
    ]);
    expect(parsed.matchSentence).toBe(
      'Same phone, same name, alias of the same email and same company domain.',
    );
    expect(parsed.keeperReason).toBe('B has complete phone number and more descriptive title');
  });

  it('reads the shape the clean-contact-data skill documents', () => {
    const parsed = readMergeEvidence({
      sameEmail: 'vita@acme.com',
      samePhoneNormalized: '+4790000000',
      nameMatch: { a: 'Vita Vivisectus', b: 'vita vivisectus' },
      sameCompanyId: 'cco_acme',
      keeperReason: 'has_end_user_id + more_recent_last_contacted',
    });
    expect(parsed.signals).toEqual([
      'same email',
      'same phone',
      'near-identical name',
      'same company',
    ]);
  });

  it('strips a trailing period so the reason composes into the surrounding sentence', () => {
    expect(readMergeEvidence({ keeperReason: 'it has the linked end-user.' }).keeperReason).toBe(
      'it has the linked end-user',
    );
  });

  it('never repeats a signal when two keys map to the same label', () => {
    const parsed = readMergeEvidence({ samePhone: '1', phoneInB: '1' });
    expect(parsed.signals).toEqual(['same phone']);
  });

  it('ignores keys it has no label for rather than dumping raw jsonb into the sentence', () => {
    const parsed = readMergeEvidence({ someInternalScore: 0.92, keeperReason: 'x' });
    expect(parsed.signals).toEqual([]);
    expect(parsed.matchSentence).toBeNull();
  });
});
