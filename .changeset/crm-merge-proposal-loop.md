---
'@getmunin/backend-core': patch
---

Fix merged contacts being re-proposed for merge on every dedup pass. `crm_propose_merge` now rejects a pair with `crm_conflict` when either contact carries `customFields.mergedInto` or the pair already has an `applied` proposal on record, so a merge the operator approved stays approved instead of reappearing in the review queue. `crm_apply_merge_proposal` also dismisses any other pending proposals that reference the archived duplicate (reason `contact merged into <keeperId>`), and contact lookup by email/phone (`crm_find_contact`, bulk-create and import dedup) now prefers the surviving row over an archived duplicate. `skill://crm/clean-contact-data` tells the curator to drop merged-away rows from the candidate buffer and to skim applied proposals alongside dismissed ones.
