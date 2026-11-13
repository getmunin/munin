---
"@getmunin/db": minor
"@getmunin/backend-core": minor
"@getmunin/agent-runtime": minor
"@getmunin/dashboard-pages": minor
---

A take-over now holds a conversation until someone releases it, closes it or marks it spam, or another teammate takes it over. It used to lapse after 30 minutes: an operator would take over from Slack or the dashboard, ask the customer for photos, and when the customer answered an hour later the AI replied to them and paged for a handover nobody needed.

`claims.expires_at` is now nullable (migration `0144_claims_held_until_released`), and null means "held until released". The dashboard's *Take over* button, the Slack *Take over* button and `POST /v1/conversations/:id/take-over` without `ttlMinutes` all create an open-ended hold. `ttlMinutes` still sets a timed claim. The implicit claim a user reply makes when nobody has taken over keeps its 30-minute window, now exported as `REPLY_CLAIM_TTL_MS`. Replying under a take-over no longer shortens the hold to that window.

Type-level break: `expiresAt` on the claim DTOs (`GET /v1/conversations/:id`, the queue's `claim`, the take-over response), the `conversation.taken_over` webhook payload and `@getmunin/agent-runtime`'s `ConversationDetail.claim` is now `string | null`. Every reader of active claims goes through the new `claimIsActive()` predicate, so an open-ended hold counts in the inbox, roster, queue ordering and Slack status line.
