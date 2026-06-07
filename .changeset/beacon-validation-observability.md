---
'@getmunin/backend-core': patch
---

`AnalyticsTrackerController` now logs a `warn` line when a pixel query or beacon body fails Zod validation. Previously both ingest paths silently returned (pixel → 200 GIF, beacon → 204) on validation failure, which hid schema-vs-bundle mismatches: clients saw "success" while no row landed. The fix in #406 was discovered exactly this way — having backend logs surface these from the start would have caught it weeks earlier. Log messages are `pixel.validation_failed: <reason>` and `beacon.validation_failed: <reason>`.
