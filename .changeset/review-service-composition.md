---
'@getmunin/backend-core': minor
---

Add a `ReviewService` that composes the five review-queue modules (KB curation, CRM merge proposals, outreach proposals, CMS drafts, feedback) behind one contract, and serve it at `GET /v1/review?state=waiting|scheduled`.

`InboxController` and `SetupStateService` each ran their own copy of the same five-module fan-out; both now delegate. `/v1/inbox` answers exactly as before — its `queue` object is the snapshot the new service returns.

The new route reports `kind`, `state`, `at` and the untouched per-kind payload as `raw`. Item titles and snippets stay in the dashboard, where the translations live. `state=decided` is not listable yet and answers `400 review_invalid`.
