---
'@getmunin/backend-core': patch
'@getmunin/db': patch
'@getmunin/agent-host': patch
---

Journey fixes from review of the closed loop: `outreach.outcome.recorded` fires only when the outcome is new, and a call step waits for the outcome of its own call; resuming a step or journey the monitor paused restarts its guardrail measurement instead of re-pausing on the same data; step runs record their version so moving runs or deleting old traces no longer distorts split samples and results, and retention keeps split steps; moving runs re-checks each run under a lock; an approval is decided once; `journeys_propose_change` refuses an invalid spec without opening a draft and serialises with other proposals; the LLM availability port comes from a small global module instead of making all of agent-host global, and runs in a savepoint; Slack journey labels stay inside the org; the Shopify webhook answers unknown and unsigned calls the same way and ignores unreadable dates.
