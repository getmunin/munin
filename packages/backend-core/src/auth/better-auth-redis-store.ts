import type { Redis } from 'ioredis';

/**
 * Shape better-auth passes to a custom rate-limit store. Matches
 * `RateLimit` in the better-auth source: a tiny counter plus the
 * timestamp of the last request, used to expire the window.
 */
export interface BetterAuthRateLimitEntry {
  key: string;
  count: number;
  lastRequest: number;
}

export interface BetterAuthRateLimitStorage {
  get(key: string): Promise<BetterAuthRateLimitEntry | null>;
  set(key: string, value: BetterAuthRateLimitEntry): Promise<void>;
}

const DEFAULT_KEY_PREFIX = 'munin:rate-limit:';

const DEFAULT_TTL_SECONDS = 60 * 60;

export interface CreateRedisRateLimitStoreOptions {
  client: Redis;
  keyPrefix?: string;
  ttlSeconds?: number;
}

export function createRedisRateLimitStore(
  opts: CreateRedisRateLimitStoreOptions,
): BetterAuthRateLimitStorage {
  const { client } = opts;
  const prefix = opts.keyPrefix ?? DEFAULT_KEY_PREFIX;
  const ttl = opts.ttlSeconds ?? DEFAULT_TTL_SECONDS;

  return {
    async get(key) {
      const raw = await client.get(prefix + key);
      if (raw === null) return null;
      try {
        const parsed = JSON.parse(raw) as Partial<BetterAuthRateLimitEntry>;
        if (
          typeof parsed.key === 'string' &&
          typeof parsed.count === 'number' &&
          typeof parsed.lastRequest === 'number'
        ) {
          return { key: parsed.key, count: parsed.count, lastRequest: parsed.lastRequest };
        }
        return null;
      } catch {
        return null;
      }
    },
    async set(key, value) {
      await client.set(prefix + key, JSON.stringify(value), 'EX', ttl);
    },
  };
}
