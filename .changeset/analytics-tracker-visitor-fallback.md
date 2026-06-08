---
'@getmunin/analytics-tracker': patch
---

When `localStorage` throws (private windows, embedded WebViews, locked-down enterprise browsers, storage quota), the tracker bundle now generates a page-scoped UUID as the visitor id instead of sending `null`. Previously every pageview from a storage-disabled session read as a new visitor, so unique-visitor counts and within-session dedup were broken for that traffic — and SPA route changes from one user looked like N separate visitors.

The fallback id only survives the page lifetime (no persistent storage to fall back on), so the same user reloading the page still gets counted twice. That's the inherent cost of having no storage; this fix just keeps at least intra-session dedup working. Privacy story is unchanged — the id is a random UUID, never linked to PII.
