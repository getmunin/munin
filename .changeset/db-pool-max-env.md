---
'@getmunin/db': minor
---

**`@getmunin/db` — configurable connection pool size.** `createDb` now accepts a `poolMax` option, and falls back to the `MUNIN_DB_POOL_MAX` env var when none is passed. Lets self-hosters and cloud operators size the per-process pool against their Postgres `max_connections` budget without forking the package. Invalid values (non-positive integers, non-numeric strings) throw at startup so configuration mistakes fail fast instead of silently degrading. Default behavior unchanged — when neither is set, postgres-js' default (10) still applies.
