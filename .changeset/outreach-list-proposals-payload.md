---
'@getmunin/backend-core': minor
'@getmunin/inspector-app': minor
'@getmunin/dashboard-pages': minor
---

fix(outreach): keep `outreach_list_proposals` payloads bounded

`outreach_list_proposals` returned every column of every matching row, curator `evidence` included. Evidence is an unbounded JSONB the curator fills with sources, compliance notes and reasoning — around 4,000 characters per proposal in practice, roughly three quarters of a row. Combined with a default limit of 100 and a default of all statuses, a queue of ~16 proposals already produced an 80,000-character result that clients refuse, and 100 rows would have been half a million characters. The failure is silent-ish and total: the MCP Apps panel renders the size error instead of the review UI, and the model gets no data either, so the review pass just stops.

List rows now carry the draft, the nested `contact` / `campaign` / `delivery` summaries and a boolean `hasEvidence`, but not `evidence` itself. The default limit drops from 100 to 25 and the ceiling from 500 to 200.

The new `outreach_get_proposal` reads one proposal by id with the full evidence attached, so nothing became unreachable — this exposes the `getProposal` service method the Slack bridge and `GET /v1/outreach/proposals/:id` already used. The Inspector panel's **Evidence** toggle now fetches on click rather than receiving evidence for every card up front.

`GET /v1/outreach/proposals` and the inbox queue return the same trimmed rows. Nothing in the dashboard rendered `evidence` from a list response.
