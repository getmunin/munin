# @getmunin/agent-runtime

## 0.16.0

## 0.15.0

### Minor Changes

- 2bca7b3: Add a post-turn audit pass that reads (last user message, agent reply, tool
  names called this turn, the org's topic catalog) and returns a structured
  list of follow-up actions for the runtime to dispatch. Catches the common
  LLM failure mode where the agent's text says "let me flag this for a
  teammate" but no handover tool was actually called, plus generalizes to
  other automatic moves the runtime should make on the conversation.

  Action types supported today:
  - `request_handover` — reply implies handover but no handover tool was
    called. Force-calls `conv_request_handover_in_my_conversation` via the
    per-conversation delegated MCP.
  - `close_conversation` — end-user clearly said "thanks, that's all".
    Calls `POST /api/conversations/:id/status` with `status: closed`.
  - `snooze_conversation` — user asked to be followed up later. Same
    endpoint with `status: snoozed` + `snoozeUntil = now + untilHours`.
  - `mark_spam` — user message is automated / promotional / off-topic.
    Same endpoint with `status: spam`.
  - `set_topic` — picks one of the org's existing topic slugs. Calls a new
    endpoint `POST /api/conversations/:id/topic`.

  Audit dispatch routes via the existing admin REST client the handler
  already holds (it's how the handler fetches history and posts replies).
  No new MCP factory needed — the runner doesn't have to wire anything up.
  The only new dep on the handler side is three more methods on
  `MuninRestClient` (`changeStatus`, `setTopic`, `listTopics`) which the
  package's `createMuninRestClient` factory implements against the new
  backend endpoints.

  OSS backend-core adds:
  - New admin tool `conv_set_topic({ conversationId, topicId | null })` for
    any admin agent (Claude Desktop, the cloud curator) that wants to apply
    topics from MCP.
  - New REST endpoints `POST /api/conversations/:id/topic` and
    `GET /api/conversations/topics` (admin) — both wrap existing service
    methods.

  The audit only ever picks topic slugs from the catalog the runtime fetched
  via `rest.listTopics()`; the LLM cannot invent slugs (parser drops
  anything not in the catalog).

  Failure mode is fail-open: provider errors or unparseable JSON return
  `{ actions: [] }` so a misbehaving audit cannot silence real replies.

  New `@getmunin/agent-runtime` exports: `auditConversation`, types
  `AuditAction`, `AuditConversationArgs`, `AuditTopic`, `AuditVerdict`,
  `ConversationStatus`, `ConversationTopic`. New `HandlerConfig` fields:
  `auditEnabled?: boolean` (default true), `auditModel?: string`. New
  `AgentConfig` field: `responseFormat?: 'json_object'`.

## 0.14.0

### Minor Changes

- 7ff2ffa: Add a post-turn audit pass that catches a common LLM failure mode: the agent
  writes "let me flag this for a teammate" but never actually calls
  `conv_request_handover_in_my_conversation`, leaving the dashboard's
  `needsHumanAttention` count out of sync with what the user was told.

  After `runAgent` produces a reply, the conversation handler now fires a small
  classifier LLM call that reads the (last user message, agent reply, names of
  tools the agent called this turn) and returns a structured verdict
  `{ handover: boolean, reason: string }`. If the audit says handover but the
  agent didn't call the tool itself, the runtime force-calls it before posting
  the reply.

  New exports: `auditReply`, type `AuditReplyArgs`, type `AuditVerdict`. New
  fields on `HandlerConfig`: `auditEnabled?: boolean` (default true),
  `auditModel?: string` (defaults to the main turn's model). New field on
  `AgentConfig`: `responseFormat?: 'json_object'` (the audit uses it; consumers
  can use it for any classifier-style call).

  Fails open on provider errors or unparseable JSON — the agent's reply gets
  posted as-is and the failure is logged, so a misbehaving audit can't drop
  real replies on the floor.

## 0.13.0

## 0.12.0

## 0.11.0

### Minor Changes

- 9fa925b: Move the four shared runtime helpers — `createConversationHandler`,
  `createMuninRestClient`, `createRealtimeClient`, `openMcpClient` —
  from the OSS sidecar app into the agent-runtime package, so the cloud
  multi-tenant runner and any future runner can reuse them instead of
  maintaining their own copies.

  The handler now takes a minimal `HandlerConfig` (the 6 inference-loop
  fields: provider URL/key, model, max tool iterations, max history
  chars, debounce ms) instead of a deployment-specific config type.
  Existing consumers can pass any config object that has those fields.

  `@modelcontextprotocol/sdk` and `ws` move from the sidecar's
  dependencies into agent-runtime's, since they're needed by the
  extracted clients. Consumers shouldn't need to add them themselves
  anymore.

  New exports: `createConversationHandler`, `createMuninRestClient`,
  `createRealtimeClient`, `openMcpClient`, plus their option/result/handle
  types: `HandlerConfig`, `ConversationHandler`, `ConversationHandlerDeps`,
  `IncomingMessage`, `OpenedMcp`, `ConversationDetail`,
  `CreateMuninRestClientOptions`, `DelegatedToken`, `MuninRestClient`,
  `OpenMcpClientOptions`, `OpenedMcpClient`, `KbDocumentChangedEvent`,
  `MessageReceivedEvent`, `RealtimeClient`, `RealtimeClientOptions`.

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
