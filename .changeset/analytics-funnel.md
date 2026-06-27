---
"@getmunin/backend-core": minor
"@getmunin/db": minor
---

Add `analytics_get_funnel`: an admin MCP tool that computes ordered conversion funnels (per-step visitor counts, conversion and drop-off rates) from page-view events. Steps match by `subjectType`/`subjectId` and/or a `pathLike` pattern, are strictly ordered, and support an optional per-step time budget (`stepWindowHours`). Visitors are grouped by their identified end-user when known (else their anonymous `visitor_id`), so a journey crossing the anonymous → identified boundary isn't double-counted.

`analytics_get_contact_journey` now resolves the `visitor_id → end_user` link at read time, so a contact's page-views and searches recorded *before* they identified are included retroactively (no backfill).

Adds an `analytics_view_events (org_id, visitor_id, created_at)` index to back visitor-grouped scans.
