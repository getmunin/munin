---
'@getmunin/backend-core': patch
'@getmunin/dashboard-pages': patch
'@getmunin/db': patch
---

Journey runs recover from errors, races and pauses instead of spinning or sending at the wrong time.

- **Step errors end the run.** Each step runs in its own savepoint, so a step that throws rolls back alone and the steps before it stay done. The run retries after 1, 5, 15 and 60 minutes and ends with `step_failed` after five errors in a row, where it used to retry every minute forever. Enrollments carry `stepErrors` and `lastError`; the trace shows the last error, and the guardrail monitor counts `step_failed` as a failed step.
- **Scheduled segment entry pages by id.** Members that are skipped (at the concurrency cap, say) are passed over instead of selected again on every tick.
- **Publishing is race-free.** Requesting and confirming a publish lock the journey and only write a version that is still unpublished with the reviewed spec and fingerprint; editing a draft no longer writes into a version published meanwhile.
- **Pauses hold, never fail.** An approved journey message whose step or journey is paused is held and checked again every 15 minutes, where a paused journey used to fail it.
- **Archiving ends runs.** Open runs of an archived journey end with `journey_archived`, their unsent messages are withdrawn and their approvals expire. Every run that ends now expires its pending approvals, closes its open steps (`cancelled`) and clears its current step.
- **Replies are applied under a lock**, re-reading the run first, so a reply racing a step no longer moves an ended run, and the step it interrupts is closed.
- `exit.idleDays` now measures time without progress: the deadline moves on every step.
- A person journey waiting on a company journey now resumes when the company run ends (`journey.exited` carries `companyId` and `parentEnrollmentId`), and a sub-journey that fails to start no longer breaks the parent's step.
- Trace retention drains in ordered batches and stops reselecting runs whose split records it keeps.
- The journey event sink skips the inbox for orgs with no live or paused journey (`journeys_org_running()`, readable from end-user requests), and branch conditions read at most as many events per name as the rule counts.
- Migration `0141_journey_runtime_hardening` adds `journey_enrollments.step_errors`, `journey_enrollments.last_error` and `journeys.entry_cursor`.
