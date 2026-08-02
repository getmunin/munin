---
'@getmunin/backend-core': patch
'@getmunin/dashboard-pages': patch
'@getmunin/inspector-app': patch
---

Bind merge application to the proposal that was reviewed.

`crm_apply_merge_proposal` took only `{ id }`, and `crm_propose_merge` does not always create a proposal: on a pair that already has a pending one it updates that row in place, overwriting `confidence`, `evidence`, `recommendedKeeperId` and `recommendedPatch` under the same id. Merge proposals also have none of the review tracking outreach has — no `revisionCount`, no `revisedAfterReviewAt` — so the rewrite was completely silent. A curator pass that re-filed a pair with the keeper flipped would change the card an operator was reading, and their click would retire the contact they meant to keep.

Applying is not a small write: it copies the patch onto the keeper, repoints activities, deals and relationships, archives the duplicate with `doNotContact: true` and a cleared `endUserId`, auto-dismisses pending outreach proposals for the duplicate, and auto-dismisses other pending merge proposals touching it. Unwinding all of that by hand is not realistic, and the dismissed outreach followups do not come back.

Proposals now carry a `mergeFingerprint` over `(contactAId, contactBId, recommendedKeeperId, confidence, recommendedPatch)` and apply requires it — `{ id, fingerprint }` on the MCP tool, `{ fingerprint }` in the body of `POST /v1/crm/merge-proposals/:id/apply`. A mismatch is a `409` with `crm_conflict`: nothing is merged and the proposal stays pending. The Slack apply button carries the digest in its action value; the panel and the dashboard pass what they rendered, and the panel re-lists on a refusal so the operator lands on the current proposal with the conflict still shown.

The digest deliberately covers the proposal row and not the contact rows behind it. `crm_update_contact` can change the name or email a card displays, but it cannot change which record survives or what patch lands, and digesting live contact fields would invalidate queued cards on ordinary CRM activity — conflicts on untampered work teach operators to click through them.

`evidence` is also excluded, so the weekly hygiene pass can refresh its reasoning on a pending pair without invalidating a queue the operator is working through. Only a changed decision invalidates a review.
