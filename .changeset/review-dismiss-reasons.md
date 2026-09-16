---
'@getmunin/backend-core': minor
---

`feedback_dismiss` takes an optional `reason`, matching `crm_dismiss_merge_proposal`, `outreach_dismiss_proposal` and `kb_dismiss_curation_candidate`. Both feedback tools now return a meaningful object (`{ dismissed, id }` / `{ approved, id }`) instead of a bare `{ ok: true }`, and their descriptions say the item is kept as the record of the decision rather than deleted.

`skill://kb/review-content` and `skill://outreach/review-proposals` explain where a dismissal reason ends up: the dashboard's Decided tab, which keeps the last 30 days of decisions from every review queue.
