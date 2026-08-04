---
'@getmunin/backend-core': patch
'@getmunin/dashboard-pages': patch
'@getmunin/inspector-app': patch
---

Bind KB curation publishing to the version that was reviewed.

A curation candidate is an ordinary KB document, `kb_update_document` rewrites its title and body, and `publishCurationCandidate` copies `candidate.title` and `candidate.body` verbatim into the target space. So an agent could rewrite the draft after the review card rendered and the operator's click would publish text nobody read.

`kb_publish_curation_candidate` now requires `ifVersion`, the same optimistic-concurrency argument `kb_update_document`, `kb_delete_document` and `kb_restore_version` already take, and `POST /v1/kb/curation/candidates/:id/publish` takes it in the body. A mismatch throws `KbConflictError`, nothing is written to the target space and the candidate stays in the inbox. The check runs before target-space resolution, so a refused publish no longer auto-creates a space as a side effect.

`KbConflictError` now maps to a 409 in the candidates controller. It was unmapped, so a version conflict on that route surfaced as a bare 500.

The Slack publish button carries the reviewed version in its action value, which the approval codec already had a slot for. Without it the Slack path would have read the current version and passed that back, making the check vacuously true on the one surface where the card can sit unread the longest.

Also fixes the Inspector panel's Dismiss button, which called `kb_delete_document` without the required `ifVersion` and therefore failed schema validation on every click. Both panel actions now use the version of the body the operator actually opened, falling back to the list version. Publish re-lists on a refusal so the operator lands on the current draft with the conflict still shown.
