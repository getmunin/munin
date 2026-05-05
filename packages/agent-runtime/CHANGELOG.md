# @getmunin/agent-runtime

## 0.20.0

### Minor Changes

- 80646e2: Adds opt-in Anthropic prompt caching to `openAiCompatibleProvider`. When the request targets an Anthropic-compatible backend (`api.anthropic.com/*` or `openrouter.ai/*` with `anthropic/*` model), the provider attaches `cache_control: { type: 'ephemeral' }` markers to:
  - the first system message (wrapped as a typed text block), and
  - the last entry in the `tools` array (caches the full tool stack as one block).

  These two breakpoints — system prompt and tool definitions — are the largest static chunks in any agent loop. With Anthropic's 5-minute TTL, the _first_ call writes the cache (small surcharge on input tokens) and _subsequent_ calls within the window read it at ~10% the cost.

  Detection is automatic but overridable via `AgentConfig.enablePromptCache?: boolean`:
  - `undefined` (default) — auto-enable for `api.anthropic.com` or `openrouter.ai` with `anthropic/*` model; off otherwise.
  - `true` — force-on regardless of backend (use if your provider supports `cache_control` and you've verified the wire format).
  - `false` — force-off (escape hatch).

  Non-Anthropic backends (OpenAI, OpenRouter with non-anthropic models, local stubs, etc.) emit the standard request body unchanged.

  **Where this matters most:** tool-heavy curator passes. With our `withAllowedToolPrefixes` filter (KB curation: `['conv_', 'kb_']`) we already saw ~65% input-token reduction per pass. With Anthropic prompt caching layered on top, each cron-driven sweep reuses ~35K tokens of cached prompt prefix at 10% the cost — expected ~80% additional reduction on warm cache, biggest absolute savings on the highest-volume jobs.

  Conversational replies benefit too: per-conversation multi-turn within 5 min reuses the cached system prompt + tool stack.

  No API change — existing callers (sidecar `runConversationHandler`, sidecar worker, cloud `AgentRunnerService`, `runSkillPass`) automatically get caching when their provider matches the auto-detect heuristic.

## 0.19.0

### Minor Changes

- d5cd41a: Adds `runSkillPass(opts)` to `@getmunin/agent-runtime` — a single-shot primitive that opens admin MCP against a Munin instance, reads a `skill://...` resource, and invokes `runAgent` with the skill body as system prompt and a caller-supplied user prompt. Returns `{ ok, toolCalls, totalTokens, finishReason, replyText }` or `{ ok: false, skipped: <reason> }`. Replaces the duplicated curator-pass plumbing that lives in both `munin-cloud/packages/curator-runner/src/scheduled-skill-runner.ts` and the OSS `scripts/curator-runner.mjs` — both can now import this primitive.

  Adds `onHandoverResolved` callback to `createRealtimeClient`. Parses `conversation.handover_resolved` events emitted by `conv.service.ts` when a human teammate's reply clears the `needsHumanAttention` flag. Payload: `{ conversationId, messageId, authorType }`. Wired up so the OSS sidecar can run KB curation per-handover (event-driven, scoped to one conversation) instead of waiting for a daily batch sweep.

  Updates `skill://kb/curation` to document a per-conversation mode: when the user prompt names a single `conversationId`, the agent skips `conv_list_conversations` and goes straight to that one conversation's (question, human-reply) pair. Batch mode stays the default. Same skill, two invocation patterns — no second skill needed.

- f57a86b: Rename `apps/self-service-ai` → `apps/agent-sidecar` (`@getmunin/self-service-ai` → `@getmunin/agent-sidecar`). The package's job has expanded from "self-service AI conversational reply" to "everything an OSS Munin needs as a runtime sidecar": conversations + event-driven KB curation on `conversation.handover_resolved` + scheduled CRM hygiene (weekly) + scheduled CMS stale-content review (monthly).

  Adds a persistent `curator_jobs` queue in the backend (new table `curator_jobs`, RLS-isolated, admin-only). The conv service now enqueues a `skill://kb/curation` job at the same point it emits `conversation.handover_resolved`, deduped by message id. The sidecar runs a push-driven worker that claims pending jobs (`SELECT … FOR UPDATE SKIP LOCKED`), runs `runSkillPass`, and acks/fails. Failures are retried with exponential backoff (30s, 1m, 2m, 4m, 8m) up to `maxAttempts` (default 5), then marked `dead`. Permanent failures (e.g. `skill_missing`) are reported with `retryable=false` and aren't retried.

  Wakeups go through the existing realtime gateway: every enqueue (and every retry-reschedule) emits a `curator_job.pending` event via Postgres `LISTEN/NOTIFY` → events table → DbListener → websocket → sidecar. Due-now events trigger an immediate claim; future-dated events (retry backoff) schedule a `setTimeout` for the delay. On websocket reconnect, the sidecar fires one drain to catch buffered work. No periodic polling.

  The queue gives at-least-once delivery across sidecar restarts and survives transient provider errors. Sidecar offline when the event was emitted? The job sits in `pending`; on reconnect the drain picks it up. Sidecar crashed mid-pass? The lease expires after 10 minutes; the next event triggers a re-claim. Provider returned 502? Failed with retryable=true, re-emitted with the new `nextAttemptAt`, sidecar schedules its own setTimeout to wake at the due time. The weekly KB sweep stays as a belt-and-suspenders measure but the queue is now the durable path.

  New REST endpoints (admin-only):
  - `POST /api/curator/jobs` — enqueue (used by `conv.service` internally; also available for ad-hoc operator scheduling).
  - `POST /api/curator/jobs/claim` — atomic batch claim with lease.
  - `POST /api/curator/jobs/:id/ack` — mark done with execution stats.
  - `POST /api/curator/jobs/:id/fail` — record error; retryable=true bumps `next_attempt_at`, retryable=false marks `failed`.
  - `GET /api/curator/jobs` / `GET /api/curator/jobs/:id` — inspect queue state.

  `MuninRestClient` exposes the corresponding methods (`enqueueCuratorJob`, `claimCuratorJobs`, `ackCuratorJob`, `failCuratorJob`).

  Sweep cadences moved from the sidecar to the backend via `@nestjs/schedule`. New `CuratorSchedulerService` registers cron jobs for KB sweep (weekly), CRM hygiene (weekly), and CMS stale-content (monthly), each enqueueing a job per org. Sidecar is now purely a queue worker. Benefits: declarative cron expressions instead of `setInterval` ms math, no Node-timer-overflow workaround needed, sweeps fire on cadence even if the sidecar is down (jobs accumulate, drain on next sidecar boot).

  New env-var prefix on the sidecar: `MUNIN_SIDECAR_*`. Existing `SELF_SERVICE_AI_*` env vars still work as deprecated aliases — when both are set, `MUNIN_SIDECAR_*` wins. Sidecar curator vars are now just two: `MUNIN_SIDECAR_CURATORS_DISABLED` (worker kill switch) and `MUNIN_SIDECAR_KB_CURATION_ON_HANDOVER` (cosmetic flag — backend always enqueues regardless).

  New env-vars on the backend: `MUNIN_CURATOR_KB_SWEEP_CRON`, `MUNIN_CURATOR_CRM_HYGIENE_CRON`, `MUNIN_CURATOR_CMS_STALE_CRON` (standard cron expressions; defaults `0 0 * * 0` weekly Sunday midnight, weekly Sunday midnight, `0 0 1 * *` monthly 1st at midnight). Set any to `off` or `0` to disable that sweep. `MUNIN_CURATOR_SCHEDULER_DISABLED=1` disables the entire scheduler.

  Operator review is required for every KB candidate (`kb_publish_curation_candidate`) and every CRM merge proposal (`crm_apply_merge_proposal`) — the sidecar never auto-applies. This is a system invariant: an LLM-drafted doc going straight to the public KB is exactly how you ship hallucinations to your end-users.

  Docker compose service renamed `self-service-ai` → `agent-sidecar`. The default MCP `clientName` in `@getmunin/agent-runtime` is now `munin-agent-sidecar` (was `munin-self-service-ai`); call sites that don't pass `clientName` will see this in MCP server logs.

  Migration: `0009_curator_jobs` adds the table + indexes. RLS in `rls.sql` blocks end-user contexts from seeing queue rows even within the same org. No data migration needed — the queue starts empty; existing handovers don't backfill.

## 0.18.0

### Minor Changes

- c996596: Fixes the dashboard timeline ordering when a self-service AI agent calls handover mid-turn. Previously the system note ("Agent requested handover: …") was inserted during the LLM tool-call execution, _before_ the agent's user-facing reply was posted, so the dashboard's chronological message list read: question → system note → reply. The agent's reply (`authorType=agent`) also auto-cleared the just-set `needs_human_attention` flag, so the conversation never stuck as flagged.

  Now:
  - `requestHandover` accepts `postSystemNote?: boolean` (default `true` for backwards compat — admin paths still get the note synchronously). The self-service `conv_request_handover_in_my_conversation` tool wrapper passes `false`, so the AI's tool-call only sets the flag.
  - `sendMessage` accepts `preserveAttention?: boolean`, plumbed through `POST /api/conversations/:id/messages` `ReplyBody`. When set, the message insert won't auto-clear the attention flag.
  - `MuninRestClient.postAgentMessage` accepts `{ preserveAttention?: boolean }`. New `postInternalNote(conversationId, body)` posts `internal: true` notes via the existing reply endpoint.
  - `conversation-handler.ts` detects handover (LLM tool-call OR audit dispatch), captures the reason, posts the visible reply with `preserveAttention: true`, then posts the internal note as a follow-up. Result for the operator: question → reply → system note, with the flag staying set.
  - The retry-exhausted handover path also posts a system note explaining the cause.

  Also includes scope and audit fixes that surfaced together:
  - `mintDelegatedToken` now requests `['conv:read', 'conv:write', 'kb:read', 'crm:read']` so the audit's force-call of `conv_request_handover_in_my_conversation` (and other self-service tools) actually has the scopes the backend gates them on. Previously the call was silently denied with `missing_scope:conv:write`.
  - The audit pass skips `response_format: { type: 'json_object' }` when the provider base URL is Anthropic's (Anthropic only accepts `json_schema`). The verdict parser already handles prose-wrapped JSON via `extractFirstJsonObject`, so dropping strict mode for Anthropic doesn't hurt parsing.
  - The conversation context (the actual `conversationId`) is now appended to the system prompt so the LLM has the real value to pass to tools that ask for it, instead of hallucinating `"current"`.

## 0.17.0

## 0.16.1

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
