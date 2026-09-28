---
'@getmunin/backend-core': minor
'@getmunin/agent-runtime': minor
'@getmunin/agent-host': minor
'@getmunin/dashboard-pages': minor
---

Ask for a draft from a rough note. Whatever a teammate has typed in the reply box when they click "Draft from my note" goes to the agent as their instruction. The agent turns the note into a finished reply in the customer's language and fills in the rest from the conversation and its tools.

- `POST /v1/conversations/:id/request-draft` takes an optional `note` (max 4000 characters). It rides on the `conversation.draft_requested` event, so both the in-process runner and external runtimes on the realtime socket receive it. With a note, a draft can be requested even when the customer did not write last.
- In the draft, the agent wraps anything it added beyond the note in `[[…]]` and marks each fact it could not find as `{{…}}`. `setDraftReply` strips the markup: the draft `body` is clean text with each missing fact rendered as `[LABEL]`, and `metadata` keeps `annotated` (the marked-up original), `slots` and `note`. Placeholders the agent is asked to write change from `[ORDER STATUS]` to `{{ORDER STATUS}}`, but what the reviewer sees is unchanged.
- Sending a draft (`fromDraftId`) while any of its slots is still in the text fails with `conv_draft_slots_open`, and the composer holds Approve & send until they are filled in. Once sent, the note is kept on the `approvedDraft` stamp and shown under the message in the thread.
- Rejecting a draft puts the note back in the reply box, so it can be edited and asked again.
