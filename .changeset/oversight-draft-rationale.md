---
'@getmunin/agent-runtime': minor
'@getmunin/backend-core': minor
'@getmunin/agent-host': patch
---

Draft rationale and on-demand drafting for the Oversight review pane. The audit pass's JSON contract gains a `rationale` field — one or two sentences written for the human reviewer stating what the reply asserts and what grounds it — and the conversation handler parks it (plus the tool names of the turn) on the `draft_reply` metadata via `setDraftReply`, so the pane's "why" block reads straight off the draft and simply hides when no rationale is present. The runner now also answers `conversation.draft_requested`: a new `draft-request` handler mode forces draft delivery even on `auto` conversations and tolerates the requester's own claim, completing the "Ask for a draft" round trip started by `POST /v1/conversations/:id/request-draft`.
