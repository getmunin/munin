---
'@getmunin/backend-core': patch
'@getmunin/agent-runtime': patch
---

Stop the staff handover draft from just repeating the bot's public deferral.

When the self-service bot escalated a conversation it couldn't answer, it often filled `suggestedReply` with the same "a teammate will follow up" message it sent the end user, so the dashboard draft ("Your answer") just parroted the public reply. The handover tool descriptions now tell the model to pass `suggestedReply` only when it has a substantive answer (and to omit it otherwise), and the conversation runner deletes the draft when it merely repeats the public reply via a new `POST /v1/conversations/:id/clear-draft` route (`ConvService.clearDraftReply` / `MuninRestClient.clearDraftReply`).
