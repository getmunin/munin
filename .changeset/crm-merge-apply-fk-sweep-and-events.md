---
'@getmunin/backend-core': minor
---

`crm_apply_merge_proposal` now atomically reassigns the duplicate's activities (`crm_activities.contact_id`), deals (`crm_deals.primary_contact_id`), and contact-typed relationships (`crm_relationships.from_id`/`to_id` where the type is `contact`) onto the keeper inside the same transaction. The duplicate's `endUserId` transfers to the keeper if the keeper had none; otherwise it's cleared on the duplicate. The previously-documented limitation that "activities and deals stay on the original contactId" is gone.

Adds webhook + realtime events for merge proposals: `crm.merge_proposal.proposed`, `crm.merge_proposal.applied`, `crm.merge_proposal.dismissed`. The dashboard review queue can now subscribe via the existing realtime gateway instead of polling `/api/overview/backlog`.

New `skill://cms/stale-content-review` walks an admin agent through a periodic stale-content audit (drafts, unrefreshed published entries, orphaned assets) and produces a structured action report. v1 is propose-only — no persistent inbox; the operator reviews the curator-runner's reply and acts via the existing `cms_*` tools.
