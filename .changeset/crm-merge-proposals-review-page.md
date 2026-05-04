---
'@getmunin/backend-core': minor
'@getmunin/dashboard-pages': minor
---

Adds a CRM merge proposals review page to the dashboard. New REST controller exposes `GET /api/crm/merge-proposals`, `GET /api/crm/merge-proposals/:id`, `POST /api/crm/merge-proposals/:id/apply`, `POST /api/crm/merge-proposals/:id/dismiss` so the dashboard can list pending proposals and resolve them with one click. The page subscribes to the new `crm.merge_proposal.*` realtime events so the queue updates without polling, and falls back to a 60s poll. The "Needs attention" backlog tile gets a CRM merge counter that links to the page; nav adds a top-level "CRM merges" entry. en + nb i18n strings included.
