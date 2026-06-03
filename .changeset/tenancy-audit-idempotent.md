---
'@getmunin/backend-core': patch
---

`TenancyInterceptor` and `AuditInterceptor` are now idempotent across nested invocations. Previously, if either was registered both globally (via `APP_INTERCEPTOR`) and per-controller (via `@UseInterceptors`) — as can happen when a downstream backend composes the OSS module — every authenticated request would open a second `db.transaction` and write a duplicate audit row. The second transaction acquired a separate pool connection that sat in `BEGIN` for the lifetime of the request, capping useful concurrency well below the configured pool size. The guards short-circuit on a second pass: `TenancyInterceptor` skips when `RequestContextStore.getStore()` is already populated; `AuditInterceptor` skips when the request was already audited.
