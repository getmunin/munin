---
'@getmunin/backend-core': minor
'@getmunin/dashboard-pages': minor
'@getmunin/types': minor
'@getmunin/db': minor
---

Outreach keeps the draft as first written when a human edits a proposal, and can feed that edit to KB curation.

`applyRevision` overwrote `draftBody`, so the original text was gone the moment anyone touched it — the proposal recorded that it had been revised, and by whom, but not from what. `original_draft_body` now captures the pre-revision body on the first revision made by a signed-in person; an agent revising its own draft before human review is not a human edit and does not set it. The outreach review drawer renders the two as a diff.

The column is named for the original rather than for who wrote it: proposals are normally drafted by the curator agent, but `proposedByActorType` can be `user`, and then it holds a person's text.

Approving a proposal a human edited can enqueue a delta-mode KB curation pass, gated by a new per-campaign `autoCurateEdits` flag that defaults **off**. Outbound copy is edited mostly for tone, length and personalisation, so this is opt-in per campaign rather than on by default; the pass is told to hold this source to a higher bar and file nothing unless the human corrected a fact about the product or the company. A proposal approved exactly as drafted enqueues nothing, and neither does an edit the human reverted.

`skill://kb/review-content` delta mode now covers both sources — a conversation draft and an outreach proposal — and `outreach_get_proposal` joins the skill's runner allow-list so the pass can read both bodies in one call.
