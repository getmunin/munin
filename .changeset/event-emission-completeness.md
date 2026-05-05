---
'@getmunin/backend-core': minor
---

Fill in missing webhook / activity-log events across CRM, end-users, and API keys.

Before: the dashboard's Activity log subtitle promised "every conversation message, status change, handover, KB write, **and CRM update** as it happens", but the CRM service only ever emitted events for merge proposals — `crm_create_contact`, `crm_update_contact`, deal moves, and activity logs all wrote silently. The end-users and API keys controllers similarly emitted nothing — surprising for surfaces a SIEM / audit consumer would specifically want to subscribe to.

Now emitting:

- **CRM** — `crm.contact.created`, `crm.contact.updated`, `crm.company.created`, `crm.deal.created`, `crm.deal.stage_changed` (with `winLoss` + `closedAt` on terminal transitions), `crm.activity.logged`. Existing `crm.merge_proposal.{proposed,applied,dismissed}` unchanged.
- **End-users** — `end_user.created` on first-touch find-or-create. `end_user.tokens_revoked` on `/revoke-tokens` (security-relevant).
- **API keys** — `api_key.minted` on POST, `api_key.revoked` on DELETE. The kind of event a SIEM webhook subscriber actually wants.

All events flow through the same `WebhookDispatcher` already used by the conv / kb / cms modules — they land in the `events` table for the dashboard Activity log and ride the existing realtime + webhook delivery path. No new tables, no new routes; just plugging holes.
