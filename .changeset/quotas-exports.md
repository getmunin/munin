---
'@getmunin/backend-core': patch
---

Export the tier-aware quota primitives so cloud builds can override the service.

Adds `QUOTAS_SERVICE` (DI token), `QuotasService` (abstract base), `DefaultQuotasService` (default impl), `QuotaExceededError`, the `QuotaResource` and `QuotaCallKind` types, and `CallQuotaInterceptor` to the public surface of `@getmunin/backend-core`. The implementations shipped in 4.23.0; only the index barrel changes here.
