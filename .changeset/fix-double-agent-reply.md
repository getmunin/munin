---
'@getmunin/agent-runtime': patch
'@getmunin/backend-core': patch
---

Stop the agent sending two replies to one inbound message.

A visitor email could get answered twice. The recovery sweeper that picks up unanswered
conversations runs every 30s and had no minimum age or in-flight exclusion, so a
conversation whose first reply was still being generated (25s is normal for a tool-using
turn) was a valid candidate. Three guards should have stopped the duplicate and each had
a gap: the in-process abort is cooperative and `runAgent` never re-checks it after the
final provider response, so a superseded run still returned an answer and posted it; the
cross-runner lease is released immediately after posting; and the backend
`agent_reply_race` check only rejects a post when an agent message is newer than *the
caller's own snapshot*, so a run that read the conversation after the first reply landed
carried that reply as its own `sinceMessageId` and passed. Nothing checked that the last
public message was still the visitor's — `resolveDelivery` only required that some
inbound message existed somewhere in the thread.

Three fixes: a reply run now bails when the last non-internal message is not from the
visitor; `run()` checks the abort signal after generation completes and before posting;
and the awaiting-reply query excludes conversations holding a live runner lease.
