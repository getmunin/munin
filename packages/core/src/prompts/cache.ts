/**
 * Shared prompt-cache primitives used by both the chat runtime (agent-runtime,
 * MCP-backed reader) and the voice path (backend-core, DB-backed reader). The
 * source of truth for any prompt is a KB document; this cache is just an
 * in-memory mirror keyed by slug, refilled either eagerly at init or lazily
 * via `refresh(slug)` on a KB-change event / TTL expiry.
 */

export interface KbDocLocation {
  spaceSlug: string;
  slug: string;
}

/**
 * Strategy for reading a KB document body by (space, slug). Implementations
 * differ — agent-runtime uses an MCP tool call; backend-core hits the DB
 * directly with org-scoped RLS already in place. Both return `null` when the
 * document does not exist (caller decides on fallback strategy).
 */
export interface KbDocReader {
  getBody(location: KbDocLocation): Promise<string | null>;
}

export interface PromptCacheEntry {
  location: KbDocLocation;
  /** Optional default body, used if the KB doc is missing on read. */
  fallback?: string;
}

export interface PromptCacheOptions {
  reader: KbDocReader;
  entries: Record<string, PromptCacheEntry>;
  logger?: { info?: (m: string) => void; warn?: (m: string) => void };
}

export interface PromptCache {
  /**
   * Return the cached body for `slug`. Falls back to the entry's `fallback`
   * value if the KB doc was missing at last load, or to an empty string if
   * no fallback was configured.
   */
  get(slug: string): string;
  /**
   * Whether `slug` was registered when the cache was created. Useful for
   * filtering KB-change events before calling `refresh`.
   */
  has(slug: string): boolean;
  /** Reload the body for `slug` from the underlying reader. */
  refresh(slug: string): Promise<void>;
  /** Reload every registered slug. */
  refreshAll(): Promise<void>;
}

/**
 * Build a `PromptCache` and prime it with the bodies of every registered
 * document. Documents that 404 stay in the cache as their `fallback` value
 * (or empty string) so callers can render without null checks.
 */
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

  await Promise.all(Object.keys(opts.entries).map((slug) => load(slug)));

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
      await Promise.all(Object.keys(opts.entries).map((slug) => load(slug)));
    },
  };
}
