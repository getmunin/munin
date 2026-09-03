---
'@getmunin/backend-core': patch
'@getmunin/dashboard-pages': patch
---

Scope the Threll webhook subscription to the selected worker

Munin registered its Threll webhook without a `workerId`, so the subscription was account-wide: every worker on the account delivered `call.worker_request`, transcripts and tool calls into one Munin channel, and a second Munin channel on the same account could only be connected by deleting the first one's subscription. Threll supports worker-scoped subscriptions (worker-scoped wins over account-wide for sync events), so Munin now passes `workerId` on create, lists subscriptions filtered to that worker, and only treats a same-worker subscription pointing elsewhere as a conflict — a customer's own account-wide webhook is left alone. One Threll account can now back several Munin channels, one per worker.

Repointing a channel at a different worker (or account) re-registers the subscription on the new worker and deletes the old one, and re-saving credentials for an unchanged channel replaces its own stale subscription instead of failing Threll's one-responder-per-sync-event check.

Existing channels keep their account-wide subscription until their worker is changed or their credentials are re-entered; delete the account-wide subscription in Threll and re-save the channel to move it over.
