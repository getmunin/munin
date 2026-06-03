---
'@getmunin/backend-core': minor
---

Trim audit-log write volume and add retention. The `AuditInterceptor` now skips chatty polling GETs (`/agent-health`, `/agent-config`, `/widget/messages`, `/widget/conversations`, `/inbox`, `/usage/summary`, `/system/alerts` — under both `/v1` and `/api/v1`); non-GET requests on the same paths are still audited. The in-process agent runner no longer records `runner:claimCuratorJobs` ticks. A new `AuditRetentionService` prunes `audit_log` rows daily; window is configurable via `MUNIN_AUDIT_RETENTION_DAYS` (default `30`, set to `off` or `0` to disable) and `MUNIN_AUDIT_RETENTION_CRON` (default `0 3 * * *`).
