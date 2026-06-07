---
'@getmunin/backend-core': minor
'@getmunin/db': minor
---

Add optional server-side country resolution on `analytics_view_events`.

- New nullable `country` column (ISO 3166-1 alpha-2) on `analytics_view_events`. Backfill is not done — historical rows stay NULL.
- New `GeoIpService` (in `@getmunin/backend-core`) wraps a local MaxMind-format `.mmdb` reader via the `maxmind` npm package. The reader memory-maps the file at boot, so per-request lookups are O(µs) and involve no network calls.
- The `AnalyticsTrackerController` resolves `req.ip` to a country at both the pixel (`GET /v1/a/t/:key.gif`) and beacon (`POST /v1/a/t`) ingest paths. The IP is consumed only here and never persisted — only the 2-char country lands on the row.
- New MCP tool `analytics_top_countries` for the visitors-by-country query.
- Zero-config by default: without `MUNIN_GEOIP_DB_PATH` set, `GeoIpService` logs `geoip.disabled` at boot and returns null for every lookup, so ingest still works and the column simply stays NULL. With the env var pointing at a valid `.mmdb`, country starts populating immediately.

No dependency on a hosted geo API — the lookup happens entirely in-process. Both MaxMind GeoLite2-Country and DB-IP Country Lite are compatible file formats.
