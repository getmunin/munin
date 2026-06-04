---
'@getmunin/backend-core': patch
---

Move the `/v1/usage/summary` apiCalls tile off `audit_log` onto a dedicated `api_calls_day` bucket in `rate_limit_counters`. The `AuditInterceptor` now calls `RateLimitService.record('api_calls_day')` for any non-MCP HTTP request from a non-user actor (mirrors the previous query's filters: skips `HEAD`/`OPTIONS`, `/mcp*`, dashboard browser sessions, and the same chatty polling GETs that audit already skips). The tile is now independent of `audit_log` retention, so month-over-month no longer degrades as old audit rows are pruned. No backfill — existing apiCalls history stays in `audit_log` until it ages out; the tile will show partial data for ~1 month after deploy and recover naturally.
