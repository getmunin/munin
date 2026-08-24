---
'@getmunin/backend-core': patch
---

Validate `source` and `readDepth` on analytics import instead of letting Postgres reject them.

`analytics_import` (and `POST /v1/analytics/import`) accepted `source` as any string up to 8
characters, but `analytics_view_events` has a check constraint allowing only `pixel`, `beacon` or
`tracker`. Importing a plausible-looking value such as `web` passed schema validation and then
failed inside the database, surfacing as `500 Internal server error` with no indication of which
field was wrong — during a bulk import of hundreds of events, with nothing written.

The enum already existed in `analytics.tools.ts` as `ViewSourceSchema` and was applied to all six
read filters, but never to the import path — the one place the value comes from the caller. It now
lives in `ingest-fields.ts` alongside the other shared ingest boundary helpers, so the MCP tool and
the HTTP controller validate against one definition. `readDepth` had the same gap and is now bounded
to 0–100 to match its own check constraint. Both boundaries now return a validation error naming the
field.
