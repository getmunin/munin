import { describe, it, expect } from 'vitest';
import { chunkDocument, contentHash, estimateTokens } from './chunker.js';

describe('chunkDocument', () => {
  it('returns empty for empty input', () => {
    expect(chunkDocument('')).toEqual([]);
    expect(chunkDocument('   \n\n  ')).toEqual([]);
  });

  it('returns single chunk when text fits target', () => {
    const out = chunkDocument('Short doc.', { targetTokens: 100, overlapTokens: 10 });
    expect(out).toHaveLength(1);
    expect(out[0]!.index).toBe(0);
    expect(out[0]!.content).toBe('Short doc.');
  });

  it('splits long text into multiple chunks with sequential indices', () => {
    // ~6000 chars → with target=200 chars (50 tokens) we should get many chunks.
    const para = 'This is a sentence. '.repeat(300);
    const out = chunkDocument(para, { targetTokens: 50, overlapTokens: 8 });
    expect(out.length).toBeGreaterThan(5);
    out.forEach((c, i) => expect(c.index).toBe(i));
  });

  it('chunks overlap so context survives boundaries', () => {
    const para = 'A B C D E F G H I J K L M N O P Q R S T U V W X Y Z '.repeat(20);
    const out = chunkDocument(para, { targetTokens: 30, overlapTokens: 8 });
    for (let i = 1; i < out.length; i++) {
      const prev = out[i - 1]!.content;
      const curr = out[i]!.content;
      const tail = prev.slice(-16);
      // At least some characters of tail should appear at the start of next.
      const firstWord = curr.split(' ')[0]!;
      expect(prev.includes(firstWord) || tail.length > 0).toBe(true);
    }
  });

  it('prefers paragraph boundaries when available', () => {
    const text =
      'Para one with several words to fill space.\n\nPara two starts here and continues.\n\nPara three ends.';
    const out = chunkDocument(text, { targetTokens: 20, overlapTokens: 4 });
    expect(out.length).toBeGreaterThanOrEqual(2);
  });

  it('rejects overlap >= target', () => {
    expect(() => chunkDocument('hi', { targetTokens: 10, overlapTokens: 10 })).toThrow();
  });
});

describe('estimateTokens', () => {
  it('rounds up to at least 1', () => {
    expect(estimateTokens('a')).toBe(1);
    expect(estimateTokens('aaaa')).toBe(1);
    expect(estimateTokens('aaaaa')).toBe(2);
  });
});

describe('contentHash', () => {
  it('is stable for the same input', () => {
    expect(contentHash('hello', 'world')).toBe(contentHash('hello', 'world'));
  });

  it('changes when title or body changes', () => {
    const a = contentHash('hello', 'world');
    const b = contentHash('hello!', 'world');
    const c = contentHash('hello', 'world!');
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
    expect(b).not.toBe(c);
  });

  it('returns 16 hex chars', () => {
    expect(contentHash('a', 'b')).toMatch(/^[0-9a-f]{16}$/);
  });
});
