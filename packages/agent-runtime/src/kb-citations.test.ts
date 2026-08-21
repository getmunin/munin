import { describe, expect, it } from 'vitest';
import { deriveRetrievedDocumentIds } from './kb-citations.ts';
import type { ToolCallTrace } from './types.ts';

function call(name: string, payload: unknown, isError = false): ToolCallTrace {
  return {
    name,
    args: {},
    result: { content: [{ type: 'text', text: JSON.stringify(payload) }], ...(isError ? { isError: true } : {}) },
  };
}

function hit(documentId: string): Record<string, unknown> {
  return {
    documentId,
    spaceId: 'ksp_1',
    title: 'Renter og gebyrer',
    excerpt: 'Effektiv rente …',
    audiences: ['admin', 'self_service'],
    score: 0.8,
    source: 'both',
  };
}

describe('deriveRetrievedDocumentIds', () => {
  it('collects document ids from a search, in hit order', () => {
    expect(
      deriveRetrievedDocumentIds([call('kb_search', [hit('kdoc_a'), hit('kdoc_b')])]),
    ).toEqual(['kdoc_a', 'kdoc_b']);
  });

  it('accumulates across every search in the turn and dedupes', () => {
    expect(
      deriveRetrievedDocumentIds([
        call('kb_search', [hit('kdoc_a')]),
        call('crm_lookup_contact', { id: 'ctc_1' }),
        call('kb_search', [hit('kdoc_b'), hit('kdoc_a')]),
      ]),
    ).toEqual(['kdoc_a', 'kdoc_b']);
  });

  it('ignores failed searches', () => {
    expect(deriveRetrievedDocumentIds([call('kb_search', [hit('kdoc_a')], true)])).toBeUndefined();
  });

  it('returns undefined when the agent never searched the KB', () => {
    expect(deriveRetrievedDocumentIds([call('conv_get_conversation', { id: 'ccv_1' })])).toBeUndefined();
  });

  it('returns undefined for a search that matched nothing', () => {
    expect(deriveRetrievedDocumentIds([call('kb_search', [])])).toBeUndefined();
  });

  it('tolerates a result that is not the expected array of hits', () => {
    expect(deriveRetrievedDocumentIds([call('kb_search', { error: 'nope' })])).toBeUndefined();
    expect(deriveRetrievedDocumentIds([call('kb_search', [hit('kdoc_a'), 'junk', {}])])).toEqual([
      'kdoc_a',
    ]);
  });

  it('tolerates a non-JSON tool result', () => {
    expect(
      deriveRetrievedDocumentIds([
        { name: 'kb_search', args: {}, result: { content: [{ type: 'text', text: 'not json' }] } },
      ]),
    ).toBeUndefined();
  });

  it('caps the list so a broad search cannot bloat message metadata', () => {
    const hits = Array.from({ length: 20 }, (_, i) => hit(`kdoc_${i}`));
    expect(deriveRetrievedDocumentIds([call('kb_search', hits)])).toHaveLength(8);
  });

  it('rejects a document id long enough to look like injected content', () => {
    expect(
      deriveRetrievedDocumentIds([call('kb_search', [hit('k'.repeat(65)), hit('kdoc_a')])]),
    ).toEqual(['kdoc_a']);
  });
});
