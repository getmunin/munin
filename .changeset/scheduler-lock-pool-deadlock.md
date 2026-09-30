---
'@getmunin/backend-core': patch
'@getmunin/db': patch
---

Stop simultaneous scheduler ticks from deadlocking the database pool.

`withSchedulerLock` holds a transaction for the advisory lock while the tick does its work through the same pool. When as many ticks fired at once as the pool had connections — typically when a host wakes from sleep and every interval is overdue — each tick held a connection and waited for another, and the pool stayed stuck for good. Every authenticated request then hung behind it.

At most a third of the pool (at least one connection) now holds a scheduler lock at a time; a tick that finds every slot taken is skipped, just as it is when another replica holds the lock, and runs on its next interval. `@getmunin/db` exports `resolvePoolMax` so the cap follows `MUNIN_DB_POOL_MAX`.
