---
'@getmunin/agent-runtime': patch
'@getmunin/backend-core': patch
'@getmunin/core': patch
---

Withhold the agent reply when the audit pass marks a conversation as spam, and stop the assistant redirecting senders off-channel.

The audit pass runs after generation but before delivery, so a `mark_spam` verdict flipped the conversation to `spam` and then posted the generated reply anyway — a cold pitch got both a spam label and a polite answer. The verdict now gates delivery: on spam the reply is withheld and parked as a `draft_reply` instead, so a misclassified customer is one click from recovery rather than a silently dropped thread. `shouldRespond` already skips non-open conversations, so later turns stay silent too.

Parking needs a way to author a draft without requesting a handover, so `conv.setDraftReply` and `POST /v1/conversations/:id/draft-reply` are new; the endpoint replaces any existing draft rather than stacking, and pre-checks the conversation so an unknown id is a 404 rather than a poisoned transaction.

The seed system prompt scoped its no-redirect rule to handovers only, so it never bound on a reply that wasn't one. That rule is now unconditional, adds "never name a contact address the sender already wrote to" (inbound mail has by definition already reached the right inbox), and tells the assistant to decline pitches briefly without routing anyone anywhere. Existing orgs keep the prompt they already have in KB — the seed only applies to orgs that don't have the document yet.
