---
'@getmunin/backend-core': patch
---

Make taking over a claimed conversation actually take it over.

`POST /v1/conversations/:id/take-over` called `ConversationClaimsService.claim()`, which
throws `ClaimedByOtherError` the moment someone else holds a live claim — the one
situation the endpoint exists for. So it was claim-if-free wearing a take-over label, and
the dashboard's take-over button failed with `claim_held_by_other` in exactly the state it
was built for. Four things promised displacement and only the service disagreed: the route
name, the `conversation.taken_over` webhook, the button ("Take over to reply"), and its
caption ("… owns this — taking over moves the claim to you").

`claim()` now takes `force`, which reassigns the existing claim instead of throwing, and
the control route passes it. The three other callers are deliberately left unforced: the
implicit claim when a user sends a message swallows `claim_held_by_other` rather than
quietly stealing a colleague's conversation, and the Slack action reports it as
"someone beat you to it".

A displacement writes an internal note — `authorType: 'system'`, `authorId:
'conversation-claims'`, `metadata.kind: 'claim_taken_over'` with `fromUserId` and
`toUserId` — so the person who lost the conversation mid-reply can see who took it and
when, instead of discovering it by failing to send. Refreshing your own claim and claiming
a free conversation write nothing.

Fixes a related gap the above would otherwise have widened: `conversation.taken_over` was
only emitted on the insert path, after the early return for an existing claim, so it never
fired for a real take-over. It now fires on a fresh claim and on a displacement, and stays
silent for a plain TTL refresh, which is a heartbeat rather than an event.

This was unreachable in single-user testing — a lone account can never produce a foreign
claim — which is why it survived this long.
