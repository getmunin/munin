---
'@getmunin/backend-core': minor
'@getmunin/dashboard-pages': minor
---

Show when an outgoing message never reached the customer, and let an operator retry it.

Outbound email and SMS are delivered by `OutboundDeliveryWorker` after `conv_send_message`
returns, so the message row exists in the thread before anything is actually sent. When the
send failed the worker recorded that faithfully — five attempts with exponential backoff,
then `status: 'dead'` plus the provider's error on `conv_message_deliveries` — but nothing
read those two columns back out. `getConversation` joined the delivery table only for
open-tracking, so a message that died after five SMTP authentication failures rendered in
the inbox byte-identical to one that was delivered and read. The only way to learn about it
was to subscribe to the `conversation.message.delivery_failed` webhook and build your own
listener.

Four changes close that loop:

- **`MessageDto` carries the delivery state.** The existing per-message aggregate now also
  reports `deliveryStatus`, `deliveryError`, `deliveryAttempts` and `deliveryNextAttemptAt`.
  A message can have more than one delivery row (the widget email-fallback worker inserts
  one against messages that already have a widget delivery), so the aggregate orders by
  severity — `dead` before `failed` before `queued` before `sent` — and reports the worst
  one, with the error text from that same row rather than an arbitrary one.
- **The thread pane renders it.** A `dead` delivery replaces the "Seen" line with a
  destructive-coloured "Not delivered", the truncated provider error, and a Retry button; a
  `failed` one says it is still retrying and offers no button, because the worker has not
  given up yet. Everything keys off `status`, never off the presence of `deliveryError` —
  a send deferred by the channel's rate limit stays `queued` and parks its reason in that
  same column, and must not read as a failure.
- **`conv_retry_delivery` re-queues a dead delivery** (`POST
  /v1/conversations/:id/messages/:messageId/retry-delivery`), resetting it to `queued` with
  `attempt: 0` and a cleared error so the worker picks it up on its next pass. It
  pre-checks rather than relying on the write failing: a delivery that is not `dead` throws
  `conv_delivery_not_retryable`, and one whose channel has been switched off or archived
  throws `conv_delivery_channel_inactive` instead of burning five fresh attempts on a
  channel that cannot send. Both codes are translated in the dashboard.
- **A permanent failure now opens a `channel_outbound` alert.** That alert source and its
  "open channel settings" CTA already existed in `ALERT_SOURCES` and the banner; nothing
  had ever raised one. The worker opens it against the channel on the final attempt and
  resolves it as soon as anything sends successfully on that channel again.

`skill://conv/recover-failed-deliveries` documents the workflow for agents: read
`deliveryError` before retrying, since a `550 Recipient address rejected` is a verdict
rather than a hiccup and needs a corrected contact and a new message, not a retry.
