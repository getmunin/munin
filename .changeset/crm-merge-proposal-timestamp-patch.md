---
'@getmunin/backend-core': patch
---

Fix `crm_apply_merge_proposal` crashing with a bare 500 when the proposal's `recommendedPatch` carries a timestamp field (e.g. `consentGivenAt`) as an ISO string. Drizzle's timestamp encoder calls `value.toISOString()` during query build, which throws on a string. The patch is now normalized before the keeper update: values for timestamp columns are coerced from ISO strings (or epoch numbers) to `Date`, and keys that aren't real, patchable contact columns are dropped instead of being passed through to `.set()`.
