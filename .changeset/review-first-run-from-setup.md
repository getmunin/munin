---
'@getmunin/backend-core': minor
'@getmunin/dashboard-pages': minor
---

Review now renders its first-run scene straight from the server HTML, instead of showing a split skeleton until the review lists land.

Review was the one console page whose first-run rule the setup snapshot could not answer. Deciding it needs to know that nothing is waiting anywhere in the review queue — curation candidates, merge proposals, outreach drafts and scheduled sends, CMS drafts and scheduled entries, pending feedback, recent curation decisions — and that answer only arrived with `/v1/inbox` and `/v1/kb/curation/decisions`, two client fetches after the bootstrap. So the page returned `null` from its rule, which reads as `loading`, and a brand-new workspace saw `ConsoleSplitSkeleton` before its onboarding steps.

`/v1/overview/setup` now carries a `reviewQueue` of `{ hasPendingItems, lastDecisionAt }`, which the server bootstrap already fetches, so the answer is in the first render. `SetupStateService` composes it from the same service calls and the same limit that `/v1/inbox` uses, rather than re-deriving each bucket's filter, so the two cannot drift apart. It reports the facts and leaves the 30-day decided window to the page, which owns that rule.

The scan runs only when the org has no conversations — exactly the window in which `isFirstRun` can be true and the field can be read — so an active workspace pays nothing for it, and a first-run one scans near-empty tables. `reviewQueue` is `null` on that path, which the page treats the same as an older backend that does not send the field at all: it waits for the lists, as before.

`resolveReviewFirstRun` gives the loaded lists the final say, so a snapshot that goes stale while the page is open cannot pin Review to its first-run scene once a real item shows up.
