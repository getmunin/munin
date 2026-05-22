import { describe, expect, it } from 'vitest';
import { Redis } from 'ioredis';
import { createRedisRateLimitStore } from './better-auth-redis-store.js';

const REDIS_URL = process.env.TEST_REDIS_URL;
const itIfRedis = REDIS_URL ? it : it.skip;

describe('createRedisRateLimitStore', () => {
  itIfRedis('persists a rate-limit entry across get() calls', async () => {
    const client = new Redis(REDIS_URL!);
    try {
      const store = createRedisRateLimitStore({
        client,
        keyPrefix: `munin:test:${Date.now()}:`,
      });

      const key = `probe:${Math.random()}`;
      expect(await store.get(key)).toBeNull();

      await store.set(key, { key, count: 1, lastRequest: 1779000000000 });
      const first = await store.get(key);
      expect(first).toEqual({ key, count: 1, lastRequest: 1779000000000 });

      await store.set(key, { key, count: 2, lastRequest: 1779000060000 });
      const second = await store.get(key);
      expect(second).toEqual({ key, count: 2, lastRequest: 1779000060000 });
    } finally {
      await client.quit();
    }
  });

  itIfRedis('returns null when the entry is missing', async () => {
    const client = new Redis(REDIS_URL!);
    try {
      const store = createRedisRateLimitStore({
        client,
        keyPrefix: `munin:test:${Date.now()}:`,
      });
      expect(await store.get('does-not-exist')).toBeNull();
    } finally {
      await client.quit();
    }
  });

  itIfRedis('returns null when stored JSON is malformed', async () => {
    const client = new Redis(REDIS_URL!);
    try {
      const prefix = `munin:test:${Date.now()}:`;
      await client.set(`${prefix}corrupt`, '{not-valid-json', 'EX', 60);
      const store = createRedisRateLimitStore({ client, keyPrefix: prefix });
      expect(await store.get('corrupt')).toBeNull();
    } finally {
      await client.quit();
    }
  });
});
