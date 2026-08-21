---
'@getmunin/backend-core': patch
'@getmunin/db': patch
---

Mirror voice conversations into Slack in turn order, and stop Slack serving a stale cached avatar.

A voice call's Slack thread showed the agent answering questions before they were asked: agent turns were hoisted above the caller turns they replied to, and two consecutive caller lines came out swapped. The stored data was never wrong — `conv_get_conversation` returned the same call in the right order, with `created_at` values already strictly increasing in `metadata.voiceTurnIndex` order.

The order was lost at delivery time. A Slack thread is append-only, so the order the bridge worker drains `slack_deliveries` in *is* the order a reader sees, and the drain ordered by `created_at` — the enqueue time, i.e. when the vendor's webhook arrived. Webhook arrival order is not turn order for a voice transcript: an agent turn finalizes as soon as it is spoken, while the caller turn that prompted it is still being finalized by ASR, so the reply is enqueued first. (The apparent grouping of two agent turns into one block is Slack's own collapsing of adjacent same-username posts — correct behavior applied to a wrong order.)

`slack_deliveries` now carries the mirrored message's own position instead: `order_at` is the message's `created_at` and `order_seq` its `metadata.voiceTurnIndex`, both stamped by the event sink at enqueue time, and the drain's head-of-line gate and `ORDER BY` key on `(order_at, order_seq, created_at, id)`. `voiceTurnIndex` is the authoritative sequence when two turns share a timestamp; leading with `order_at` keeps rows that mirror no message — status changes, assignments, handovers, the voice-call-started note — at the real-time position they happened, rather than pushing every non-turn event to one end of the thread. Existing rows are backfilled from `created_at`, which reproduces the ordering they have today, and non-voice conversations keep ordering by message `created_at`.

On the ingestion side the `turnIndex` fallback used when a transcript event omits one counted every message in the conversation, so it drifted on any non-transcript row and could hand two concurrent turns the same index — which then produced two identical synthetic timestamps. It now takes `MAX(voiceTurnIndex) + 1` over the turns of that call.

Separately, a caller identified only by a phone number still rendered the pre-4.66 single-dot avatar in Slack even though the `user-round` icon shipped weeks ago and the endpoint serves it correctly. Slack's image proxy had cached the old bytes against `/v1/slack/avatars/default.png`, which is sent `cache-control: immutable, max-age=31536000` — so it never re-fetched. Avatar URLs are now content-addressed (`default.<8-hex>.png`), so changing an icon changes its URL; the un-hashed paths keep serving so avatars in already-posted threads don't break.
