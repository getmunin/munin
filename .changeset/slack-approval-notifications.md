---
'@getmunin/types': minor
'@getmunin/db': minor
'@getmunin/backend-core': minor
---

Slack approval notifications: pending CRM merge proposals, outreach drafts, and KB curation candidates now post to Slack with approve/dismiss buttons, and the message updates in place once the item is decided anywhere. New optional `approvals` channel route (`slack_set_routing` with `purpose: "approvals"`), falling back to escalations, then default. KB curation now emits `kb.curation_candidate.proposed/published/dismissed` events, and the CRM merge events `crm.merge_proposal.applied/dismissed` join the public event catalog. Adds the `slack_notification_links` table and a `subject_key` ordering column on `slack_deliveries` (migration 0055).
