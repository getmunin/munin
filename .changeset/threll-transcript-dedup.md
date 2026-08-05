---
'@getmunin/backend-core': patch
'@getmunin/db': patch
---

Fix two voice channel bugs found while testing Threll:

- Phone calls stored every transcript turn twice. Threll redelivers the full call transcript as a burst of `call.transcript` events shortly after the live turns already streamed in, with no signal distinguishing the redelivery from the original. `ThrellAdapter` now dedupes voice messages on insert via a partial unique index on `(conversation_id, threllCallId, voiceTurnIndex, threllRole)`, so a redelivered turn is dropped instead of creating a second `conv_messages` row — and a second copy mirrored into Slack. The migration also collapses turns already duplicated on existing deploys, keeping the earliest copy of each.
- A voice call that auto-closed on hangup still looked open everywhere except the dashboard. Both voice adapters closed the conversation with a raw `UPDATE` and emitted only `conversation.voice.call_ended`, which no operator bridge consumes: `conversation.status_changed` never fired, so the Slack thread parent kept rendering the open state with a "Close" button until someone clicked it, and the `skill://crm/extract-contact-from-message` pass that every other close enqueues never ran for voice — the channel most likely to have a name or email volunteered out loud. `ThrellAdapter` and `VapiAdapter` now write call metadata and then route the status transition through `ConvService.changeStatus`, so an auto-close emits the same events, clears human-attention state, releases the runner lease, and enqueues the same follow-up job as a manual close.
