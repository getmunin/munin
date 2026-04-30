# @getmunin/backend-core

## 0.7.0

### Minor Changes

- 93c385a: Publish runbooks to connecting MCP agents via the spec's standard primitives.
  - `@getmunin/mcp-toolkit` adds `RunbookRegistry` (parallel to `McpToolRegistry`) and extends `createMcpServer` with optional `runbooks` and `instructions` fields. When runbooks are provided the server declares the `resources` capability and registers `resources/list` + `resources/read` handlers, audience-filtered the same way tools are.
  - `@getmunin/backend-core` ships a markdown runbook loader that scans `src/modules/**/runbooks/*.md` at boot, parses YAML frontmatter, and registers each into a `RunbookRegistry`. The MCP controller passes the registry plus an auto-generated `instructions` string into every per-request server.
  - Five starter runbooks: email-channel-setup, widget-onboarding, handoff-from-ai-agent, customer-onboarding, kb/import-from-google-docs.
  - Build step copies `*.md` from `src` to `dist` so runbooks ship inside the published tarball.

  Result: agents connecting to `/mcp` get a short orientation in their `initialize` response (`instructions` field) and can discover detailed workflow guides via `resources/list`.

### Patch Changes

- Updated dependencies [93c385a]
  - @getmunin/mcp-toolkit@0.7.0
  - @getmunin/core@0.7.0
  - @getmunin/db@0.7.0
  - @getmunin/types@0.7.0
  - @getmunin/bootstrap@0.7.0

## 0.6.0

### Minor Changes

- 1aaaa24: Move suggestions feature out of OSS to a private feature board.

  The `suggestions` feature was structured as a Canny-clone but its `appScope`
  enum (`kb | conv | crm | core`) was hardcoded to Munin's own modules — the
  real intent was a vendor roadmap, not per-org product feedback.

  **Breaking changes (pre-1.0; consumers must update at the same minor):**
  - Removed `SuggestionsModule` from `@getmunin/backend-core`.
  - Removed `suggestions` and `votes` tables from `@getmunin/db`'s published
    schema. New OSS migration `0002_drop_suggestions.sql` drops the tables on
    fresh and existing installs (idempotent).
  - Removed RLS policies for `suggestions` / `votes` from `rls.sql`.
  - Removed `SuggestionsPage`, `CommunityBoardPage`, and the
    `publicSuggestionsMetadata` / `publicSuggestionsRevalidate` exports from
    `@getmunin/dashboard-pages`.
  - Removed `/api/suggestions` and `/api/public/suggestions` REST routes.
  - Removed five MCP tools (`suggestion_*`) from the OSS surface.
  - Removed `suggestions` from the data-export bundle.

  The replacement lives in a downstream package. Voting is now per-org instead of
  per-actor — one vote per `(suggestion_id, org_id)` so multiple
  users/agents in the same customer org collectively contribute one vote.
  The five MCP tool names are unchanged; admins/agents keep calling
  `suggestion_search`, `suggestion_create`, etc., but they hit the cloud
  schema.

  **OSS users who relied on the per-org board:** the feature is gone. Build
  your own roadmap using the existing CRM/CMS primitives or a third-party
  tool. (No public OSS deployment uses it pre-this release.)

### Patch Changes

- Updated dependencies [1aaaa24]
  - @getmunin/db@0.6.0
  - @getmunin/bootstrap@0.6.0
  - @getmunin/core@0.6.0
  - @getmunin/mcp-toolkit@0.6.0
  - @getmunin/types@0.6.0

## 0.5.0

### Minor Changes

- 6506b10: Channel-adapter contract + chat-widget adapter.

  Generalizes the conversation channel runtime: a single `ChannelAdapter`
  interface (poll / webhook / push inbound modes), generic `InboundPollWorker`
  and `OutboundDeliveryWorker` that dispatch by `conv_channels.type`, and a
  `POST /api/channels/:id/webhook` scaffold for future webhook-mode adapters
  (SMS, voice). Email is refactored behind the new contract — no behavior
  change; the existing email integration test passes unchanged.

  New chat-widget channel kind for external AI agents (chat widgets on
  customer sites) to push transcripts into Munin's `conv_*` tables. Includes:
  - `mn_widget_*` API key kind, channel-bound via new nullable
    `api_keys.channel_id` column.
  - `POST /api/conv/widget/messages` — public ingest endpoint authenticated
    by the widget key. Idempotent on `metadata.providerMessageId`; conv
    upsert by `metadata.sessionId`.
  - MCP admin tools: `conv_widget_create_channel`, `conv_widget_rotate_key`,
    `conv_widget_update_channel`.

  Schema changes:
  - New `conv_inbound_state(channel_id, cursor jsonb, ...)` replaces the
    email-only `conv_email_inbound_state`. Existing rows backfilled.
  - `api_keys.channel_id` (nullable, FK to `conv_channels`).
  - Two partial unique expression indexes for widget idempotency.

  The email worker env vars `MUNIN_EMAIL_INBOUND_WORKER_DISABLED` and
  `MUNIN_EMAIL_OUTBOUND_WORKER_DISABLED` are still honored as aliases of
  `MUNIN_INBOUND_POLL_WORKER_DISABLED` and `MUNIN_OUTBOUND_DELIVERY_WORKER_DISABLED`.

### Patch Changes

- Updated dependencies [6506b10]
  - @getmunin/db@0.5.0
  - @getmunin/core@0.5.0
  - @getmunin/bootstrap@0.5.0
  - @getmunin/mcp-toolkit@0.5.0
  - @getmunin/types@0.5.0

## 0.4.0

### Minor Changes

- 9ef40a4: Upgrade NestJS to v11 (was v10). Patches GHSA-36xv-jgw5-4q75 (SSE field
  injection). Consumers of `@getmunin/backend-core` must upgrade their own
  `@nestjs/*` deps to `^11.x` and `express` to `^5.x`. Wildcard route paths
  must use the new path-to-regexp v8 syntax (e.g. `*splat` instead of `:rest(.*)`).

### Patch Changes

- @getmunin/core@0.4.0
- @getmunin/db@0.4.0
- @getmunin/types@0.4.0
- @getmunin/mcp-toolkit@0.4.0
- @getmunin/bootstrap@0.4.0

## 0.3.1

### Patch Changes

- fe8fd21: TenancyInterceptor: bypass RLS for `actor.type === 'partner'`.

  Partner actors (in a downstream package) operate across multiple orgs they
  provisioned. Their controllers filter manually by `partner_id`. OSS
  never produces `'partner'` actors, so this branch is dead code there.

- Updated dependencies [fe8fd21]
  - @getmunin/core@0.3.1
  - @getmunin/db@0.3.1
  - @getmunin/types@0.3.1
  - @getmunin/mcp-toolkit@0.3.1
  - @getmunin/bootstrap@0.3.1

## 0.3.0

### Minor Changes

- 5c140d5: Add credential-resolver extension point to AuthGuard.

  `AuthGuard` now accepts an optional injected `AdditionalCredentialResolver[]`
  via the `ADDITIONAL_CREDENTIAL_RESOLVERS` token. When OSS's `resolveApiKey`
  returns null, each additional resolver gets a shot at the raw key.
  Downstream packages plug in via this token to recognize their own key
  kinds without touching OSS code.

  `looksLikeApiKey` regex broadened from `mn_(admin|dlg)_*` to `mn_[a-z]+_*`
  so additional kinds reach the resolver chain.

### Patch Changes

- Updated dependencies [5c140d5]
  - @getmunin/core@0.3.0
  - @getmunin/db@0.3.0
  - @getmunin/types@0.3.0
  - @getmunin/mcp-toolkit@0.3.0
  - @getmunin/bootstrap@0.3.0

## 0.2.0

### Minor Changes

- f3abef4: Add cross-org switcher endpoint + UI.
  - New `GET /api/orgs/me/memberships` — list every org the caller is a member of (id, name, slug, role, isDefault).
  - New `PATCH /api/orgs/me/memberships/active` — flip `is_default` so the next session-cookie request resolves to the chosen org.
  - New `<OrgSwitcher />` component in `@getmunin/dashboard-pages` that wraps both endpoints. Cloud's dashboard layout renders it in the header.

  OSS (single-tenant) installs see exactly one membership and don't render a switcher.

### Patch Changes

- Updated dependencies [f3abef4]
  - @getmunin/core@0.2.0
  - @getmunin/db@0.2.0
  - @getmunin/types@0.2.0
  - @getmunin/mcp-toolkit@0.2.0
  - @getmunin/bootstrap@0.2.0
