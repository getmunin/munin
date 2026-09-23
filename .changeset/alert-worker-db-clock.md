---
'@getmunin/backend-core': patch
---

Judge alert-notification due-ness by the database clock, not the app server's.

A notification's `next_attempt_at` defaults to Postgres `now()` when the sink enqueues it, but
the worker compared it against `new Date()` from Node. Whenever the app clock trailed the
database — a Docker Desktop VM drifting after the Mac sleeps, or ordinary skew between an app
instance and the database host — a fresh notification was not yet "due", so it waited a full
poll interval before sending. That also made `alert-notification.integration.test.ts` flaky:
the tests that tick immediately after enqueueing failed, and both retries failed together while
the drift lasted.

The worker now compares against `now()` and writes `delivered_at` and the retry backoff from the
database clock too, so every timestamp in the table comes from one clock.
