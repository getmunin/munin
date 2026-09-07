---
'@getmunin/backend-core': minor
'@getmunin/dashboard-pages': minor
---

Learning becomes its own console destination. `GET /v1/kb/curation/decisions` exposes the existing curation decision record to the dashboard, and `/dashboard/learning` renders the design's cards: pending KB candidates (revision vs article, target space, publish / review-and-edit / dismiss — reusing the inbox KB drawer for editing) followed by the decided history with published/dismissed pills and the no-refile note. KB candidates leave the admin overview's Waiting-on-you list now that Learning owns them, the overview's Learning stat row links somewhere real, and the sidebar's Learning entry (admin-only, badge = pending candidates) goes live.
