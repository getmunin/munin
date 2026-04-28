/**
 * Document chunking for embedding.
 *
 * Splits a body of text into overlapping windows roughly sized in tokens.
 * We don't bundle a real tokenizer (tiktoken adds ~7MB and we don't need
 * exact accuracy — pgvector chunks just need to be uniformly bounded);
 * instead we estimate tokens at ~4 characters per token, which is a common
 * approximation for English text and BPE-family encoders.
 *
 * Splits prefer paragraph boundaries (\n\n), then sentence boundaries, then
 * fall back to character cuts so very long unbroken text is still bounded.
 */

export interface ChunkOptions {
  /** Target tokens per chunk. Default 512. */
  targetTokens?: number;
  /** Overlap between successive chunks, in tokens. Default 64. */
  overlapTokens?: number;
}

export interface Chunk {
  index: number;
  content: string;
  tokenCount: number;
}

const DEFAULT_TARGET = 512;
const DEFAULT_OVERLAP = 64;
const CHARS_PER_TOKEN = 4;

export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / CHARS_PER_TOKEN));
}

export function chunkDocument(text: string, opts: ChunkOptions = {}): Chunk[] {
  const target = opts.targetTokens ?? DEFAULT_TARGET;
  const overlap = opts.overlapTokens ?? DEFAULT_OVERLAP;
  if (overlap >= target) {
    throw new Error(`overlap (${overlap}) must be less than target (${target})`);
  }
  const targetChars = target * CHARS_PER_TOKEN;
  const overlapChars = overlap * CHARS_PER_TOKEN;
  const trimmed = text.trim();
  if (!trimmed) return [];

  // Single chunk: short doc fits in one window.
  if (trimmed.length <= targetChars) {
    return [{ index: 0, content: trimmed, tokenCount: estimateTokens(trimmed) }];
  }

  const chunks: Chunk[] = [];
  let start = 0;
  let idx = 0;
  while (start < trimmed.length) {
    const end = Math.min(start + targetChars, trimmed.length);
    let cut = end;
    if (end < trimmed.length) {
      cut = preferBoundary(trimmed, start, end);
    }
    const slice = trimmed.slice(start, cut).trim();
    if (slice) {
      chunks.push({ index: idx++, content: slice, tokenCount: estimateTokens(slice) });
    }
    if (cut >= trimmed.length) break;
    start = Math.max(cut - overlapChars, start + 1);
  }
  return chunks;
}

function preferBoundary(text: string, start: number, end: number): number {
  const minCut = start + Math.floor((end - start) * 0.6);
  const para = text.lastIndexOf('\n\n', end);
  if (para > minCut) return para + 2;
  const sentence = lastSentenceEnd(text, minCut, end);
  if (sentence !== -1) return sentence;
  const space = text.lastIndexOf(' ', end);
  if (space > minCut) return space + 1;
  return end;
}

const SENTENCE_ENDERS = /[.!?]\s/g;

function lastSentenceEnd(text: string, minCut: number, end: number): number {
  const slice = text.slice(minCut, end);
  let last = -1;
  for (const m of slice.matchAll(SENTENCE_ENDERS)) {
    last = m.index;
  }
  return last === -1 ? -1 : minCut + last + 2;
}

// ─── Content hashing ──────────────────────────────────────────────────────
// Cheap stable hash so kb_documents.content_hash can short-circuit
// re-chunking when only metadata changed.

export function contentHash(title: string, body: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  const input = `${title}${body}`;
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x9e3779b1) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x85ebca77) >>> 0;
  }
  h1 = (Math.imul(h1 ^ (h1 >>> 16), 0x735a2d97) ^ Math.imul(h2 ^ (h2 >>> 13), 0xcaf649a9)) >>> 0;
  h2 = (Math.imul(h2 ^ (h2 >>> 16), 0x735a2d97) ^ Math.imul(h1 ^ (h1 >>> 13), 0xcaf649a9)) >>> 0;
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
}
