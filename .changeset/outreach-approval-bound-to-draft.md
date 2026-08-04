---
'@getmunin/backend-core': patch
'@getmunin/dashboard-pages': patch
'@getmunin/inspector-app': patch
---

Bind outreach approval to the draft that was reviewed, not to the proposal id.

`outreach_approve_proposal` took only `{ id }`, so it meant "send proposal #a3f9", never "send the email I just read". `outreach_revise_proposal` is model-callable and mutates a pending draft in place, so an agent could rewrite the body after the panel, the dashboard drawer or the Slack card had rendered it — and the operator's click would send the rewrite. The revision count on the card was the only tell, and it was advisory: a human had to notice it on a card they had already decided about.

Every proposal now carries a `draftFingerprint` (a digest of campaign, contact, kind, subject, body and proposed send time) and approval requires it — `{ id, fingerprint }` on the MCP tool, `{ fingerprint }` in the body of `POST /v1/outreach/proposals/:id/approve`. A mismatch is a `409` with `outreach_conflict`: nothing is sent and the proposal stays pending, so the drift goes back through review instead of through the wire. Approve already re-checked campaign state, contact suppression and superseding replies at click time; the draft text is now one of those conditions.

All three review surfaces pass what they rendered. The Slack approve button carries the digest in its action value, and the bridge already re-renders the card on `outreach.proposal.updated`, so a revised draft rebinds its button and a card that missed the update refuses rather than sending stale text. The Inspector panel re-lists on a refused approval so the operator lands on the current draft with the conflict still shown.

This deliberately stops short of single-use tokens. The proposal state machine already refuses anything non-pending, which covers replay; what was missing was binding the decision to the content, and a digest does that without an issuance store or a secret inside the iframe. `crm_apply_merge_proposal` and `kb_publish_curation_candidate` are still id-bound and want the same treatment.
