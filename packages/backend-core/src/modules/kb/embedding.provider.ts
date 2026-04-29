import { Injectable } from '@nestjs/common';
import { readEmbeddingProviderFromEnv, type EmbeddingProvider } from '@getmunin/core';

export const EMBEDDING_PROVIDER = Symbol('EmbeddingProvider');

/**
 * Lazy singleton: resolve the EmbeddingProvider once at first use, from env.
 * Wrapped as an Injectable so Nest can hand the same instance to every
 * service that asks for it.
 */
@Injectable()
export class EmbeddingProviderHolder {
  private cached: EmbeddingProvider | null = null;
  get(): EmbeddingProvider {
    this.cached ??= readEmbeddingProviderFromEnv();
    return this.cached;
  }
}
