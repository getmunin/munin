---
'@getmunin/backend-core': patch
'@getmunin/agent-runtime': patch
'@getmunin/dashboard-pages': patch
---

A public reply now retires the pending handover draft, and every conversation opens in one drawer that shows the whole thread.

An agent that answers and escalates in the same turn writes its `suggestedReply` before the public reply goes out. The runtime used to clear that draft only when the two strings matched exactly, so a paraphrase survived: the customer had already been answered, but the dashboard still opened with the near-identical draft loaded in the composer, one keypress from a duplicate message.

The rule is now structural and lives in `ConvService.sendMessage`, where it holds for every MCP host and for humans too: a draft is a proposal for the *next* outbound message, so any public message from an agent or a teammate retires it to `metadata.kind: 'draft_reply_superseded'` with a `supersededByMessageId` link. The row stays in the API for audit, the composer stops offering it, and `preserveAttention` still keeps the conversation flagged for a human. The runtime's string comparison is gone, and both `conv_request_handover` and `conv_request_human` state the retirement rule in their descriptions.

The dashboard's two conversation drawers are now one. A flagged conversation used to open a review drawer showing the last customer message and a draft with no surrounding thread — while the same conversation opened as a full chat from the recent-conversations list. The merged drawer always renders the thread — minus drafts, which belong in the composer rather than the transcript, so a retired suggestion no longer shows up as an internal note next to the near-identical reply that retired it — and a pending draft prefills the composer under an "ai suggestion · edit before sending" banner with a discard action, so the operator sees what the agent already said before deciding what to add. Sending keeps passing `fromDraftId`, so an unedited approved draft still queues no curation pass and an edited one still curates the delta.

Sending no longer claims the conversation implicitly — **Take over** is now the only thing that claims it. The live card marks conversations the agent has already answered since the customer's last message.
