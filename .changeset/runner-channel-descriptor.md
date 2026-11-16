---
'@getmunin/backend-core': patch
---

The hosted agent runner now loads each channel's own descriptor (`channel-cch-…` in the `agent-runtime` space). The in-process client the runner uses left `channelId` and `channelName` out of the conversation it hands the runtime, so the `[Channel]` block was always empty: per-channel instructions never reached the agent on any channel, chat or email, and only the generic `channel-<type>` descriptor applied. Standalone runners that read conversations over HTTP were not affected.
