---
'@getmunin/backend-core': patch
'@getmunin/dashboard-pages': patch
'@getmunin/inspector-app': patch
'@getmunin/db': patch
---

Make a dismissed KB curation candidate stay dismissed.

Candidates are `kb_documents` rows that are deleted on dismiss and on publish, and the only thing stopping a curation pass from refiling a source conversation was a candidate still sitting in `kb-curation-inbox`. Empty the inbox — review a batch, publish two, dismiss the rest — and the next weekly sweep redrafts the same conversations from scratch. That happened in production: candidates reviewed on 26 July came back on 2 August, six weeks after the conversations themselves.

`kb_curation_decisions` records one row per decision (`dismissed` or `published`) with the reason, the deciding actor, and the published document when there is one. Rows outlive the candidate and the source conversation. `kb_propose_curation_candidate` now pre-checks the source conversation and throws `kb_curation_decided` when one exists, so the gate is enforced in the service rather than described in the skill — the "last 7 days" and "resolved handovers only" rules were prose-only, and the sweep that produced those drafts honored neither.

Blocking is coarse and permanent, matching `crm_merge_proposals`: one decision retires the whole conversation, and there is no un-dismiss. Title matching would lose to rewording — the June and August drafts of the same answer had different titles. Something genuinely new from a decided conversation goes in with `kb_create_document`.

New tools: `kb_dismiss_curation_candidate` (deletes the draft, records the decision, takes an optional `reason` and the reviewed `ifVersion`) and `kb_list_curation_decisions` (filter by `outcome` or `sourceConversationId`). Dismissing with `kb_delete_document` still records a reasonless decision, so the Slack button, the dashboard drawer and the Inspector panel are all covered by the same choke point in `removeDocument`.

`POST /v1/kb/curation/candidates/:id/dismiss` accepts `reason` and `ifVersion`; `KbCurationDecidedError` maps to a 409 there. The dashboard drawer and the panel now say the dismissal is permanent.
