/**
 * Embedding providers used by KB hybrid search.
 *
 * Pluggable so self-hosters can swap OpenAI for a local model (Ollama,
 * Llamafile) without forking. The interface returns vectors of a known
 * dimension; the KB schema commits to 1536 (OpenAI text-embedding-3-small,
 * BGE-large, et al). A different dimension means a different schema.
 */

export interface EmbeddingProvider {
  /** Vector dimension this provider produces. Must match the kb schema. */
  readonly dimensions: number;
  /** Human-readable identifier for telemetry / audit. */
  readonly name: string;
  /** Embed a batch of texts. Order of returned vectors matches input order. */
  embed(texts: readonly string[]): Promise<number[][]>;
}

// ─── OpenAI ──────────────────────────────────────────────────────────────────

export interface OpenAIEmbeddingOptions {
  apiKey: string;
  model?: string;
  baseUrl?: string;
}

const DEFAULT_OPENAI_MODEL = 'text-embedding-3-small';
const DEFAULT_OPENAI_BASE = 'https://api.openai.com/v1';

export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  readonly dimensions = 1536;
  readonly name: string;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly baseUrl: string;

  constructor(opts: OpenAIEmbeddingOptions) {
    this.apiKey = opts.apiKey;
    this.model = opts.model ?? DEFAULT_OPENAI_MODEL;
    this.baseUrl = (opts.baseUrl ?? DEFAULT_OPENAI_BASE).replace(/\/+$/, '');
    this.name = `openai:${this.model}`;
  }

  async embed(texts: readonly string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const res = await fetch(`${this.baseUrl}/embeddings`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({ model: this.model, input: texts }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`openai embeddings failed: ${res.status} ${body}`);
    }
    const json = (await res.json()) as { data: { embedding: number[]; index: number }[] };
    // Sort by index defensively — OpenAI returns in-order today, but the
    // contract is explicit.
    return [...json.data].sort((a, b) => a.index - b.index).map((d) => d.embedding);
  }
}

// ─── Stub (deterministic, for tests / local dev without a key) ──────────────

/**
 * Hash-based deterministic vector. Same input → same output. Intentionally
 * cheap; not a real embedding. Useful when running tests offline or in CI
 * where calling out to OpenAI would burn credits and be flaky.
 */
export class StubEmbeddingProvider implements EmbeddingProvider {
  readonly dimensions: number;
  readonly name = 'stub';

  constructor(dimensions = 1536) {
    this.dimensions = dimensions;
  }

  embed(texts: readonly string[]): Promise<number[][]> {
    return Promise.resolve(texts.map((text) => stubVector(text, this.dimensions)));
  }
}

function stubVector(text: string, dim: number): number[] {
  const out = new Array<number>(dim);
  let h1 = 0x811c9dc5;
  let h2 = 0xdeadbeef;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x85ebca6b) >>> 0;
  }
  for (let i = 0; i < dim; i++) {
    h1 = Math.imul(h1 ^ (h1 >>> 13), 0xc2b2ae35) >>> 0;
    h2 = Math.imul(h2 ^ (h2 >>> 16), 0x27d4eb2f) >>> 0;
    const v = ((h1 ^ h2) >>> 0) / 0xffffffff - 0.5;
    out[i] = v;
  }
  // L2-normalize so cosine similarity is well-defined.
  let mag = 0;
  for (let i = 0; i < dim; i++) mag += out[i]! * out[i]!;
  mag = Math.sqrt(mag) || 1;
  for (let i = 0; i < dim; i++) out[i] = out[i]! / mag;
  return out;
}

// ─── Env-based factory ───────────────────────────────────────────────────────

/**
 * Resolve an EmbeddingProvider from environment.
 *
 * `MUNIN_EMBEDDING_PROVIDER`:
 *   `openai` (default if `OPENAI_API_KEY` is set) — uses OpenAI.
 *   `stub`   (default if no key) — deterministic in-process embeddings.
 *
 * `OPENAI_API_KEY` / `OPENAI_EMBEDDING_MODEL` / `OPENAI_BASE_URL` configure
 * the OpenAI provider. Self-hosters pointing at a local model (LM Studio,
 * vLLM, llama.cpp server) usually only need to set `OPENAI_BASE_URL` since
 * those servers speak the OpenAI protocol.
 */
export function readEmbeddingProviderFromEnv(): EmbeddingProvider {
  const explicit = process.env.MUNIN_EMBEDDING_PROVIDER?.toLowerCase();
  if (explicit === 'stub') return new StubEmbeddingProvider();
  const apiKey = process.env.OPENAI_API_KEY;
  if (apiKey || explicit === 'openai') {
    if (!apiKey) {
      throw new Error('MUNIN_EMBEDDING_PROVIDER=openai requires OPENAI_API_KEY');
    }
    return new OpenAIEmbeddingProvider({
      apiKey,
      model: process.env.OPENAI_EMBEDDING_MODEL,
      baseUrl: process.env.OPENAI_BASE_URL,
    });
  }
  return new StubEmbeddingProvider();
}
