---
"@getmunin/agent-runtime": minor
"@getmunin/backend-core": minor
"@getmunin/agent-host": minor
---

Recover chat replies when the in-memory NOTIFY misses a live runner. A widget/chat reply was driven purely by an in-process `conversation.message.received` event reaching a subscribed runner; if no runner was resident when the NOTIFY fired (cold start, restart, scale-to-zero, dropped listener), the reply was silently lost because nothing durable recorded that one was owed.

The runner now also drives replies from a durable recovery set: `GET /v1/conversations/awaiting-reply` returns open, auto-mode, unassigned, non-voice conversations whose latest non-internal message is from the visitor. The agent host sweeps this on every (re)spawn — the same on-boot drain that lets the curator queue survive scale-to-zero — and on each reconcile tick, re-driving anything that slipped through. Already-answered and staff-handled threads are excluded, and the existing `shouldRespond` + conversation-claim + `sinceMessageId` guards keep a redundant trigger a no-op, so no duplicate replies.
