---
'@getmunin/backend-core': minor
---

Serve the whole review history at `GET /v1/review?state=decided`, merged across all five queue kinds with cursor pagination.

Each module gained a `listDecided` that reports its own decisions in one shape — outcome, reason, who decided, and a `producedRef` pointing at what the decision produced (the published KB document, the surviving contact, the sent message, the CMS entry). `ReviewService` merges the five keyset-paginated sources, sorts by `decidedAt`, and hands back an opaque cursor built with the existing `encodeCursor` helper.

An outreach proposal counts as decided once it is sent, dismissed, withdrawn or failed; `approved` with a send time still belongs to Scheduled.

Extracting the merge-proposal hydration and the outreach proposal select into shared private helpers keeps the pending and decided queries on one code path.
