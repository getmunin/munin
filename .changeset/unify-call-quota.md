---
'@getmunin/backend-core': patch
---

Unify call-quota and rate-limit storage on a single table (`rate_limit_counters`) and fix a dead-code interceptor bug. `CallQuotaInterceptor` was registered as a global `APP_INTERCEPTOR`, which placed it outside the `TenancyInterceptor`'s context store — its `getCurrentContext()` check always threw and the underlying `QuotasService.recordCall` was never invoked in production. The cloud `api_request` quota was therefore not enforced at all.

The `'api_request'` bump now lives in `AuditInterceptor` (which runs inside tenancy), so cloud's `recordCall` impl actually fires. The bucket registry in `RateLimitService` gains a `'month'` granularity and two month buckets (`api_calls_month`, `mcp_calls_month`) so the cloud `QuotasService` override can switch to `rate_limit_counters` and the OSS `org_call_counters` table can be retired in the matching cloud PR. `CallQuotaInterceptor` and the related export are removed; cloud must drop its `APP_INTERCEPTOR` registration in the coordinated cloud release.
