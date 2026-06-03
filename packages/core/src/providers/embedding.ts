/**
 * Embedding providers used by KB hybrid search.
 *
 * Pluggable so self-hosters can swap OpenAI for a local model (Ollama,
 * Llamafile) or an OpenAI-compatible vendor (Scaleway Generative APIs,
 * vLLM) without forking. The interface returns vectors of a known
 * dimension; the KB / CMS schema commits to a single dim per deployment,
 * controlled by `MUNIN_EMBEDDING_DIMENSIONS` (default 1536).
 */

import { parseEnvInt } from '../env/index.ts';

export interface EmbeddingProvider {
  /** Vector dimension this provider produces. Must match the kb schema. */
  readonly dimensions: number;
  /** Human-readable identifier for telemetry / audit. */
  readonly name: string;
  /** Embed a batch of texts. Order of returned vectors matches input order. */
  embed(texts: readonly string[]): Promise<number[][]>;
}

export type EmbeddingColumnType = 'vector' | 'halfvec';

export function embeddingColumnType(): EmbeddingColumnType {
  return process.env.MUNIN_EMBEDDING_COLUMN_TYPE === 'halfvec' ? 'halfvec' : 'vector';
}

// ─── OpenAI ──────────────────────────────────────────────────────────────────

export interface OpenAIEmbeddingOptions {
  apiKey: string;
  model?: string;
  baseUrl?: string;
  /**
   * Request a specific vector dimension. When set:
   *   1. sent as `dimensions` in the request body (honored by
   *      text-embedding-3-* and by Scaleway's `qwen3-embedding-8b`),
   *   2. used as the canonical `this.dimensions`,
   *   3. enforced after the response: vectors longer than this are
   *      Matryoshka-truncated and L2-renormalized, vectors shorter
   *      throw a clear error.
   */
  dimensions?: number;
}

const DEFAULT_OPENAI_MODEL = 'text-embedding-3-small';
const DEFAULT_OPENAI_BASE = 'https://api.openai.com/v1';
const DEFAULT_DIMENSIONS = 1536;

export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  readonly dimensions: number;
  readonly name: string;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly baseUrl: string;
  private readonly sendDimensions: boolean;

  constructor(opts: OpenAIEmbeddingOptions) {
    this.apiKey = opts.apiKey;
    this.model = opts.model ?? DEFAULT_OPENAI_MODEL;
    this.baseUrl = (opts.baseUrl ?? DEFAULT_OPENAI_BASE).replace(/\/+$/, '');
    this.dimensions = opts.dimensions ?? DEFAULT_DIMENSIONS;
    this.sendDimensions = opts.dimensions !== undefined;
    this.name = this.sendDimensions
      ? `${this.model}@${this.dimensions}`
      : this.model;
  }

  async embed(texts: readonly string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const body: Record<string, unknown> = { model: this.model, input: texts };
    if (this.sendDimensions) body.dimensions = this.dimensions;
    const res = await fetch(`${this.baseUrl}/embeddings`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(
        `embedding provider request failed: ${res.status} ${errBody} ` +
          `(${this.name} via ${this.baseUrl})`,
      );
    }
    const json = (await res.json()) as { data: { embedding: number[]; index: number }[] };
    const ordered = [...json.data].sort((a, b) => a.index - b.index).map((d) => d.embedding);
    return ordered.map((v) => this.conformDimension(v));
  }

  private conformDimension(vec: number[]): number[] {
    if (vec.length === this.dimensions) return vec;
    if (vec.length < this.dimensions) {
      throw new Error(
        `embedding provider returned ${vec.length} dims, expected ${this.dimensions} ` +
          `(${this.name} — upstream cannot satisfy the requested dimension)`,
      );
    }
    return l2Normalize(vec.slice(0, this.dimensions));
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

  constructor(dimensions = DEFAULT_DIMENSIONS) {
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
  return l2Normalize(out);
}

function l2Normalize(vec: number[]): number[] {
  let mag = 0;
  for (let i = 0; i < vec.length; i++) mag += vec[i]! * vec[i]!;
  mag = Math.sqrt(mag) || 1;
  const out = new Array<number>(vec.length);
  for (let i = 0; i < vec.length; i++) out[i] = vec[i]! / mag;
  return out;
}

// ─── Env-based factory ───────────────────────────────────────────────────────

/**
 * Resolve an EmbeddingProvider from environment.
 *
 * `MUNIN_EMBEDDING_PROVIDER`:
 *   `openai` (default if `OPENAI_API_KEY` is set) — uses OpenAI-compatible API.
 *   `stub`   (default if no key) — deterministic in-process embeddings.
 *
 * `OPENAI_API_KEY` / `OPENAI_EMBEDDING_MODEL` / `OPENAI_BASE_URL` configure
 * the OpenAI-compatible provider. Point `OPENAI_BASE_URL` at any
 * OpenAI-protocol server (LM Studio, vLLM, Scaleway Generative APIs, etc.).
 *
 * `OPENAI_EMBEDDING_DIMENSIONS` requests a specific output dimension when
 * the upstream model supports Matryoshka truncation (text-embedding-3-*,
 * qwen3-embedding-*). Must match the schema's `EMBEDDING_DIMENSIONS`
 * (the `MUNIN_EMBEDDING_DIMENSIONS` env var) — the factory cross-validates
 * to surface mismatches at boot rather than as silent corruption later.
 */
export function readEmbeddingProviderFromEnv(): EmbeddingProvider {
  const explicit = process.env.MUNIN_EMBEDDING_PROVIDER?.toLowerCase();
  const expectedDim = readSchemaDimensionsFromEnv();
  if (explicit === 'stub') return new StubEmbeddingProvider(expectedDim);
  const apiKey = process.env.OPENAI_API_KEY;
  if (apiKey || explicit === 'openai') {
    if (!apiKey) {
      throw new Error('MUNIN_EMBEDDING_PROVIDER=openai requires OPENAI_API_KEY');
    }
    const dimensions = parseOptionalDimensions('OPENAI_EMBEDDING_DIMENSIONS');
    if (dimensions !== undefined && dimensions !== expectedDim) {
      throw new Error(
        `OPENAI_EMBEDDING_DIMENSIONS (${dimensions}) must equal ` +
          `MUNIN_EMBEDDING_DIMENSIONS (${expectedDim}); the embedding provider's ` +
          `output dimension has to match the DB schema.`,
      );
    }
    return new OpenAIEmbeddingProvider({
      apiKey,
      model: process.env.OPENAI_EMBEDDING_MODEL,
      baseUrl: process.env.OPENAI_BASE_URL,
      dimensions,
    });
  }
  return new StubEmbeddingProvider(expectedDim);
}

function parseOptionalDimensions(envName: string): number | undefined {
  if (process.env[envName] === undefined || process.env[envName] === '') return undefined;
  return parseEnvInt({ name: envName, min: 32, max: 4000, onInvalid: 'throw' });
}

function readSchemaDimensionsFromEnv(): number {
  return parseEnvInt({
    name: 'MUNIN_EMBEDDING_DIMENSIONS',
    default: DEFAULT_DIMENSIONS,
    min: 32,
    max: 4000,
    onInvalid: 'throw',
  });
}
