---
'@getmunin/dashboard-pages': minor
'@getmunin/backend-core': minor
'@getmunin/db': patch
---

Redesign Channels and Trackers as card grids matching the Integrations page, and give Trackers real 7-day view stats.

Channels and Trackers rendered as full-width `<ul><li>` rows while Integrations already shipped a bordered-card grid (`IntegrationCard`/`CardMenu`/`StatusLine`/`CardGrid`), so the three settings pages didn't read as one family. `CardGrid`, `CardMenu`, and `StatusLine` move out of `components/integrations/integration-card.tsx` into a new shared `components/card-kit.tsx`, alongside a new `SettingsCard` shell: mono kind eyebrow (chat/email/SMS/voice — no logo tile, since nothing real would go in one) with the vendor logo + name demoted to footer metadata, serif name with a mono qualifier, an always-visible status line, a one-line description, and a 1.5px amber top rule for anything needing attention (awaiting credentials, never fired). A new `CardGridSkeleton` gives the loading state the same shape as the loaded grid; the Integrations page itself is visually untouched (only its internal imports move), and Channels/Trackers keep their existing `EmptyCallout`/`LoadFailed` empty and error states unchanged.

Trackers' cards also show a 7-day view count and sparkline per tracker. `analytics_view_events` previously had no way to attribute a view to a specific tracker — the ingest controller resolved the tracker from its API key but discarded the id before calling `recordView` — so this needed a small backend addition: a nullable `trackerId` column (+ index) on `analytics_view_events`, threaded through from the two ingest call sites, a new `AnalyticsService.trackerViewSummaries()` aggregation, and a dashboard-only `GET /v1/analytics/trackers/views-summary` endpoint (kept off the `analytics_*` MCP tool surface deliberately). Phone-number qualifiers (SMS `fromNumber`/`originator`) now format through `libphonenumber-js` instead of showing the raw E.164 string.
