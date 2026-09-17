---
'@getmunin/backend-core': minor
'@getmunin/dashboard-pages': minor
'@getmunin/db': patch
---

Social post drafts become the sixth review-queue kind.

Drafts already existed and a person already had to decide them — but the only way
to see one was to ask an agent. They now sit in Waiting beside curation candidates
and CMS drafts, and land in Decided with the other five once decided.

**Approving a social draft means "I posted this", not "Munin, post this."** There is
no publishing integration yet, so the pane is built around the workflow people
actually have: read the variant, copy the text, copy the tagged link, open the
platform, publish under your own name, then say so. The primary action is
therefore *Mark as posted* rather than *Approve*, and the pane says outright that
Munin does not post for you. When publishing does arrive it adds a second action —
it does not change the meaning of this one.

The tracked share URL is what the Copy button hands over, not the clean stored
`linkUrl`. That is the whole point of tagging per variant: a reviewer who copies
the untagged link silently opts their post out of the per-angle click figures, and
the difference between the two URLs is not something you would notice by eye.

**`dismiss_reason` is new on `social_post_drafts`** (migration 0101). Every other
queue kind records why a reviewer passed, and the decided feed renders one column
across all six; without the column social would be the one kind permanently blank
there — not because nobody typed a reason, but because there was nowhere to put
one. `social_dismiss_post_draft` takes an optional `reason` to match.

A decided draft maps to an outcome rather than storing one: `dismissed` is
dismissed, `failed` is failed and reports `last_error` as its reason, and both
published states are approved. `published` and `published_externally` are a real
distinction — through Munin versus by hand — but not one a reviewer reading the
decided feed is asking about, so the feed collapses them and the DTO keeps them.

Backend and dashboard ship together deliberately. `inbox-data.ts` dispatches queue
kinds through a chain of `if` statements ending in a terminal `else`, both when
building rows and when approving, so an unrecognised kind does not fail loudly —
it renders as a feedback card and approves against
`/v1/outreach/proposals/:id/approve`. A backend-only release would have served a
kind the dashboard silently mishandles.

Adds `/v1/social/drafts/:id` (read, revise, approve, dismiss) to the control plane.
