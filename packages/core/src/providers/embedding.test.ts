import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  OpenAIEmbeddingProvider,
  StubEmbeddingProvider,
  readEmbeddingProviderFromEnv,
} from './embedding.ts';

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

describe('OpenAIEmbeddingProvider', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  function mockEmbeddingResponse(vec: number[]): void {
    globalThis.fetch = () =>
      Promise.resolve(
        new Response(JSON.stringify({ data: [{ embedding: vec, index: 0 }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
  }

  function installFetchSpy(responseVec: number[]): {
    lastCall(): { url: string; body: Record<string, unknown> };
  } {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    globalThis.fetch = ((url: string, init: RequestInit) => {
      calls.push({ url, init });
      return Promise.resolve(
        new Response(JSON.stringify({ data: [{ embedding: responseVec, index: 0 }] }), {
          status: 200,
        }),
      );
    }) as unknown as typeof fetch;
    return {
      lastCall: () => {
        const c = calls.at(-1);
        if (!c) throw new Error('fetch was not called');
        return { url: c.url, body: JSON.parse(c.init.body as string) as Record<string, unknown> };
      },
    };
  }

  it('omits the dimensions field by default and reports 1536', async () => {
    const spy = installFetchSpy(new Array<number>(1536).fill(0.1));
    const p = new OpenAIEmbeddingProvider({ apiKey: 'sk-test' });
    expect(p.dimensions).toBe(1536);
    expect(p.name).toBe('openai:text-embedding-3-small');
    await p.embed(['hi']);
    expect(spy.lastCall().body.dimensions).toBeUndefined();
  });

  it('sends the dimensions field when configured and names itself accordingly', async () => {
    const spy = installFetchSpy(new Array<number>(4000).fill(0.5));
    const p = new OpenAIEmbeddingProvider({
      apiKey: 'sk-test',
      model: 'qwen3-embedding-8b',
      baseUrl: 'https://api.scaleway.ai/v1',
      dimensions: 4000,
    });
    expect(p.dimensions).toBe(4000);
    expect(p.name).toBe('openai:qwen3-embedding-8b@4000');
    await p.embed(['hi']);
    expect(spy.lastCall().body).toMatchObject({
      model: 'qwen3-embedding-8b',
      dimensions: 4000,
      input: ['hi'],
    });
  });

  it('truncates and renormalizes an oversize response (Matryoshka fallback)', async () => {
    const oversize = [3, 4, 0, 0, 0, 0];
    mockEmbeddingResponse(oversize);
    const p = new OpenAIEmbeddingProvider({ apiKey: 'sk-test', dimensions: 2 });
    const [v] = await p.embed(['hi']);
    expect(v).toHaveLength(2);
    expect(v![0]!).toBeCloseTo(0.6, 9);
    expect(v![1]!).toBeCloseTo(0.8, 9);
    const mag = Math.sqrt(v!.reduce((s, x) => s + x * x, 0));
    expect(Math.abs(mag - 1)).toBeLessThan(1e-9);
  });

  it('throws when the response is shorter than requested (cannot upsize)', async () => {
    mockEmbeddingResponse([1, 2, 3]);
    const p = new OpenAIEmbeddingProvider({ apiKey: 'sk-test', dimensions: 8 });
    await expect(p.embed(['hi'])).rejects.toThrow(/returned 3 dims, expected 8/);
  });

  it('uses the configured baseUrl (strips trailing slashes)', async () => {
    const spy = installFetchSpy(new Array<number>(1536).fill(0));
    const p = new OpenAIEmbeddingProvider({ apiKey: 'sk-test', baseUrl: 'https://api.scaleway.ai/v1//' });
    await p.embed(['hi']);
    expect(spy.lastCall().url).toBe('https://api.scaleway.ai/v1/embeddings');
  });
});

describe('readEmbeddingProviderFromEnv', () => {
  const snapshot = { ...process.env };
  beforeEach(() => {
    delete process.env.MUNIN_EMBEDDING_PROVIDER;
    delete process.env.MUNIN_EMBEDDING_DIMENSIONS;
    delete process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_BASE_URL;
    delete process.env.OPENAI_EMBEDDING_MODEL;
    delete process.env.OPENAI_EMBEDDING_DIMENSIONS;
  });
  afterEach(() => {
    Object.assign(process.env, snapshot);
  });

  it('returns the stub when no API key is set and no provider is forced', () => {
    const p = readEmbeddingProviderFromEnv();
    expect(p).toBeInstanceOf(StubEmbeddingProvider);
    expect(p.dimensions).toBe(1536);
  });

  it('honors MUNIN_EMBEDDING_DIMENSIONS for the stub when no key is set', () => {
    process.env.MUNIN_EMBEDDING_DIMENSIONS = '4000';
    const p = readEmbeddingProviderFromEnv();
    expect(p).toBeInstanceOf(StubEmbeddingProvider);
    expect(p.dimensions).toBe(4000);
  });

  it('throws when OPENAI_EMBEDDING_DIMENSIONS disagrees with MUNIN_EMBEDDING_DIMENSIONS', () => {
    process.env.MUNIN_EMBEDDING_DIMENSIONS = '1536';
    process.env.OPENAI_API_KEY = 'sk-test';
    process.env.OPENAI_EMBEDDING_DIMENSIONS = '4000';
    expect(() => readEmbeddingProviderFromEnv()).toThrow(/must equal/);
  });

  it('throws on out-of-range dimensions env values', () => {
    process.env.MUNIN_EMBEDDING_DIMENSIONS = '8';
    expect(() => readEmbeddingProviderFromEnv()).toThrow(/32\.\.4000/);
  });

  it('builds an OpenAI provider with matching dimensions when both env vars agree', () => {
    process.env.MUNIN_EMBEDDING_DIMENSIONS = '4000';
    process.env.OPENAI_API_KEY = 'sk-test';
    process.env.OPENAI_BASE_URL = 'https://api.scaleway.ai/v1';
    process.env.OPENAI_EMBEDDING_MODEL = 'qwen3-embedding-8b';
    process.env.OPENAI_EMBEDDING_DIMENSIONS = '4000';
    const p = readEmbeddingProviderFromEnv();
    expect(p).toBeInstanceOf(OpenAIEmbeddingProvider);
    expect(p.dimensions).toBe(4000);
    expect(p.name).toBe('openai:qwen3-embedding-8b@4000');
  });

  it('keeps the OSS default (no env vars) producing a 1536-dim OpenAI provider', () => {
    process.env.OPENAI_API_KEY = 'sk-test';
    const p = readEmbeddingProviderFromEnv();
    expect(p).toBeInstanceOf(OpenAIEmbeddingProvider);
    expect(p.dimensions).toBe(1536);
    expect(p.name).toBe('openai:text-embedding-3-small');
  });
});
