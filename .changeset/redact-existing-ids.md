---
'@getmunin/backend-core': minor
---

Add `conv_redact_existing_messages` to apply a redaction policy to history.

Configuring redaction only affects messages that arrive afterwards. This applies the same rules to what is already stored, one batch at a time, oldest first, driven by a cursor until `done`. It rewrites only messages that actually contain a match and emits `conversation.message.body_revised` so mirrored copies in Slack re-sync.

Deliberately a tool, not a migration. A deploy that silently rewrote every tenant's message history is not something you would want to discover afterwards, and the decision to destroy the originals belongs to the operator who has read what it cannot reach: attachments, replies already sent, and Slack messages already posted.
