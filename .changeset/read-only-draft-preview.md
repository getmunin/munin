---
'@getmunin/dashboard-pages': patch
---

Let an operator read the agent's draft before claiming the conversation

Deciding whether to take a conversation over meant claiming it first, which is the one move you
cannot make speculatively — it moves the claim off a teammate. When a pending draft exists the
composer now renders the reply box read-only with the draft body, above the same claim/take-over
button as before, so the draft is readable without owning the thread. Editing and sending still
require the claim, and a conversation with no draft keeps today's behaviour: no composer until you
claim it.
