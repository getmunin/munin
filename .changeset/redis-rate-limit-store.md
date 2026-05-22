---
'@getmunin/backend-core': minor
---

Add `createRedisRateLimitStore(...)` — a `RateLimit`-storage adapter compatible with better-auth's `rateLimit.customStorage` option, backed by an `ioredis` client. Lets multi-instance backends (e.g. autoscaled cloud deployments) share rate-limit counters across replicas instead of each replica counting only its own traffic.

`ioredis` is an **optional peer dep** — consumers that don't use Redis-backed rate limiting don't need to install it. The store reads/writes JSON-encoded entries (`{ key, count, lastRequest }`) with a configurable TTL (default 1h, key prefix `munin:rate-limit:`).

Usage:
```ts
import { Redis } from 'ioredis';
import { createRedisRateLimitStore } from '@getmunin/backend-core';

const client = new Redis(process.env.MUNIN_REDIS_URL!);
const auth = betterAuth({
  rateLimit: {
    storage: 'custom',
    customStorage: createRedisRateLimitStore({ client }),
    customRules: {
      '/sign-in/email':       { window: 60, max: 5 },
      '/sign-up/email':       { window: 60, max: 3 },
      '/forgot-password':     { window: 60, max: 3 },
    },
  },
  // …
});
```
