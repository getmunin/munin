---
'@getmunin/backend-core': minor
'@getmunin/dashboard-pages': minor
---

Show every kind of review decision in the console's Decided tab, not only KB curation.

The tab now reads `/v1/review?state=decided` with cursor paging, replacing a 200-row fetch the browser filtered to 30 days. Rows and the detail pane route by kind, and each outcome is named in the module's own words — published, merged, sent, forwarded — rather than one shared verb.

`/v1/inbox` now returns `waiting` and `scheduled` as ordered `ReviewItem` lists instead of six arrays keyed by module, so the browser no longer rebuilds the tab split from module names. Titles and snippets stay client-side, where the translations are.

Feedback decisions also reach the tab live: `feedback.item.*` joins the realtime event list the console listens on.
