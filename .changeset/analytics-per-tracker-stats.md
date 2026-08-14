---
'@getmunin/backend-core': minor
'@getmunin/db': minor
---

Analytics: separate the stats per tracker.

An org with several trackers (marketing site, docs, app) could mint one key per site but only ever read the sum: every query tool aggregated across the whole org, and `analytics_view_events.tracker_id` was written but never read. Search events didn't even record which tracker sent them, so `analytics_list_zero_result_searches` could never be split.

Every analytics read tool now takes an optional `trackerId` — `analytics_list_top_subjects`, `analytics_list_top_countries`, `analytics_list_traffic_sources`, `analytics_list_referrer_hosts`, `analytics_get_views_over_time`, `analytics_get_subject_engagement`, `analytics_get_funnel`, `analytics_get_contact_journey` and `analytics_list_zero_result_searches`. Omitting it keeps the previous org-wide behaviour; an id that doesn't belong to the org is a `404` rather than an empty result, so a typo can't be misread as "no traffic".

`analytics_search_events` gains a `tracker_id` column (migration `0068`), stamped by the `/v1/a/s` ingest endpoint from the tracker key. Pre-existing rows and searches Munin ran itself through the CMS delivery API stay NULL and are excluded from tracker-scoped queries. Views recorded through the token-signed CMS entry pixel/beacon carry no tracker either — filter those with `source` instead.

Analytics export/import now round-trips the tracker foreign key on both event kinds, resolved through the transfer `idMap`, so moving an org between servers no longer flattens per-tracker attribution.
