---
'@getmunin/backend-core': minor
---

Strip SaaS-flavored code from `@getmunin/backend-core`'s quotas surface. The OSS module is now an abstract `QuotasService` (`assertCanAdd`, `recordCall`) plus a `DefaultQuotasService` that no-ops both. All tier numbers, the `MUNIN_QUOTAS_ENABLED` switch, the `FREE_TIER_QUOTAS` map, the `TABLE_FOR` row-count helpers, and the `cap` / `count` abstract methods are gone — those belong to whoever runs the SaaS, not to the OSS library.

Concretely:

- `QuotaCallKind` type removed (was `'mcp_tool' | 'api_request'` — cloud billing vocabulary). `recordCall(kind, key?)` now takes `kind: string`.
- `cap()` and `count()` removed from the abstract — only `CloudQuotasService` used them, and it still has them as concrete methods on the subclass.
- `DefaultQuotasService.assertCanAdd` is a no-op (previously executed row counts when `MUNIN_QUOTAS_ENABLED=true`).
- `MUNIN_QUOTAS_ENABLED` env var no longer read; removed from `.env.example`.

Coordinated cloud change: `@munin-cloud/quotas` must replace `import type { QuotaCallKind } from '@getmunin/backend-core'` with its existing local `CallKind` union from `@munin-cloud/plans` (or just `string`), and delete the now-pointless `_CallKindMatchesBackend` compile-time assertion. The existing `CloudQuotasService` row-count and tier logic continues to apply unchanged — it's just no longer a partial duplicate of code that was shipping in OSS.
