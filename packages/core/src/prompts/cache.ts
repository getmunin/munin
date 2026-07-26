export interface KbDocLocation {
  spaceSlug: string;
  slug: string;
}

export interface KbDocReader {
  getBody(location: KbDocLocation): Promise<string | null>;
}

export interface PromptCacheEntry {
  location: KbDocLocation;
  fallback?: string;
}

export interface PromptCacheOptions {
  reader: KbDocReader;
  entries: Record<string, PromptCacheEntry>;
  logger?: { info?: (m: string) => void; warn?: (m: string) => void };
}

export interface PromptCache {
  get(slug: string): string;
  has(slug: string): boolean;
  refresh(slug: string): Promise<void>;
  refreshAll(): Promise<void>;
}

export async function createPromptCache(opts: PromptCacheOptions): Promise<PromptCache> {
  const log = opts.logger ?? {};
  const bodies = new Map<string, string>();

  async function load(slug: string): Promise<void> {
    const entry = opts.entries[slug];
    if (!entry) return;
    try {
      const body = await opts.reader.getBody(entry.location);
      if (body !== null && body.trim().length > 0) {
        bodies.set(slug, body);
      } else {
        bodies.set(slug, entry.fallback ?? '');
      }
    } catch (err) {
      log.warn?.(
        `prompt-cache: failed to load ${entry.location.spaceSlug}/${entry.location.slug}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      bodies.set(slug, entry.fallback ?? '');
    }
  }

  for (const slug of Object.keys(opts.entries)) {
    await load(slug);
  }

  return {
    get(slug) {
      return bodies.get(slug) ?? opts.entries[slug]?.fallback ?? '';
    },
    has(slug) {
      return slug in opts.entries;
    },
    async refresh(slug) {
      if (!(slug in opts.entries)) return;
      await load(slug);
      log.info?.(`prompt-cache: refreshed ${slug}`);
    },
    async refreshAll() {
      for (const slug of Object.keys(opts.entries)) {
        await load(slug);
      }
    },
  };
}
