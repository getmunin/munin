import { Injectable } from '@nestjs/common';
import { readEmbeddingProviderFromEnv, type EmbeddingProvider } from '@getmunin/core';

export const EMBEDDING_PROVIDER = Symbol('EmbeddingProvider');

@Injectable()
export class EmbeddingProviderHolder {
  private cached: EmbeddingProvider | null = null;
  get(): EmbeddingProvider {
    this.cached ??= readEmbeddingProviderFromEnv();
    return this.cached;
  }
}
