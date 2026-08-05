---
'@getmunin/backend-core': patch
'@getmunin/chat-widget': patch
'@getmunin/db': patch
---

Show voice transcript turns in the order they were spoken.

Threll redelivers the full call transcript as a burst of `call.transcript` events around `call.ended`, and on a browser voice call that burst is the only delivery — no turns stream in live. Munin handled each webhook the instant it arrived, so nothing was delayed on our side, but `conv_messages.created_at` was left to its `now()` default and so recorded when the webhook was *processed*, not when the turn was spoken. Every read path orders by `created_at`, so a burst that arrived grouped by speaker rendered as every agent turn followed by every caller turn. A real call in the widget produced exactly that.

`ThrellAdapter` now derives `created_at` from the `turnIndex` Threll already sends, anchored to the call's start (`metadata.voiceStartedAt`, falling back to the conversation's own `created_at` for inbound phone calls). `turnIndex` was already being captured into `metadata.voiceTurnIndex` and never read. It also makes the timestamp idempotent across redeliveries: the turn dedup added alongside this keeps whichever copy inserted first, and an arrival-time `created_at` meant that copy decided where the turn sorted. `handleEnded` no longer deletes `voiceStartedAt`: transcripts and `call.ended` arrive in the same burst with retries, so a straggler processed after the call closed would otherwise re-anchor to a conversation that opened days earlier and scatter those turns through the chat history. Nothing reads the field, so keeping it is free.

Backdating `created_at` collided with the widget's incremental fetch, which is the only way a rendered conversation ever gains a message: the realtime event carries no body, it just triggers `backfillSince(lastSeenAt)`, and `lastSeenAt` is a monotonic high-water mark. The "Call ended · 00:36" separator is a real message inserted at real time, so it pushed the cursor past the entire call before the transcript burst landed — and every backdated turn then sat below the cursor and was never delivered at all. Ordering the rows correctly in the database would have traded a scrambled transcript for a missing one.

So `created_at` is now purely the display clock and `conv_messages.ingested_at` (default `clock_timestamp()`) is the arrival clock. The widget's `since` filter and page ordering both move to `ingested_at`, the response carries an explicit `cursor` the client advances instead of inferring one from the last message's `at`, and rows are sorted by `created_at` before serialization. `clock_timestamp()` rather than `now()` because `now()` is fixed for a transaction: a batch that inserts several turns at once — Vapi's end-of-call report does — would tie on the cursor column and let keyset pagination skip rows. The server-computed cursor also advances past a page of internal-only messages, which previously stalled the `while (hasMore)` loop.

`ui.addMessages` inserts by timestamp instead of appending, so a turn that arrives late but was spoken earlier lands in the right place without waiting for a reload.

Existing rows inherit `created_at` as their `ingested_at`. The backfill runs inside a `bypass_rls` block because `conv_messages` is FORCE ROW LEVEL SECURITY, which applies to the table owner too — without it the `UPDATE` matches nothing on a live deploy while a fresh CI database, where the policies are applied only after migrations run, looks green.

Vapi has the same display-ordering defect and is untouched here: `handleEndOfCallReport` inserts every turn of a report inside one transaction, so all of them share a `created_at` and `ORDER BY created_at` breaks ties arbitrarily.
