---
'@getmunin/backend-core': minor
'@getmunin/db': minor
'@getmunin/core': minor
---

Two changes that together unblock running the backend with multiple replicas safely.

### `withSchedulerLock(db, name, fn)` (new helper in backend-core)

Wraps an in-process scheduler tick in a Postgres `pg_try_advisory_xact_lock` so only one replica's tick runs per interval. The lock is transaction-scoped — auto-released on commit/rollback, no connection-pool reuse traps.

Applied to every cron-driven or `setInterval`-driven tick in the codebase:

- `curator-scheduler.service.ts` (4 sweep cron jobs)
- `webhook.worker.ts`
- `cms.schedule.worker.ts`
- `conv/widget/widget-email-fallback.worker.ts`
- `conv/channels/outbound-delivery.worker.ts`
- `conv/channels/inbound-poll.worker.ts`

Each replica still ticks on its own clock; only the replica that wins the per-name lock runs the work. No new infrastructure (Redis, separate worker container) needed — Postgres advisory locks are free and idiomatic.

Public export: `import { withSchedulerLock } from '@getmunin/backend-core'`.

### Postgres-backed rate-limit storage for better-auth

New `auth_rate_limit` table (`@getmunin/db`) backs better-auth's per-endpoint throttling. The auth factory wires it through the drizzle adapter as the `rateLimit` model. Callers opt in by passing `rateLimit: { storage: 'database' }` to `createMuninAuthCore`.

Previously the rate limit lived in an in-memory `Map()` per process — fine for a single replica, but every replica had its own counters at scale > 1, effectively multiplying the configured limit by N.

Migration: `0030_auth_rate_limit` adds the table + key index. No RLS (global, service-role).

### Together

Cloud can now safely set `backend_max_scale > 1` (and OSS multi-process deployments behave correctly behind a load balancer). No behaviour change for existing single-replica deployments.
