---
'@getmunin/backend-core': minor
---

feat(conv): reopen on reply across channels + auto-close conversations waiting on the user

Inbound replies now reopen a `closed`/`snoozed` conversation on every channel, not just the chat widget. A shared `reopenClosedConversation` helper is wired into the email adapter's threaded-reply path (and the widget path now reuses it), emitting `conversation.status_changed` when a conversation actually transitions back to `open`.

A new deterministic backend sweep (`ConvSchedulerService`, hourly by default) auto-closes non-voice conversations that have been waiting on the end-user: open, last public message from an AI agent or human teammate, and idle past a threshold (default 2 days). Closing reuses the existing `changeStatus` path, so it clears human-attention flags, releases the runner lease, emits the status webhook, and enqueues CRM contact extraction — identical to an operator close. Configurable via `MUNIN_CONV_AUTO_CLOSE_CRON`, `MUNIN_CONV_AUTO_CLOSE_DAYS`, and `MUNIN_CONV_AUTO_CLOSE_DISABLED`.
