import { describe, it, expect } from 'vitest';
import { StubEmbeddingProvider } from './embedding.ts';

describe('StubEmbeddingProvider', () => {
  it('returns one vector per input in order', async () => {
    const p = new StubEmbeddingProvider(64);
    const vecs = await p.embed(['hello', 'world', 'munin']);
    expect(vecs).toHaveLength(3);
    vecs.forEach((v) => expect(v).toHaveLength(64));
  });

  it('is deterministic for the same input', async () => {
    const p = new StubEmbeddingProvider(64);
    const a = (await p.embed(['hello']))[0]!;
    const b = (await p.embed(['hello']))[0]!;
    expect(a).toEqual(b);
  });

  it('produces different vectors for different inputs', async () => {
    const p = new StubEmbeddingProvider(64);
    const [a, b] = await p.embed(['hello', 'goodbye']);
    expect(a).not.toEqual(b);
  });

  it('is L2-normalized', async () => {
    const p = new StubEmbeddingProvider(128);
    const v = (await p.embed(['some text']))[0]!;
    const mag = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
    expect(Math.abs(mag - 1)).toBeLessThan(1e-9);
  });

  it('handles empty input array', async () => {
    const p = new StubEmbeddingProvider();
    expect(await p.embed([])).toEqual([]);
  });
});
