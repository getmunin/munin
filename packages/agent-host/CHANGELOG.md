# @getmunin/agent-host

## 2.4.0

### Patch Changes

- Updated dependencies [009846d]
  - @getmunin/core@2.4.0
  - @getmunin/backend-core@2.4.0
  - @getmunin/db@2.4.0
  - @getmunin/agent-runtime@2.4.0

## 2.3.0

### Patch Changes

- Updated dependencies [d07dc99]
  - @getmunin/db@2.3.0
  - @getmunin/core@2.3.0
  - @getmunin/backend-core@2.3.0
  - @getmunin/agent-runtime@2.3.0

## 2.2.0

### Patch Changes

- Updated dependencies [f4515d8]
  - @getmunin/backend-core@2.2.0
  - @getmunin/core@2.2.0
  - @getmunin/db@2.2.0
  - @getmunin/agent-runtime@2.2.0

## 2.1.0

### Patch Changes

- Updated dependencies [f9ecaa9]
  - @getmunin/backend-core@2.1.0
  - @getmunin/core@2.1.0
  - @getmunin/db@2.1.0
  - @getmunin/agent-runtime@2.1.0

## 2.0.0

### Patch Changes

- @getmunin/core@2.0.0
- @getmunin/db@2.0.0
- @getmunin/backend-core@2.0.0
- @getmunin/agent-runtime@2.0.0

## 1.0.0

### Patch Changes

- Updated dependencies [dc34579]
  - @getmunin/backend-core@1.0.0
  - @getmunin/core@1.0.0
  - @getmunin/db@1.0.0
  - @getmunin/agent-runtime@1.0.0

## 0.25.0

### Minor Changes

- 8b15805: feat(agent-host): derive runner activation from provider key presence

  The `enabled` column on `agent_config` is gone — having a provider
  API key set is the activation signal. This removes a confusing
  toggle (a "configured but disabled" state nobody actually wanted)
  and makes the wizard simpler: paste a key and the runner starts.

  Behavior changes for upgraders:
  - Schema: `enabled` column dropped from `agent_config` via
    `ALTER TABLE ... DROP COLUMN IF EXISTS enabled` baked into both
    `AGENT_HOST_SINGLETON_DDL` and `AGENT_HOST_MULTI_TENANT_DDL`.
  - Existing rows with `enabled=false AND provider_api_key_ct IS NOT NULL`
    now become active. Operators that explicitly disabled an
    agent-with-creds should clear the provider key instead.
  - `AgentConfigRepository.listEnabledIds()` → `listProvisionedIds()`,
    filtering on `provider_api_key_ct IS NOT NULL`.
  - `AgentConfigPatch.enabled` and `AgentConfigDto.enabled` removed.
  - AdminKeyProvider hook signal: mint fires whenever the admin key
    id is missing while a provider key is set (enables auto-recovery
    for rows where the auto-mint never ran), revoke fires when the
    provider key is cleared.

### Patch Changes

- 8b15805: fix(agent-host): set app.crypt_key in service-role context + use actor orgId for auto-minted keys

  Two bugs surfaced while smoke-testing the bundled runner end-to-end:
  1. `runWithServiceContext` set `app.bypass_rls` but not
     `app.crypt_key`, so the runner's reconcile path crashed when
     trying to decrypt the provider API key (`unrecognized configuration
parameter "app.crypt_key"`). Now reads `MUNIN_ENCRYPTION_KEY` and
     sets the GUC alongside `bypass_rls`.
  2. `AutoMintAdminKeyProvider.mint` inserted into `api_keys` with
     `orgId: configId`. That worked for cloud (configId === orgId) but
     broke for OSS singleton (configId === 'singleton', not a real
     org). Now resolves orgId from the actor on the request context.
  - @getmunin/core@0.25.0
  - @getmunin/db@0.25.0
  - @getmunin/backend-core@0.25.0
  - @getmunin/agent-runtime@0.25.0

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
