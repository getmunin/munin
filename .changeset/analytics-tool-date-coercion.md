---
'@getmunin/backend-core': patch
---

Fix `analytics_subject_engagement` and `analytics_zero_result_searches` crashing with `r.last_view_at.toISOString is not a function` (and the analogous `last_seen_at` error) when the query returns any row.

Both tools use raw SQL via `ctx.db.execute(sql\`…\`)` to compute aggregate timestamps (`MAX(created_at)`). That path bypasses Drizzle's column type-mapping, so postgres-js returns the value as an ISO string rather than a `Date`. The tools then called `.toISOString()` on the string and threw. `analytics_subject_engagement` was unusable on real data; `analytics_zero_result_searches` was latent (only happened when at least one zero-result search had been recorded).

Fix is two-line per tool: coerce with `new Date(...)` before serialising. The widened TS type (`Date | string`) reflects what the driver actually returns. Integration test covers the read-side path now so this doesn't regress.
