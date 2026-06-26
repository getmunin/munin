---
"@getmunin/backend-core": patch
"@getmunin/dashboard-pages": patch
---

Dashboard: replace the single "last conversation" widget with "Last open conversations" — the 20 most recently active open conversations, newest first, with closed/snoozed/spam filtered out.

Conversations: add a snooze-wake worker that reopens snoozed conversations once their `snoozeUntil` elapses, flagging them as needing human attention so they resurface in the inbox. Previously `snoozeUntil` was stored but never honored, so timed snoozes never woke on their own.
