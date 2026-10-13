---
"@getmunin/core": minor
"@getmunin/agent-runtime": minor
"@getmunin/agent-host": minor
"@getmunin/backend-core": minor
---

The support agent now knows which channel a conversation arrived on. Its system prompt gains a `[Channel]` block naming the channel and its id, placed after the channel-type descriptor. Until now an org with two chat widgets, one per website, gave the agent the same `channel-chat` descriptor for both and no way to tell the sites apart.

The block also carries a per-channel descriptor when the `agent-runtime` KB space holds one. Its slug is `channel-` followed by the channel id with `_` replaced by `-`, so channel `cch_abc123` reads `channel-cch-abc123`. It adds to the channel-type descriptor rather than replacing it, so it only needs to say what is specific to that channel, such as which site the agent answers for. The runner reads it the first time one of that channel's conversations needs a reply, then follows edits, new documents and deletions as they happen. Unlike the seeded prompts, these per-channel documents can be deleted. `GET /v1/conversations/:id` returns the channel's `channelName`. `skill://conv/serve-multiple-sites` walks through the setup.
