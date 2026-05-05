---
'@getmunin/agent-runtime': minor
---

Adds opt-in Anthropic prompt caching to `openAiCompatibleProvider`. When the request targets an Anthropic-compatible backend (`api.anthropic.com/*` or `openrouter.ai/*` with `anthropic/*` model), the provider attaches `cache_control: { type: 'ephemeral' }` markers to:

- the first system message (wrapped as a typed text block), and
- the last entry in the `tools` array (caches the full tool stack as one block).

These two breakpoints — system prompt and tool definitions — are the largest static chunks in any agent loop. With Anthropic's 5-minute TTL, the *first* call writes the cache (small surcharge on input tokens) and *subsequent* calls within the window read it at ~10% the cost.

Detection is automatic but overridable via `AgentConfig.enablePromptCache?: boolean`:

- `undefined` (default) — auto-enable for `api.anthropic.com` or `openrouter.ai` with `anthropic/*` model; off otherwise.
- `true` — force-on regardless of backend (use if your provider supports `cache_control` and you've verified the wire format).
- `false` — force-off (escape hatch).

Non-Anthropic backends (OpenAI, OpenRouter with non-anthropic models, local stubs, etc.) emit the standard request body unchanged.

**Where this matters most:** tool-heavy curator passes. With our `withAllowedToolPrefixes` filter (KB curation: `['conv_', 'kb_']`) we already saw ~65% input-token reduction per pass. With Anthropic prompt caching layered on top, each cron-driven sweep reuses ~35K tokens of cached prompt prefix at 10% the cost — expected ~80% additional reduction on warm cache, biggest absolute savings on the highest-volume jobs.

Conversational replies benefit too: per-conversation multi-turn within 5 min reuses the cached system prompt + tool stack.

No API change — existing callers (sidecar `runConversationHandler`, sidecar worker, cloud `AgentRunnerService`, `runSkillPass`) automatically get caching when their provider matches the auto-detect heuristic.
