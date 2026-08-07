---
'@getmunin/backend-core': patch
'@getmunin/core': patch
---

Close two CodeQL high-severity findings on paths that take remote input.

`InvitationsService.create` validated the invitee address with a hand-rolled `/^[^@\s]+@[^@\s]+\.[^@\s]+$/`. Because `.` is itself a member of `[^@\s]`, the group on either side of `\.` is ambiguous and the pattern can be driven into polynomial backtracking. It now runs the same `z.string().email()` the `POST /v1/orgs/me/invitations` DTO already applies, so the service agrees with its own controller instead of re-deriving a weaker rule.

`contentHash` looped to `input.length` over freshly concatenated remote content with no ceiling. HTTP bodies are already capped by the default 100kb parser limit, but the scraper and import paths do not go through it, so the loop was bounded only by whatever a document happened to contain. It now rejects input above 5,000,000 characters — roughly fifty times the HTTP limit and far above any real document — rather than hashing an unbounded string on the event loop.

Digests are unchanged: the guard is a pre-check and does not touch the mixing loop or the `\x01` title/body separator, and `chunker.test.ts` now pins three known digests (including one with surrogate pairs) so a future edit cannot silently change them. That matters because `content_hash` is persisted and compared to decide whether to re-embed — altering the function would invalidate every stored hash and force a full re-embed of the KB and CMS.
