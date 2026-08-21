---
'@getmunin/backend-core': minor
'@getmunin/dashboard-pages': minor
'@getmunin/inspector-app': minor
'@getmunin/types': minor
'@getmunin/ui': minor
'@getmunin/db': minor
---

A curation candidate can now propose a new version of a document that already exists, instead of only a new document beside it.

`kb_propose_curation_revision` files a proposed body against an existing `documentId`; `kb_publish_curation_revision` applies it as a new version of that document, so `kb_list_versions` and `kb_restore_version` roll a bad revision back. It takes two versions — the candidate text that was reviewed and the document text it was diffed against — and refuses if either moved, writing nothing. `kb_publish_curation_candidate` refuses a revision candidate rather than quietly publishing a duplicate.

This is what a corrected fact should produce. A human editing an agent draft usually contradicts a document the draft was built from, and the old flow could only file a new FAQ beside the stale one, leaving the wrong text in place for the agent to retrieve again.

Revisions share one review queue with new-document candidates: `kb_list_curation_candidates` carries `revisesDocumentId` plus the revised document's current title and version, and each surface branches per row — the dashboard drawer and the MCP Apps panel render a diff against the current text (new `BodyDiff`, backed by a dependency-free line differ in `@getmunin/types`), the control plane gains `POST /v1/kb/curation/candidates/:id/publish-revision`, and Slack shows the card without a publish button, since its approval value carries only one version. The panel's "loading" state for a candidate body was also unreachable — it reported a load failure while the fetch was still in flight.

Curation decisions are now keyed by conversation **and** source message (`kb_curation_decisions.source_message_id`). One conversation can legitimately surface several corrections across turns; the old conversation-wide key closed it to curation after the first. Decisions recorded before this keep the whole-conversation lock, so nothing already dismissed reopens. Related: `kb_propose_curation_candidate` accepted `sourceMessageIds` and silently dropped it — the first entry is now persisted.

`skill://kb/review-content` delta mode now prefers a revision over a new document and says how much to change; `kb_get_document`, `kb_list_curation_decisions` and `kb_propose_curation_revision` are added to the skill's runner allow-list. The skill's step 0 has always required `kb_list_curation_decisions`, which the runner could not call, so "skip already-decided sources" silently never ran.
