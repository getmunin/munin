import type { Audience } from '@getmunin/core';

export interface RegisteredRunbook {
  uri: string;
  name: string;
  description: string;
  audiences: readonly Audience[];
  mimeType: string;
  content: string;
  public: boolean;
}

export class RunbookRegistry {
  private readonly byUri = new Map<string, RegisteredRunbook>();

  register(rb: RegisteredRunbook): void {
    if (this.byUri.has(rb.uri)) {
      throw new Error(`Duplicate runbook URI: ${rb.uri}`);
    }
    this.byUri.set(rb.uri, rb);
  }

  list(audience?: Audience): RegisteredRunbook[] {
    const all = Array.from(this.byUri.values());
    if (!audience) return all;
    return all.filter((r) => r.audiences.includes(audience));
  }

  listPublic(): RegisteredRunbook[] {
    return Array.from(this.byUri.values()).filter((r) => r.public);
  }

  get(uri: string): RegisteredRunbook | undefined {
    return this.byUri.get(uri);
  }

  size(): number {
    return this.byUri.size;
  }
}
