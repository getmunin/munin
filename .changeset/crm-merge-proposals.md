---
'@getmunin/backend-core': minor
'@getmunin/db': minor
---

CRM merge proposals: new `crm_merge_proposals` table (migration `0007`) plus four admin MCP tools — `crm_propose_merge_candidate`, `crm_list_merge_proposals`, `crm_apply_merge_proposal`, `crm_dismiss_merge_proposal`. New `skill://crm/hygiene` walks an admin agent through filing structured proposals; `crm_apply_merge_proposal` atomically copies the recommended patch onto the keeper, archives the duplicate (`dedup-archived-YYYY-MM` tag + `customFields.mergedInto` + `doNotContact`), and marks the proposal applied. Pending proposals are unique per `(orgId, contactA, contactB)` pair so re-running the curator is idempotent. `OverviewBacklog` now exposes `crmMergeProposalsPending` for the dashboard backlog card.
