---
'@getmunin/backend-core': minor
'@getmunin/dashboard-pages': minor
---

Learning becomes a view of its own at `/dashboard/learning`: what is waiting on review, and
what was recently decided. A revision proposal renders its before/after inline rather than
only inside a drawer, so the edit an agent wants to make is readable at a glance.

Adds `GET /v1/kb/curation/decisions` — a thin wrapper over the existing
`listCurationDecisions` service method, which until now was reachable only through the
`kb_list_curation_decisions` MCP tool. The dashboard needs it for the decided list and the
seven-day count.
