---
'@getmunin/backend-core': minor
'@getmunin/core': minor
'@getmunin/db': minor
---

Add an `analytics` module that records page-view and search events for any consumer surface. Two ingress paths: a 1×1 GIF pixel at `GET /v1/a/v/:token.gif` and a JSON beacon at `POST /v1/a/v`. Both anonymous, throttled, bot-UA filtered, and gated by an HMAC-signed view token bound to `(orgId, subjectType, subjectId)` so callers can't spoof arbitrary subjects. Events land in two new polymorphic tables (`analytics_view_events`, `analytics_search_events`) keyed by `subject_type` (`'cms_entry'` today, `'landing'`/`'dashboard_route'`/… later) — no per-consumer schema churn.

CMS delivery wires in as the first consumer: every entry and list item from `/v1/cms/{orgId}/...` now ships with a `_tracking: { pixelUrl, beaconUrl }` block (suppressible via `?tracking=0`), and the public `/search` endpoint logs every query plus its `result_count` for "what to write next" analysis (zero-result queries are indexed for fast lookup).

Also: the email open pixel and the new CMS tracking URLs both now build off `MUNIN_API_URL` via a new `readApiBaseUrl()` helper, fixing a latent bug where pixels were minted against the MCP host on split-host deployments (`api.*` vs `mcp.*` subdomains). The unused `readPublicBaseUrl()` shim is removed, and `MUNIN_API_URL` is documented in `.env.example` under the Backend section.
