---
'@getmunin/db': minor
'@getmunin/types': minor
'@getmunin/backend-core': minor
'@getmunin/dashboard-pages': minor
'@getmunin/analytics-tracker': minor
---

Analytics: one row per page view, read depth and declarative events out of the box, canonical subject ids, generic search ingest, and identity backfill.

**Breaking for dashboards, not for code: `views` changes meaning.** Until now every page load wrote at least two rows — the initial view plus an exit beacon carrying `dwellMs`, plus one more per SPA route change — so tracker-sourced `views` was inflated roughly 2×. The tracker now mints a `viewId` per page view and sends it on both beacons; ingest upserts on the new partial-unique `(org_id, client_view_id)`, so the exit beacon enriches the row instead of adding one. Tracker `views` drops ~50% on the deploy date; `visitors` is unchanged. History carries no `viewId` and is not repairable, so don't compare `views` across the upgrade. Beacons without a `viewId` still insert one row each — old cached bundles keep working.

Enrichment is max-wins for `dwell_ms` / `read_depth` and fill-if-null for attribution (`referrer`, `utm_*`, `path`, `locale`, `country`, `metadata`, `end_user_id`), so an exit beacon that overtakes the initial view — `sendBeacon` guarantees no ordering — can create the row without erasing the real referrer. `clientViewId` is deliberately absent from `analytics_export_events` / `analytics_import`: it is an ingest dedup key, and merging two servers' events would collide on the index.

Everything else is opt-in:

- `data-read-depth="true"` measures the deepest 25/50/75/100 scroll milestone (passive listeners, rAF-throttled) and reports it on the exit beacon, so read depth costs no extra row. `avgReadDepth` in `analytics_get_subject_engagement` finally has data.
- `data-mn-event` on any element records a click as a view event, with `data-mn-subject-type`, `data-mn-metadata` (defensively parsed JSON object) and `data-mn-once="session"`. `window.mn.trackOnce()` is the JS twin.
- `analytics_create_tracker` / `analytics_update_tracker` take `canonicalLocales` and `canonicalStripTrailingSlash`. Ingest folds path-shaped subject ids (`/en/pricing` → `/pricing`, `/pricing/` → `/pricing`) so a localized site stops reporting one subject per locale; ids that don't start with `/` are never rewritten and `path` always keeps the raw URL. Default off, applies from the next event, no site redeploy — also editable from the dashboard's tracker row.
- `POST /v1/a/s` and `window.mn.trackSearch(query, resultCount)` record search events from any search implementation. `analytics_list_zero_result_searches` previously only saw Munin's own CMS delivery search, which left every site running Pagefind/Algolia/a hand-rolled index structurally dark.
- CMS entry views: `_tracking` now ships the bare `token` alongside `pixelUrl`/`beaconUrl`, and the tracker records entry views with a visitor id via `window.mn.trackEntry(token)` or `<div data-mn-entry-token="…">`. The pixel cannot report `visitors` (it takes no visitor parameter, and a first-party cookie can't survive the cross-origin API) — that limitation is now stated in the skill instead of being discovered from `visitors: 0`.

Identity linking backfills: `identify` (and the chat widget's own identity resolution) now stamps `end_user_id` on that visitor's anonymous `analytics_view_events` / `analytics_search_events` rows from the last 30 days, in the same transaction as the bridge row. The auto page view always beats the `identify` round-trip, so without this the first event of every new visitor's session stayed anonymous forever. Adds `analytics_search_events_visitor_idx` to keep that update indexed.
