---
'@getmunin/agent-runtime': patch
---

First publishable release of `@getmunin/agent-runtime` — the LLM agent loop kernel shared by the OSS self-service-ai sidecar and (forthcoming) cloud multi-tenant runner. Public API:

- `runAgent({ config, history, mcp, abortSignal?, provider? })` — tool-using LLM loop
- `compactHistory(history, maxChars)` — drops oldest turns to fit a budget; emits a system notice on truncation
- `openAiCompatibleProvider`, `createStubProvider` — provider implementations
- `mcpToolsToChatTools`, `flattenToolResult` — MCP ↔ OpenAI tool translation
- All public types (`AgentConfig`, `AgentReply`, `ConversationMessage`, `McpToolHandle`, etc.)

The package was added in #29 (sidecar) and extended in #31 (channel-aware prompt + history compaction); this changeset just makes it publishable to the GitHub Packages registry so cloud and other downstream consumers can install it.
