---
'@getmunin/backend-core': minor
---

Add an optional `MUNIN_ALLOWED_HOSTS` env var that activates a Host-header allow-list middleware. When set, requests whose `Host` header (port stripped, case-insensitive) isn't in the comma-separated list get a 421 `misdirected_request` response before any controller runs.

Defense-in-depth: cloud deployments are reachable both by the custom domain (`api.dev.getmunin.com`) and by the raw Scaleway container hostname. A future CORS or cookie-domain misconfig could leak via the raw hostname; this middleware rejects it at the edge. Pass-through (no enforcement) when the env var is unset — OSS dev and tests are unaffected.
