---
'@getmunin/dashboard-pages': minor
'@getmunin/agent-host': minor
'@getmunin/agent-runtime': patch
---

feat(agent-host): bundled in-process agent runner

New `@getmunin/agent-host` package — a hosting layer that runs the
agent (chat replies + curator queue) in-process inside the backend,
replacing the separate `apps/agent-sidecar` topology.

What's in the package:

- `agent_config` table with both singleton (single-tenant) and
  multi-tenant DDL variants. Adds a `chat_model`/`curator_model`
  split so curation can use a stronger model than chat.
- `AgentConfigRepository` (singleton + per-org impls) and
  `AgentConfigService` for CRUD over the config row.
- `AdminKeyProvider` (no-op + auto-mint impls) for hosts that want
  rotated per-config admin credentials.
- `AgentHostRunner` — reconcile loop that spawns per-config
  `ConversationHandler` + curator worker. Multi-replica safe via a
  `ReplicaLockManager` that pins a postgres-js `sql.reserve()`
  client and uses `pg_try_advisory_lock` to elect a chat-loop owner
  per config; curator drains on every replica via existing SKIP
  LOCKED. Two-tier model dispatch: `chatModel` for chat,
  `curatorModel ?? chatModel` for `runSkillPass`.
- `AgentModelsService` — proxies the provider's `/v1/models`
  endpoint. Returns objective fields (id, contextLength, prompt /
  completion price per million) when the provider includes them
  (OpenRouter, Anthropic). 10-min in-memory cache.
- `AgentConfigController` — `GET/PUT /api/agent-config` and
  `GET /api/agent-config/models`, user-actor only.
- `AgentHostModule.forRoot({ configRepository, adminKeyProvider,
  runnerOptions })` for DI wiring; uses `useExisting: DB` against
  `@getmunin/backend-core`'s global `DbModule`.

`@getmunin/dashboard-pages`: new `AgentSetupPage` export — single-
form `/setup` wizard for first-run agent configuration.

`@getmunin/agent-runtime`: default `clientName` in
`mcp-client.ts` changed from `'munin-agent-sidecar'` to
`'munin-agent'` after the sidecar app was removed.
