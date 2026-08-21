---
'@getmunin/backend-core': minor
'@getmunin/agent-runtime': minor
'@getmunin/dashboard-pages': minor
'@getmunin/core': minor
---

KB curation now triggers on what a human changed in an agent draft, not on the fact that they sent it.

In `draft_only` mode the runtime hands over on every turn, so every approved reply resolved a handover and queued a curation pass. The draft had been assembled from the KB by `kb_search`, so the pass kept proposing documents built out of information the KB had just supplied — a near-duplicate of whatever document fed the draft.

Sending a draft from the dashboard now passes `fromDraftId`. The backend looks that draft up, compares the two bodies itself (whitespace-normalised, so a reflow is not an edit) and stamps `metadata.approvedDraft` — `{ draftMessageId, draftBody, edited, retrievedDocumentIds }` — on the sent message. An unedited approved draft queues no pass at all: it is positive evidence the KB already covered the question. An edited one queues a pass in delta mode, pointed at the draft and the sent message so it curates the change rather than the reply. A human answering without going through a draft is unchanged, and still curates as a gap.

The draft the human sent is retired to `metadata.kind: 'draft_reply_sent'` with a link to the message it became, instead of being deleted by the next draft — so the before/after pair survives in the thread. The runtime also records which KB documents it retrieved while drafting (`kb_search` hits, capped at 8), which is what lets a later edit be traced back to the document that carried the wrong fact.

`skill://kb/review-content` gained a delta mode with a classification table: formatting, tone and personalisation edits file nothing; a changed fact, an added caveat or a withdrawn claim file one candidate covering the change alone.
