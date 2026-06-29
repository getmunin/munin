---
"@getmunin/db": patch
---

Fix the `cms_asset_references` migration (0048) being silently skipped on
existing databases. Its journal `when` timestamp was lower than the preceding
migration's, and drizzle only applies migrations whose timestamp is newer than
the latest one already recorded — so on any database already past 0047 the
table was never created, and the follow-up RLS step failed with
`relation "cms_asset_references" does not exist`. Fresh databases (CI) applied
everything in order, which is why it passed review.

The timestamp is corrected, the migration is made idempotent (so a database
that already applied the broken version re-runs it as a no-op), and a new test
asserts journal `when` timestamps strictly increase with idx to catch this
class of bug before release.
