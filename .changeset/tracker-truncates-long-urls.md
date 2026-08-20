---
'@getmunin/backend-core': patch
'@getmunin/analytics-tracker': patch
---

Analytics ingest truncates over-long URL fields instead of dropping the whole event.

`path`, `referrer`, `locale` and the `utm.*` fields were validated with a hard `z.string().max()`, so a single over-long value failed `safeParse` and the entire beacon was discarded — even though `AnalyticsService.recordView` already truncates those same fields to the same limits before insert, because the columns are `varchar`.

The OAuth consent screen hit this on every load: the tracker sends `location.pathname + location.search`, and an authorization request carrying `client_id`, `redirect_uri`, `code_challenge`, `state`, `resource` and the URL-encoded scope list runs past 800 characters — the 28-entry scope list alone encodes to 474. Both beacons for that page load (the initial view and the exit beacon carrying dwell and read depth) were rejected, so the authorization step recorded nothing and left a hole in the signup funnel at exactly the step worth measuring. A page loaded *from* such a URL lost its own view too, because the same cap applied to `referrer`.

Those fields now parse through a transform that clips to the storage limit while still rejecting values past 8192 characters, which keeps a bound on request bodies. Hard caps stay on `subjectId`, `visitorId` and `viewId`, where an over-long value is a broken integration rather than a long URL, and where silently truncating would merge distinct visitors or views. The same fix applies to the `/v1/a/v` CMS entry-view endpoint, which was dropping malformed bodies with no log line at all.

The tracker bundle now clips `path` and `referrer` to 512 before sending, so pages running a cached bundle against an older backend degrade to a truncated path rather than a lost event. Beacon and search validation failures now log the tracker key prefix and subject id, so the next silent drop is diagnosable from the logs.
