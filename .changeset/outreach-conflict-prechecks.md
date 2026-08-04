---
'@getmunin/backend-core': patch
---

fix(outreach): duplicate proposals and campaign names return a conflict, not a 500

Four outreach write paths leaned on a `try/catch` around the insert (or nothing at
all) to turn a unique violation into a `ConflictException`. That never worked over
`/mcp`: the handler runs inside the request's tenant transaction, so the violation
poisons it and the *commit* fails after the handler returns — past the catch —
surfacing as a bare `{"statusCode":500,"message":"Internal server error"}`.

Each now pre-checks with a `SELECT` before the failing statement:

- `outreach_propose_first_touch` — a second **pending** first-touch for the same
  (campaign, contact) was unguarded; the pre-check only looked for `sent` /
  `approved`.
- `outreach_propose_reply` — a second pending reply for the same conversation had
  no pre-check at all.
- `outreach_create_campaign` — duplicate campaign name within the org.
- `outreach_update_campaign` — renaming a campaign onto an existing name had
  neither a pre-check nor a catch, so it was always a raw 500.

The existing catches stay as backstops for genuine races. `outreach_propose_followup`
already pre-checked and is unchanged. The pre-checks also mean these paths no longer
depend on the unique index's *name*, which is what made the failure invisible until
an index rename exposed it.
