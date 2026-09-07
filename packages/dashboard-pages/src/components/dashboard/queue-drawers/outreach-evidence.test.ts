import { describe, expect, it } from 'vitest';
import { readOutreachEvidence } from './types';

describe('readOutreachEvidence', () => {
  it('returns null when there is no evidence to show', () => {
    expect(readOutreachEvidence(undefined)).toBeNull();
    expect(readOutreachEvidence({})).toBeNull();
    expect(readOutreachEvidence({ nested: { ignored: true }, blank: '   ' })).toBeNull();
  });

  it('reads the shape the drafting skills document', () => {
    const parsed = readOutreachEvidence({
      kbDocIds: ['kdoc_abc', 'kdoc_def'],
      contactSignals: ['title=Head of Ops', 'tag=enterprise'],
      reasoning: 'Brief targets ops leaders; contact title matches.',
    });
    expect(parsed?.prose).toEqual(['Brief targets ops leaders; contact title matches.']);
    expect(parsed?.kbRefs).toEqual(['kdoc_abc', 'kdoc_def']);
    expect(parsed?.chips).toEqual([
      { label: 'Contact Signals', value: 'title=Head of Ops' },
      { label: 'Contact Signals', value: 'tag=enterprise' },
    ]);
  });

  it('reads a completely different shape without dropping it — evidence is freeform jsonb', () => {
    const parsed = readOutreachEvidence({
      role: 'COO',
      company: 'Northwind Heating',
      icpFit: 'field service, 200+ installers',
      signal: 'Two customer reviews mention booking friction (2026-06)',
      source: 'kb://market-research/field-service-signals',
    });
    expect(parsed?.prose).toEqual(['Two customer reviews mention booking friction (2026-06)']);
    expect(parsed?.kbRefs).toEqual(['kb://market-research/field-service-signals']);
    expect(parsed?.chips).toEqual([
      { label: 'Role', value: 'COO' },
      { label: 'Company', value: 'Northwind Heating' },
      { label: 'Icp Fit', value: 'field service, 200+ installers' },
    ]);
  });

  it('promotes a long value to prose rather than overflowing a chip', () => {
    const long = 'x'.repeat(60);
    const parsed = readOutreachEvidence({ note: long, short: 'ok' });
    expect(parsed?.prose).toEqual([long]);
    expect(parsed?.chips).toEqual([{ label: 'Short', value: 'ok' }]);
  });

  it('keeps numbers and booleans instead of silently discarding them', () => {
    const parsed = readOutreachEvidence({ score: 87, verified: true });
    expect(parsed?.chips).toEqual([
      { label: 'Score', value: '87' },
      { label: 'Verified', value: 'true' },
    ]);
  });
});
