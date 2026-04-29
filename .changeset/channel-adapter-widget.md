---
'@getmunin/backend-core': minor
'@getmunin/db': minor
'@getmunin/core': minor
---

Channel-adapter contract + chat-widget adapter.

Generalizes the conversation channel runtime: a single `ChannelAdapter`
interface (poll / webhook / push inbound modes), generic `InboundPollWorker`
and `OutboundDeliveryWorker` that dispatch by `conv_channels.type`, and a
`POST /api/channels/:id/webhook` scaffold for future webhook-mode adapters
(SMS, voice). Email is refactored behind the new contract — no behavior
change; the existing email integration test passes unchanged.

New chat-widget channel kind for external AI agents (chat widgets on
customer sites) to push transcripts into Munin's `conv_*` tables. Includes:

- `mn_widget_*` API key kind, channel-bound via new nullable
  `api_keys.channel_id` column.
- `POST /api/conv/widget/messages` — public ingest endpoint authenticated
  by the widget key. Idempotent on `metadata.providerMessageId`; conv
  upsert by `metadata.sessionId`.
- MCP admin tools: `conv_widget_create_channel`, `conv_widget_rotate_key`,
  `conv_widget_update_channel`.

Schema changes:
- New `conv_inbound_state(channel_id, cursor jsonb, ...)` replaces the
  email-only `conv_email_inbound_state`. Existing rows backfilled.
- `api_keys.channel_id` (nullable, FK to `conv_channels`).
- Two partial unique expression indexes for widget idempotency.

The email worker env vars `MUNIN_EMAIL_INBOUND_WORKER_DISABLED` and
`MUNIN_EMAIL_OUTBOUND_WORKER_DISABLED` are still honored as aliases of
`MUNIN_INBOUND_POLL_WORKER_DISABLED` and `MUNIN_OUTBOUND_DELIVERY_WORKER_DISABLED`.
