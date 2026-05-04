---
'@getmunin/backend-core': minor
'@getmunin/dashboard-pages': minor
---

Add a "Needs attention" backlog card to the dashboard overview, plus a
small `/api/overview/backlog` aggregator that returns counts of items
across modules waiting on human or admin-agent attention.

The card is a *signal*, not a CRUD surface — it tells the operator
what to attend to (open conversations needing handover, KB curation
candidates pending review) but the actual work still happens through
the connected admin agent. This keeps the dashboard on-thesis ("the
agent is the UI") while still giving operators a single place to see
the backlog grow and shrink.

Today the card surfaces:
- conversations with `needsHumanAttention = true`
- KB documents in the `kb-curation-inbox` space tagged `candidate`

Future modules (CRM dirty-data, CMS stale-content, …) can extend the
endpoint shape without controller refactoring — it returns a flat
`{ key: count }` object.
