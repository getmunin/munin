# @getmunin/agent-runtime

## 0.10.0

### Minor Changes

- 2581531: Move the KB-backed prompt resolver into the agent-runtime package. The
  sidecar app imports it from `@getmunin/agent-runtime` instead of a
  local module so the cloud multi-tenant runner can reuse the same code.
  The shipped on-disk Markdown defaults (`prompts/system.md`,
  `prompts/channels/*.md`) ship with the package; consumers resolve them
  via the new `defaultPromptsDir()` helper.

  New exports: `createPromptResolver`, `defaultPromptsDir`,
  `PROMPT_SPACE_SLUG`, `SYSTEM_PROMPT_SLUG`, `CHANNEL_PROMPT_PREFIX`,
  type `PromptResolver`, type `CreatePromptResolverOptions`.

## 0.9.1

### Patch Changes

- 772a83d: First publishable release of `@getmunin/agent-runtime` — the LLM agent loop kernel shared by the OSS self-service-ai sidecar and (forthcoming) cloud multi-tenant runner. Public API:
  - `runAgent({ config, history, mcp, abortSignal?, provider? })` — tool-using LLM loop
  - `compactHistory(history, maxChars)` — drops oldest turns to fit a budget; emits a system notice on truncation
  - `openAiCompatibleProvider`, `createStubProvider` — provider implementations
  - `mcpToolsToChatTools`, `flattenToolResult` — MCP ↔ OpenAI tool translation
  - All public types (`AgentConfig`, `AgentReply`, `ConversationMessage`, `McpToolHandle`, etc.)

  The package was added in #29 (sidecar) and extended in #31 (channel-aware prompt + history compaction); this changeset just makes it publishable to the GitHub Packages registry so cloud and other downstream consumers can install it.
