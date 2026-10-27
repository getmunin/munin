---
'@getmunin/backend-core': minor
---

Journeys can now be simulated, published and measured. `journeys_simulate` dry-runs a version over sample contacts — given ids, a segment, the entry segment or recent contacts — and reports who would enter or be excluded, arrivals and edges per node, exits, the send decision for every email with rendered samples, and the assumptions it made, without writing or sending anything.

`journeys_request_publish` validates a draft, diffs it against the live version (listing emails that would send without review), simulates it and returns a dashboard path. Only a person signed in to the dashboard can confirm, through `POST /v1/journeys/:id/versions/:n/publish` with the fingerprint they reviewed; editing the draft afterwards voids the request. People already in the journey finish on the version they entered. `journeys_get_report` and `GET /v1/journeys/:id/report` show enrollments by state and exit reason, goal conversion for the treated group against the holdout, per-node arrivals and edges, and email outcomes.
