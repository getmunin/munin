---
'@getmunin/agent-runtime': minor
'@getmunin/agent-host': patch
---

Let curator skill passes see the images on the conversation they were queued for.

`runSkillPass` built its single synthetic user turn from `userPrompt` alone, so a curator job read
the thread through MCP tools and never saw a pixel — `conv/set-topic-and-title` titling an
image-only turn, or `outreach/draft-reply-email` answering a prospect who attached a screenshot,
worked from text that wasn't there. `SkillPassOptions` gains `userPromptAttachments`, which land on
that turn and flow through the existing `loadHistoryImages` path, so the per-turn image and byte
budgets apply unchanged and anything over budget degrades to a placeholder note.

The curator worker fills it in: when a job's `sourceEventPayload` names a conversation, it hydrates
that conversation and passes along every non-internal attachment that still resolves to a URL.
Scheduled sweeps that name no conversation are unaffected.
