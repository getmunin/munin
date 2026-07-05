---
'@getmunin/backend-core': minor
---

Slack integration phase 2: reply from the thread

Operators reply to customers directly from a mirrored Slack thread. A signed Events API receiver (`POST /v1/slack/events`, v0 HMAC over the raw body, ±5 min replay window) resolves `(channel, thread_ts)` to the conversation and records the reply through `ConvService.sendMessage()` as the mapped org member — outbound delivery, claim, and attention semantics match the dashboard. A leading `!` keeps the reply as an internal note.

Attribution is by Slack-profile-email ↔ org-member match, cached in `slack_user_links` and re-checked against current membership. Unmapped users are rejected with an ephemeral notice; nothing is recorded or sent. Loop prevention is atomic: the `slack_message_links` row commits in the same transaction as the message, so the mirror worker never re-posts a Slack-authored reply and redelivered events dedupe on the `(channel, ts)` unique index.

The Slack app manifest gains the `channels:history` bot scope and a `message.channels` event subscription; `SLACK_SIGNING_SECRET` is now required for reply-from-Slack. Workspaces installed before this need a reinstall to grant the new scope.
