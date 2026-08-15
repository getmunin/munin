---
'@getmunin/analytics-tracker': minor
'@getmunin/backend-core': minor
'@getmunin/core': minor
'@getmunin/db': minor
---

Analytics `identify` accepts a signed email, so web analytics and the email inbox converge on one identity

`window.mn.identify(externalId, userHash, { email })` now takes an optional email trait, and the email address is covered by the HMAC — an unsigned or mis-signed address is rejected, so a browser cannot claim someone else's address and pull down their journey.

This closes a split that used to be invisible. Inbound email creates a provisional identity keyed `email:<address>`; `identify` created one keyed by the customer's own id. The same human ended up as two `end_users` rows, and neither the contact journey nor the funnel could see across them. Now:

- **Email first, sign-in second** — `identify` finds the provisional row by address and promotes it in place. `external_id` becomes the caller's id and the row id is unchanged, so every conversation, CRM contact and analytics event already pointing at it stays attached. No merge, no FK repointing.
- **Sign-in first, email second** — inbound mail resolves by the email column and reuses that identity instead of forking a provisional one. Both inbound paths (email channel and channel webhooks) share one resolver.
- **Two established identities already hold the address** — nothing is merged; the conflict is logged as `identify.email_conflict` for an operator to resolve. Auto-merging two real people on a page load is not a decision this code should make.

The identity payload is now length-prefixed per field (`mn.identity.v1`) so no value can be shifted across a field boundary — the previous `${externalId}:${visitorId}` form was ambiguous, and Munin's own provisional ids contain a colon. Integrations that send no email keep working: the legacy payload is still accepted in that case.

Adds a partial unique index on `(org_id, lower(email))`, which is what makes the two paths converge rather than race.

Existing duplicates are merged by the migration rather than left for an operator, because a self-hosted deploy has no one to hand-merge them. The rows are the same human by construction — one address, one org — so only the survivor is a decision, and it is ordered rather than guessed: a real `external_id` beats a provisional `email:<address>` one, then oldest, then id. Every reference is repointed before the losers are deleted, and the keeper backfills its own null `name`/`phone` from them, so nothing is detached and nothing is overwritten. Read receipts are deduplicated to the earliest per message, since `(message_id, end_user_id)` is unique and the same read can sit on the keeper and on two different losers at once. Each merge is announced with a `RAISE NOTICE` naming the address and the surviving id.
