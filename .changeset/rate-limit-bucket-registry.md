---
'@getmunin/backend-core': patch
---

Refactor `RateLimitService` to a bucket-registry shape: granularity is intrinsic to the bucket (`mcp_calls_minute` → minute window, `mcp_calls_day` → day window), and a new `record(bucket)` primitive performs the upsert and returns the post-bump count without checking limits. `consume()` is unchanged externally but is now a thin recipe over `record` + an inline threshold check — splitting "bump a counter" from "enforce a quota" so future buckets (e.g. metrics-only counters) don't have to choose between borrowing `consume()` and reimplementing the upsert. No behavior change: bucket strings, table layout, error shape, and `usage()` output are identical.
