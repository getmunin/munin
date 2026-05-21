# @getmunin/agent-host

## 4.4.0

### Patch Changes

- @getmunin/core@4.4.0
- @getmunin/db@4.4.0
- @getmunin/types@4.4.0
- @getmunin/backend-core@4.4.0
- @getmunin/agent-runtime@4.4.0

## 4.3.0

### Patch Changes

- Updated dependencies [21a8189]
- Updated dependencies [21a8189]
  - @getmunin/backend-core@4.3.0
  - @getmunin/core@4.3.0
  - @getmunin/db@4.3.0
  - @getmunin/types@4.3.0
  - @getmunin/agent-runtime@4.3.0

## 4.2.0

### Patch Changes

- Updated dependencies [0040252]
  - @getmunin/backend-core@4.2.0
  - @getmunin/core@4.2.0
  - @getmunin/db@4.2.0
  - @getmunin/types@4.2.0
  - @getmunin/agent-runtime@4.2.0

## 4.1.1

### Patch Changes

- @getmunin/core@4.1.1
- @getmunin/db@4.1.1
- @getmunin/types@4.1.1
- @getmunin/backend-core@4.1.1
- @getmunin/agent-runtime@4.1.1

## 4.1.0

### Patch Changes

- Updated dependencies [de1a7a6]
  - @getmunin/core@4.1.0
  - @getmunin/agent-runtime@4.1.0
  - @getmunin/backend-core@4.1.0
  - @getmunin/db@4.1.0
  - @getmunin/types@4.1.0

## 4.0.0

### Patch Changes

- @getmunin/core@4.0.0
- @getmunin/db@4.0.0
- @getmunin/types@4.0.0
- @getmunin/backend-core@4.0.0
- @getmunin/agent-runtime@4.0.0

## 3.9.1

### Patch Changes

- @getmunin/core@3.9.1
- @getmunin/db@3.9.1
- @getmunin/types@3.9.1
- @getmunin/backend-core@3.9.1
- @getmunin/agent-runtime@3.9.1

## 3.9.0

### Minor Changes

- ed2bb6b: Add generic `SmtpMailer` provider to `@getmunin/core`.

  Covers any SMTP-speaking transactional email service (Scaleway TEM, Postmark,
  Mailgun, Postmark, etc.) via a single implementation. Activated by setting
  `MUNIN_MAIL_PROVIDER=smtp` along with `MUNIN_SMTP_HOST`, `MUNIN_SMTP_PORT`,
  `MUNIN_SMTP_USER`, `MUNIN_SMTP_PASSWORD` (optional `MUNIN_SMTP_SECURE=1` for
  implicit-TLS on port 465). `nodemailer` is the underlying transport.

### Patch Changes

- Updated dependencies [ed2bb6b]
  - @getmunin/core@3.9.0
  - @getmunin/db@3.9.0
  - @getmunin/types@3.9.0
  - @getmunin/backend-core@3.9.0
  - @getmunin/agent-runtime@3.9.0

## 3.8.0

### Minor Changes

- a3f532e: Onboarding cleanup, agent-config hot-reload, provider auth validation.
  - Dropped the chatbot-name field from the onboarding form; new orgs seed with an empty name so step 1 is shown until the user names their bot.
  - Removed the unused `orgs.slug` column (migration 0027); CMS delivery routes (`/api/v1/cms/:orgId/...`) and the matching SDK clients now key on `orgId` rather than the slug.
  - `AgentConfigService` validates provider credentials _before_ persisting — OpenRouter is probed via `/auth/key` (since its `/models` endpoint is public), Anthropic/OpenAI rely on `/models` 401. Bad keys no longer silently overwrite a working config.
  - Saving agent config emits `agent.config.updated` via the WebhookDispatcher; the realtime gateway broadcasts it and `AgentHostRunner` respawns the affected runner — model/provider changes apply without a backend restart.
  - Models picker reconciles a stale stored model slug against the fetched model list at render time, so the dropdown can't round-trip an unknown id back to the server.
  - Chat widget no longer filters the current session's conversation out of the past-conversation list — going back from a fresh conversation shows it.

### Patch Changes

- Updated dependencies [a3f532e]
  - @getmunin/agent-runtime@3.8.0
  - @getmunin/backend-core@3.8.0
  - @getmunin/db@3.8.0
  - @getmunin/core@3.8.0
  - @getmunin/types@3.8.0

## 3.7.0

### Minor Changes

- 1cec7ea: Make `@getmunin/dashboard-pages` the canonical home for OSS messages so downstream apps don't have to copy the shared keys.

  **New exports:**
  - `loadBaseMessages(locale)` — dynamic-imports the bundled `en.json` / `nb.json`. Returns a `MessagesTree`.
  - `mergeMessages(base, overrides)` — recursive deep merge for spreading host-app overrides on top of the base messages.
  - `BASE_LOCALES` / `BaseLocale` — the locale set the package ships translations for.

  The OSS web app's `apps/web/messages/{en,nb}.json` are gone — their content moved to `packages/dashboard-pages/src/messages/`. `apps/web/i18n/request.ts` now calls `loadBaseMessages(locale)` directly.

  Downstream apps (e.g. munin-cloud) can adopt the same loader and pass only their cloud-specific overrides:

  ```ts
  const base = await loadBaseMessages(locale);
  const overrides = (await import(`../messages/${locale}.json`)).default;
  return { locale, messages: mergeMessages(base, overrides) };
  ```

  This is additive — no existing exports removed.

### Patch Changes

- Updated dependencies [1cec7ea]
  - @getmunin/core@3.7.0
  - @getmunin/db@3.7.0
  - @getmunin/types@3.7.0
  - @getmunin/backend-core@3.7.0
  - @getmunin/agent-runtime@3.7.0

## 3.6.0

### Minor Changes

- bbd1d03: Extract dashboard + settings shells from `@getmunin/web` into `@getmunin/dashboard-pages` so downstream consumers can compose the same dashboard structure instead of redeclaring it.

  **New exports from `@getmunin/dashboard-pages`:**
  - `DashboardShell` — wraps `useDashboardGate`, session check, topbar render, and the `inSettings` pathname toggle. Props: `brand`, `logoSrc?`, `leftSlot?`, `withConfirmDialog?`.
  - `SettingsShell` — wraps the settings layout: role gate, `SettingsTopbar`, `RailNav` sidebar built from a `groups` prop, and the mobile `Sheet`. Consumers pass a `SettingsSubNavGroup[]`.
  - `OSS_SETTINGS_GROUPS` — the canonical OSS settings nav config (moved from `apps/web/.../nav-config.ts`).
  - `extendSettingsGroups(base, extensions)` — merges items into existing groups (or appends a new group). Supports `insertAfter`, `insertBefore` (by slug or labelKey), and `position: 'start' | 'end'` for ordering.
  - `createSettingsIndexRedirect({ defaultLocale, target? })` — factory for the `settings/page.tsx` default redirect.

  **Convention:** any `labelKey` you put in a settings group must have a matching `nav.*` entry in the host app's `messages/*.json`. Group keys map to `dashboard.settings.groups.*`.

  This is purely additive — no public API removed. The web app's own `dashboard/{layout,settings/layout,settings/page}.tsx` files were collapsed onto the new shells in the same PR (#166).

### Patch Changes

- Updated dependencies [bbd1d03]
  - @getmunin/core@3.6.0
  - @getmunin/db@3.6.0
  - @getmunin/types@3.6.0
  - @getmunin/backend-core@3.6.0
  - @getmunin/agent-runtime@3.6.0

## 3.5.0

### Minor Changes

- be32cb4: Email channel polish, read tracking, and agent-model tier rename.

  **Email channel (#136, #140)**
  - New "Send test email" action in the channel dropdown — opens a dialog
    prefilled with the logged-in user's email, sends via the channel's real
    outbound transport.
  - SMTP/IMAP networking: force IPv4 DNS resolution at backend startup
    (fixes `EHOSTUNREACH` on hosts with broken IPv6 routing); auto-pick TLS
    mode by port (465 implicit, 587/25/2525 STARTTLS).
  - SMTP error surfacing: readable messages for `EAUTH` / `ECONNECTION` /
    `EENVELOPE` plus the server's response text, replacing generic
    "Internal error".
  - Inbound mail now creates an `end_users` row keyed
    `external_id = email:<addr>` and links the contact; agent runtime no
    longer skips conversations with "no end-user bound".
  - Inbound dedupe on RFC-5322 `Message-ID` — defense-in-depth against
    cursor failures, UIDVALIDITY changes, restored backups.
  - IMAP poll fixes: cursor read/write use `app.bypass_rls=on`; fetch by
    UID range instead of sequence numbers; per-tick logging.
  - Strip quoted reply blocks (multi-language) AND signatures (RFC 3676 +
    mobile-client openers + common separators) before persisting inbound
    bodies. Nested-quote prior 3 messages in outbound replies; add `Re:`
    prefix when missing.

  **Read tracking (#137, #139)**
  - New `conv_message_reads` table; chat widget reports agent messages as
    read when they enter the viewport (`IntersectionObserver` + 200 ms
    coalesce window). Backend gateway handles the `read` WS frame,
    inserts with `ON CONFLICT DO NOTHING`, emits
    `conversation.message.read` webhook per new row.
  - Email open pixel: opt-in per channel (`trackOpens` flag), HMAC-signed
    token, `GET /api/v1/c/o/:token.gif` endpoint returns a transparent
    GIF and bumps `first_opened_at` / `last_opened_at` / `open_count` on
    `conv_message_deliveries`. Emits `conversation.message.opened` on
    first open.
  - Operator-side "Seen HH:MM" badge under outbound messages in the
    dashboard conversation drawer. Live-updates through the existing
    realtime hook on `conversation.message.read` events.

  **Model tier rename (#141)**
  - `chatModel` → `fastModel`, `curatorModel` → `smartModel` across
    `agent_config` schema, types, controllers, dashboard form, and i18n
    strings. Capability tiers instead of use-cases — every code path
    picks the right tier without adding a new column per feature.
  - Idempotent `ALTER COLUMN RENAME` in both DDL strings handles
    existing databases.
  - Dashboard form now shows example use-cases under each field.

  **Schema migrations**
  - `0020_conv_read_and_open_tracking.sql` — `conv_message_reads` table
    - `first_opened_at` / `last_opened_at` / `open_count` columns on
      `conv_message_deliveries`.
  - `agent_config` `chat_model` → `fast_model`, `curator_model` →
    `smart_model` (idempotent rename inside the agent-host DDL).

### Patch Changes

- Updated dependencies [be32cb4]
  - @getmunin/core@3.5.0
  - @getmunin/db@3.5.0
  - @getmunin/backend-core@3.5.0
  - @getmunin/agent-runtime@3.5.0

## 3.4.1

### Patch Changes

- @getmunin/core@3.4.1
- @getmunin/db@3.4.1
- @getmunin/backend-core@3.4.1
- @getmunin/agent-runtime@3.4.1

## 3.4.0

### Patch Changes

- @getmunin/core@3.4.0
- @getmunin/db@3.4.0
- @getmunin/backend-core@3.4.0
- @getmunin/agent-runtime@3.4.0

## 3.2.1

### Patch Changes

- c5e93e1: Add a `development` package-export condition pointing at `./src/index.ts` (and `./src/schema.ts` for `@getmunin/db`). Loaders that resolve with `--conditions=development` (e.g. the OSS backend's new `node --import @swc-node/register/esm-register --watch --conditions=development src/main.ts` dev script) see the TypeScript source directly; the existing `types` → `dist/*.d.ts` and `default` → `dist/*.js` resolution paths are unchanged, so production runtime, typecheck, and downstream consumers that don't opt into the condition keep their current behavior.
- Updated dependencies [c5e93e1]
  - @getmunin/core@3.2.1
  - @getmunin/db@3.2.1
  - @getmunin/backend-core@3.2.1
  - @getmunin/agent-runtime@3.2.1

## 3.2.0

### Patch Changes

- Updated dependencies [9d84e3c]
  - @getmunin/backend-core@3.2.0
  - @getmunin/core@3.2.0
  - @getmunin/db@3.2.0
  - @getmunin/agent-runtime@3.2.0

## 3.1.0

### Patch Changes

- @getmunin/core@3.1.0
- @getmunin/db@3.1.0
- @getmunin/backend-core@3.1.0
- @getmunin/agent-runtime@3.1.0

## 3.0.0

### Patch Changes

- Updated dependencies [e5a5450]
  - @getmunin/db@3.0.0
  - @getmunin/core@3.0.0
  - @getmunin/backend-core@3.0.0
  - @getmunin/agent-runtime@3.0.0

## 2.5.1

### Patch Changes

- 169f71c: fix(agent-host): dedupe runner-spawn-failure logs

  The runner reconcile loop attempts to spawn a runner for every provisioned `agent_config` row every 30 seconds. When the admin API key in `agent_config.admin_api_key_ct` doesn't resolve to a live `api_keys` row (e.g. after a partial DB reset), every spawn attempt logs an `ERROR` — N error lines per minute, indefinitely.

  Now the same `(config_id, error_message)` is only logged at ERROR level once per 10 minutes. Subsequent identical failures during the cooldown emit at DEBUG level. A successful spawn (or a different error) resets the dedup state so the next failure is reported promptly.

  The underlying credential mismatch is still surfaced — just not as a stuck error stream that drowns out everything else.
  - @getmunin/core@2.5.1
  - @getmunin/db@2.5.1
  - @getmunin/backend-core@2.5.1
  - @getmunin/agent-runtime@2.5.1

## 2.5.0

### Patch Changes

- @getmunin/core@2.5.0
- @getmunin/db@2.5.0
- @getmunin/backend-core@2.5.0
- @getmunin/agent-runtime@2.5.0

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
