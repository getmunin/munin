---
"@getmunin/core": minor
"@getmunin/db": minor
"@getmunin/types": minor
"@getmunin/sdk": minor
"@getmunin/mcp-toolkit": minor
"@getmunin/bootstrap": minor
"@getmunin/ui": minor
"@getmunin/dashboard-pages": minor
"@getmunin/backend-core": minor
"@getmunin/agent-runtime": minor
"@getmunin/agent-host": minor
---

Email channel polish, read tracking, and agent-model tier rename.

**Email channel (#136, #140)**

- New "Send test email" action in the channel dropdown — opens a dialog
  prefilled with the logged-in user's email, sends via the channel's real
  outbound transport.
- SMTP/IMAP networking: force IPv4 DNS resolution at backend startup
  (fixes `EHOSTUNREACH` on hosts with broken IPv6 routing); auto-pick TLS
  mode by port (465 implicit, 587/25/2525 STARTTLS).
- SMTP error surfacing: readable messages for `EAUTH` / `ECONNECTION` /
  `EENVELOPE` plus the server's response text, replacing generic
  "Internal error".
- Inbound mail now creates an `end_users` row keyed
  `external_id = email:<addr>` and links the contact; agent runtime no
  longer skips conversations with "no end-user bound".
- Inbound dedupe on RFC-5322 `Message-ID` — defense-in-depth against
  cursor failures, UIDVALIDITY changes, restored backups.
- IMAP poll fixes: cursor read/write use `app.bypass_rls=on`; fetch by
  UID range instead of sequence numbers; per-tick logging.
- Strip quoted reply blocks (multi-language) AND signatures (RFC 3676 +
  mobile-client openers + common separators) before persisting inbound
  bodies. Nested-quote prior 3 messages in outbound replies; add `Re:`
  prefix when missing.

**Read tracking (#137, #139)**

- New `conv_message_reads` table; chat widget reports agent messages as
  read when they enter the viewport (`IntersectionObserver` + 200 ms
  coalesce window). Backend gateway handles the `read` WS frame,
  inserts with `ON CONFLICT DO NOTHING`, emits
  `conversation.message.read` webhook per new row.
- Email open pixel: opt-in per channel (`trackOpens` flag), HMAC-signed
  token, `GET /api/v1/c/o/:token.gif` endpoint returns a transparent
  GIF and bumps `first_opened_at` / `last_opened_at` / `open_count` on
  `conv_message_deliveries`. Emits `conversation.message.opened` on
  first open.
- Operator-side "Seen HH:MM" badge under outbound messages in the
  dashboard conversation drawer. Live-updates through the existing
  realtime hook on `conversation.message.read` events.

**Model tier rename (#141)**

- `chatModel` → `fastModel`, `curatorModel` → `smartModel` across
  `agent_config` schema, types, controllers, dashboard form, and i18n
  strings. Capability tiers instead of use-cases — every code path
  picks the right tier without adding a new column per feature.
- Idempotent `ALTER COLUMN RENAME` in both DDL strings handles
  existing databases.
- Dashboard form now shows example use-cases under each field.

**Schema migrations**

- `0020_conv_read_and_open_tracking.sql` — `conv_message_reads` table
  + `first_opened_at` / `last_opened_at` / `open_count` columns on
  `conv_message_deliveries`.
- `agent_config` `chat_model` → `fast_model`, `curator_model` →
  `smart_model` (idempotent rename inside the agent-host DDL).
