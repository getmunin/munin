---
'@getmunin/backend-core': minor
---

Move MCP burst protection from `rate_limit_counters` to an in-memory token bucket per replica. `McpBurstGuard` enforces `MUNIN_MCP_BURST_PER_MIN` (default 60) per `(org_id || ip)` within a rolling minute window, throwing 429 on overflow. `RateLimitService.consume()` no longer bumps a `mcp_calls_minute` bucket; that bucket and its check are removed, along with `OrgLimits.perMinute` and the per-minute view in `usage()`. The daily cap is unchanged.

Trade-off: multi-replica fleets no longer enforce a fleet-global per-minute cap — each pod independently allows up to `MUNIN_MCP_BURST_PER_MIN`. Adequate for runaway-agent protection (abusers don't load-balance themselves) and eliminates ~1440 rows/day/org of accumulating minute-bucket data.

Breaking shape change: `/v1/usage` no longer returns a `minute` field. Dashboard and any consumer scripts that read it need to drop that key.
