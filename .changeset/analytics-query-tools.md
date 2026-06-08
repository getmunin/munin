---
'@getmunin/backend-core': minor
---

Three new admin MCP tools for the analytics surface, covering the breakdowns that previously required raw SQL against `analytics_view_events`:

- `analytics_traffic_by_source` — views + visitors grouped by `utm_source` / `utm_medium` / `utm_campaign`. The all-NULL row is the direct/organic bucket; compare against named-campaign rows to gauge campaign lift.
- `analytics_referrer_hosts` — views + visitors grouped by the host portion of `referrer`, with an optional `excludeHost` argument so internal navigations don't drown out external referrals. Direct/`rel=noreferrer` traffic rolls into a single `host: null` bucket.
- `analytics_views_over_time` — daily view + unique-visitor counts over a recent window, zero-filled per UTC day so days with no traffic appear as `views: 0`. Pin to a single page via `subjectId`. The single best input for "did this launch / campaign / outage move the needle?".

Each tool mirrors the existing `analytics_top_*` shape (sinceDays / limit / optional subjectType + source filters) and is gated by `analytics:read`. The skill at `skill://analytics/track-website-traffic` now demonstrates all three under "Query the data", and the `mn.track(...)` custom-event section has concrete patterns (funnel steps, SPA route changes with dwell, scroll milestones) instead of a single example.
