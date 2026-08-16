---
'@getmunin/backend-core': patch
'@getmunin/agent-host': patch
---

Drain the curator queue to empty, and spread scheduled sweeps across the fleet

A curator backlog could sit untouched for hours and then run all at once. Two causes, both fixed here.

`triggerPoll` drops a trigger while a poll is already in flight, and `pollOnce` claimed exactly one job per trigger. So when the scheduler enqueued four sweeps for an org in the same second, four `curator_job.pending` events arrived, the first started a poll, and the other three were swallowed — one job ran and the rest waited for something to poll again. Nothing does, until the next realtime reconnect. In practice that meant a restart: jobs enqueued at 00:00 were observed starting at 06:38 the same morning, still on `attempt 1/5`, for every org at once.

The poll loop now keeps claiming until the queue comes back empty (`drainCuratorQueue`), so a burst of enqueues drains steadily instead of pooling. It re-checks `beforeGenerate` between jobs, so a host that revokes permission mid-drain — a quota gate, a rate limiter — is honoured on the next job rather than after the whole backlog. It stops early on a provider error, since the next job would only fail the same way, and pauses after 25 jobs so one org's backlog can't monopolise a shared provider; the remainder is re-queued behind the other orgs.

The other cause is the scheduler itself: `runSweep` walked every org and enqueued with the same `next_attempt_at`, so an entire fleet's weekly sweep landed on one instant. Sweeps now spread their enqueues over a window that scales with fleet size (60s per org, capped at 4h) — a single-org deployment is unaffected, a 100-org fleet spreads over ~99 minutes. Retry backoff in `fail()` gained the same treatment: it was `30s · 2^attempts` with no jitter, so jobs that failed together retried together forever. It is now multiplied by a random 1–2×.
