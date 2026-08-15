---
'@getmunin/backend-core': minor
'@getmunin/types': minor
---

Give email open tracking a read surface.

Opens have been recorded since the tracking pixel landed — `conv_message_deliveries`
carries `first_opened_at`, `last_opened_at` and `open_count` — but nothing read them
back. The pixel controller was the table's only reader, so the data was write-only:
unreachable from MCP, the control plane and the dashboard alike.

Three changes close that:

- `conv_get_conversation` now returns `firstOpenedAt`, `lastOpenedAt` and `openCount`
  per message, mirroring how the widget's `seenAt` read receipt is already surfaced.
  `openCount` is `null` when the message has no delivery row at all (inbound, internal,
  or a non-email channel) and `0` when it was emailed but never opened — the two cases
  mean different things when reporting, so they stay distinguishable.
- New `conv_get_email_open_stats` tool aggregates deliveries per email channel over a
  window (default 30 days): messages sent, how many were opened at least once, total
  opens, and the open rate, plus org-wide totals. Each row carries the channel's
  `trackOpens` flag, because a channel with tracking off reports a 0% rate that would
  otherwise read as "nobody opened these".
- `conversation.message.opened` is added to the event-type catalog. The pixel has been
  emitting it all along, but it was absent from `webhooks_list_event_types` and the
  `skill://webhooks/subscribe-to-events` docs, so the only way to subscribe was to guess
  the string. `conversation.message.read` (widget read receipts, emitted by the realtime
  gateway) and `cms.entry.archived` (emitted alongside the already-listed `unpublished`
  and `scheduled` transitions) were missing for the same reason and are now listed too.

Also adds `skill://conv/track-email-opens`, which documents enabling `trackOpens`,
reading both surfaces, and the under- and over-counting that pixel tracking carries
(blocked images, Apple Mail Privacy Protection pre-fetch) — those caveats belong next to
the numbers, not in a commit message.
