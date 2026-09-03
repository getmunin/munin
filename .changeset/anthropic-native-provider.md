---
"@getmunin/agent-runtime": minor
"@getmunin/agent-host": patch
---

Call Anthropic's native Messages API instead of its OpenAI compatibility endpoint, so prompt caching actually works.

Orgs configured with the Anthropic provider preset were hitting `https://api.anthropic.com/v1/chat/completions` — the OpenAI SDK compatibility layer, which does not support prompt caching and silently ignores unsupported fields. Every `cache_control` marker the runtime emitted was being dropped, so the cache hit rate was zero and each request re-processed the whole system prompt and tool catalog at full price. The compat layer also returns an empty `usage.prompt_tokens_details`, so there was no signal that any of it was happening.

`anthropicNativeProvider` posts to `/messages` with `x-api-key` + `anthropic-version`, and `defaultProvider` routes `api.anthropic.com` to it while everything else (OpenRouter, OpenAI, self-hosted vLLM) keeps using the OpenAI-compatible provider. Three cache breakpoints per request: the tool catalog and the system blocks at a 1-hour TTL, since both are shared across every conversation in an org, and the newest turn at the default 5-minute TTL, so each iteration of a tool loop reads the previous iteration's prefix instead of re-processing the whole history. That last one matters most for tool-heavy turns, where KB search and conversation-export results dominate the prompt.

Assistant turns now round-trip their raw content blocks through `ChatMessage.providerContentBlocks`, so `thinking` blocks are echoed back byte-for-byte with their signatures. Without that, models where adaptive thinking is on by default reject the follow-up request that carries tool results. Cache breakpoints are only ever attached to `text` and `tool_result` blocks, never to a block we echo verbatim.

`ProviderUsage` gains `cache_read_input_tokens` and `cache_creation_input_tokens` from the native response, and prompt tokens are reported as uncached + cache-read + cache-write so token metering still sees the full prompt. Nothing reads the two cache counters yet — threading them into `AgentReply` and per-org usage is a follow-up.

The per-conversation context moves out of the cached prefix. `conv` used to append `You are replying in conversationId: <id>` to the end of the system prompt, which made the whole prefix — org system prompt, company profile, channel descriptor — vary per conversation and never share a cache entry. It is now passed as `AgentConfig.volatileSystemPrompt` and emitted as a trailing system block flagged `ChatMessage.volatile`, and the provider puts the breakpoint after the last non-volatile block (the same treatment the history-truncation note now gets). The stable prefix is shared by every conversation in an org. This helps the OpenRouter path too, whose breakpoint sits on the first system block and was previously carrying the conversation id along with it.

Also drops `api.anthropic.com` from the OpenAI-compatible provider's cache auto-detection, which was the source of the false confidence, and moves the shared rate-limit retry and `ProviderError` classification into `providers/transport.ts` so both providers use one implementation.
