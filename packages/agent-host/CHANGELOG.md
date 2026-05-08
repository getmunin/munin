# @getmunin/agent-host

## 0.24.1

### Patch Changes

- 89cfd8e: fix(agent-host): use native auth for Anthropic /v1/models

  Anthropic's OAI-compat shim accepts `Authorization: Bearer ...` for
  `/v1/chat/completions` but not for `/v1/models` — that endpoint
  requires the native `x-api-key` + `anthropic-version` headers.

  `AgentModelsService.fetchModels` now picks headers based on the
  provider URL: `x-api-key` + `anthropic-version: 2023-06-01` when the
  URL is `api.anthropic.com`, Bearer otherwise (OpenRouter, OpenAI,
  custom OAI-compat endpoints).

- e8fe8b4: fix(agent-host): inline DEFAULT literals in singleton DDL

  The drizzle `sql` template was interpolating two string constants
  (`DEFAULT_CHAT_MODEL`, `DEFAULT_PROVIDER_BASE_URL`) as parameters
  ($1, $2). Postgres rejects parameter binding in `DEFAULT` clauses
  on `CREATE TABLE` with syntax error 42601, so `pnpm --filter
@getmunin/backend migrate` failed on a fresh database. Inline the
  literal values directly into the SQL.

  Multi-tenant DDL was unaffected (no DEFAULTs).
  - @getmunin/core@0.24.1
  - @getmunin/db@0.24.1
  - @getmunin/backend-core@0.24.1
  - @getmunin/agent-runtime@0.24.1

## 0.24.0

### Minor Changes

- 950694e: feat(agent-host): bundled in-process agent runner

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

### Patch Changes

- Updated dependencies [950694e]
  - @getmunin/agent-runtime@0.24.0
  - @getmunin/core@0.24.0
  - @getmunin/db@0.24.0
  - @getmunin/backend-core@0.24.0
