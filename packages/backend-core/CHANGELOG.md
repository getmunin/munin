# @getmunin/backend-core

## 4.21.0

### Minor Changes

- cc45f6c: Rename `BACKEND_FEATURE_MODULES_NO_AUTH` to `BACKEND_FEATURE_MODULES` and surface the `feedback_*` tools + REST paths in the docs fixtures.
  - The old name suggested "modules that don't require auth"; the actual meaning is "feature modules, with no AuthModule included". The shorter name plus the long-standing comment above the list communicates that more clearly. Downstream consumers must update their import.
  - `FeedbackModule` is now imported by `backend-core`'s in-package `AppModule`, which is what the docs/openapi generator and integration tests boot. Runtime behavior in `apps/backend` is unchanged: feedback is still gated by `MUNIN_FEEDBACK_ENABLED` per deployment. The MCP docs page and OpenAPI spec now document the five `feedback_*` tools and three REST routes so end users know they exist even when not enabled.

### Patch Changes

- @getmunin/core@4.21.0
- @getmunin/db@4.21.0
- @getmunin/types@4.21.0
- @getmunin/mcp-toolkit@4.21.0
- @getmunin/agent-runtime@4.21.0

## 4.20.0

### Minor Changes

- cedba8d: Adds an opt-in feedback module: OSS instances can collect feedback locally and, with an org admin's explicit approval, forward each item to `feedback.getmunin.com`. Gated by `MUNIN_FEEDBACK_ENABLED` (default `false`) — when disabled, no controllers, no MCP tools, no outbound code path is loaded.
  - `db`: new `feedback_outbox` table (org-scoped, RLS) for pending items and `system_config` for the deployment-wide `instance_id`. Drizzle migration `0032_feedback_outbox.sql`.
  - `backend-core`: `@Global() FeedbackModule` exposing `feedback_{create,list,get,approve,reject}` MCP tools and `POST /v1/feedback` + `/:id/{approve,reject}` REST routes. `InboxController` takes `@Optional() FeedbackService` so pending items appear inline in `GET /v1/inbox`'s queue when the module is loaded. Approval signs the outbound payload with `HMAC(instance_id, "munin-feedback-intake-v1")` so cloud can verify by re-deriving. Also renames `assistants.controller`'s `getOrCreate()` → `findOrCreateAssistant()` to match the dominant `findOrCreate*` convention.
  - `dashboard-pages`: extends `QueueItem` / `useQueueBuilder` / `QueueRow` / `QueueDrawer` with a `feedback` kind so pending items render in the unified inbox queue, with attribution copy disclosing data flow to Munin developers.
  - `ui`: new `feedback` tone variant on `Pill`.

- 75ad065: Add GitHub OAuth sign-in alongside Google and expose a public `/v1/auth/providers` endpoint so the login UI can show only the providers the deployment has actually configured.
  - `backend-core`: new `readGithubProviderFromEnv()` reading `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET`, and a new anonymous `AuthProvidersController` at `GET /v1/auth/providers` returning `{ google, github }` booleans.
  - `dashboard-pages`: split `use-auth-providers.tsx` into a `'use client'` hook module and a server-safe `fetch-auth-providers.ts` so server components (e.g. the OSS login page in Next 16) can call `fetchAuthProviders()` without tripping the RSC client-boundary check. Adds `GoogleLogo` / `GithubLogo` exports, `or` + `googleButton` / `githubButton` i18n strings (en + nb), and uppercases the first OSS auth footer item.

### Patch Changes

- Updated dependencies [cedba8d]
  - @getmunin/db@4.20.0
  - @getmunin/core@4.20.0
  - @getmunin/agent-runtime@4.20.0
  - @getmunin/mcp-toolkit@4.20.0
  - @getmunin/types@4.20.0

## 4.19.4

### Patch Changes

- aa30308: Fix silent handover when the agent runtime exhausts retries against an unhealthy LLM provider.
  - `conversation-handler` now calls a new admin REST endpoint (`POST /v1/conversations/:id/request-handover` with `publicFallbackMessage`) instead of routing handover through an end-user MCP tool call. The MCP path required `conv:write` scope on the end-user agent actor, which the in-process agent host doesn't grant — so the call was being silently denied with an MCP `errorResult`, leaving the conversation un-flagged and the end user staring at an empty widget.
  - `convService.requestHandover()` now accepts an optional `publicFallbackMessage`. When set, it posts a user-visible agent message (`internal: false`, `metadata.kind = "handover_fallback"`) so the end user sees confirmation that a teammate is coming, even when the LLM never produced any reply. Mirrored on the admin `conv_request_handover` MCP tool and `POST /v1/conversations/:id/request-handover` HTTP route.
  - `MuninRestClient` gains a `requestHandover(conversationId, { reason, publicFallbackMessage })` method.

- Updated dependencies [aa30308]
- Updated dependencies [623dd4d]
  - @getmunin/agent-runtime@4.19.4
  - @getmunin/mcp-toolkit@4.19.4
  - @getmunin/core@4.19.4
  - @getmunin/db@4.19.4
  - @getmunin/types@4.19.4

## 4.19.3

### Patch Changes

- @getmunin/core@4.19.3
- @getmunin/db@4.19.3
- @getmunin/types@4.19.3
- @getmunin/mcp-toolkit@4.19.3
- @getmunin/agent-runtime@4.19.3

## 4.19.2

### Patch Changes

- @getmunin/core@4.19.2
- @getmunin/db@4.19.2
- @getmunin/types@4.19.2
- @getmunin/mcp-toolkit@4.19.2
- @getmunin/agent-runtime@4.19.2

## 4.19.1

### Patch Changes

- Updated dependencies [fb04e33]
  - @getmunin/agent-runtime@4.19.1
  - @getmunin/core@4.19.1
  - @getmunin/db@4.19.1
  - @getmunin/types@4.19.1
  - @getmunin/mcp-toolkit@4.19.1

## 4.19.0

### Patch Changes

- 0501880: Rename the Partner-access settings nav label key and adjust the MCP
  tool-name guard test.
  - `dashboard-pages`: `nav.partnerAccess` → `nav.partner` (en + nb). The
    cloud overlay now uses `labelKey: 'partner'` and a shorter "Partner"
    label, moved from the Workspace group to Access & integrations.
  - `backend-core`: the OSS MCP integration test's negative assertion is
    updated to `feedback_create` to match the cloud-feedback module's
    renamed tools (`suggestion_*` → `feedback_*`). OSS behavior is
    unchanged — the guard still verifies cloud-only tools don't leak.

  No production users yet, so no backwards-compat aliasing.
  - @getmunin/core@4.19.0
  - @getmunin/db@4.19.0
  - @getmunin/types@4.19.0
  - @getmunin/mcp-toolkit@4.19.0
  - @getmunin/agent-runtime@4.19.0

## 4.18.0

### Minor Changes

- a0d31d7: Collapse the public URL surface to three vars, drop the path rewriter,
  and split MCP from auth.
  - Rename Nest mount `/api/v1` → `/v1` everywhere (controllers, OpenAPI
    spec, frontend calls, docs, skills, tests, fixtures). External and
    internal paths are now identical, so the `MUNIN_API_URL` rewriter
    branch is gone.
  - Rename env var `MUNIN_MCP_URL` → `NEXT_PUBLIC_MCP_URL`. Node still
    reads it on the backend; the `NEXT_PUBLIC_` prefix lets the dashboard
    inline the canonical MCP URL into the bundle at build time.
  - New env var `NEXT_PUBLIC_AUTH_URL` carries the OAuth issuer / auth
    callback host. Backend uses it as BetterAuth `baseURL` (falling back
    to `NEXT_PUBLIC_MCP_URL` origin when unset). Cloud points this at
    `api.getmunin.com` so Google sign-in callbacks live on the
    user-facing host instead of `mcp.*`.
  - Drop `MUNIN_API_URL`, `MUNIN_AUTH_URL`, `MUNIN_BASE_URL` — all
    collapsed into the three `NEXT_PUBLIC_*` vars above.
  - `oauth.constants.ts`: `authorizationServerUrl()` now reads
    `NEXT_PUBLIC_AUTH_URL` (with the same fallback). Drop the unused
    `apiExternalUrl()` helper. Drop ornamental doc comments.
  - `bootstrap-app.ts` `publicUrlRewriteMiddleware` simplified to MCP-only.
  - `docs-pages`: new guides `connect-claude`, `connect-chatgpt`,
    `connect-gemini` under a new `clients` category. MCP overview links
    to them. Docs cURL examples derive `/v1` from `NEXT_PUBLIC_API_URL`.
    REST sidebar/section headings prettified via the new `prettifyTag()`
    helper. The hamburger menu and stale `MCP_SETUPS` cloud-host
    fallbacks are gone.
  - `dashboard-pages`: dashboard MCP-setup card uses runtime fetch +
    env-derived defaults so OSS dev sees localhost URLs (no cloud-host
    flash), and cloud sees the real subdomain.
  - Dark mode follows the OS via Tailwind `darkMode: 'media'` and
    `@media (prefers-color-scheme: dark)` blocks — no flip-the-class
    script, no FOUC.
  - Sticky docs header + sidebar use a `--docs-stuck-h` CSS var measured
    by a `ResizeObserver`, so the header height matches the sidebar's
    `top` offset regardless of viewport. Sidebar background extended to
    full body height via a `:has()` pseudo-element.

  No production users yet, so no migration shim — set the new env vars
  on first deploy.

### Patch Changes

- @getmunin/core@4.18.0
- @getmunin/db@4.18.0
- @getmunin/types@4.18.0
- @getmunin/mcp-toolkit@4.18.0
- @getmunin/agent-runtime@4.18.0

## 4.17.0

### Patch Changes

- @getmunin/core@4.17.0
- @getmunin/db@4.17.0
- @getmunin/types@4.17.0
- @getmunin/mcp-toolkit@4.17.0
- @getmunin/agent-runtime@4.17.0

## 4.16.0

### Minor Changes

- 7e16468: Drop the runner's loopback HTTP path and remove the auto-minted admin API
  key.

  The agent-host runner used to call its own backend over HTTP for a handful
  of `/api/v1/conversations/*` and `/api/v1/curator-jobs/*` endpoints. Those
  calls required a bearer token, so an `AutoMintAdminKeyProvider` created an
  `mn_admin_*` API key named `agent-host-runner` per org/config and stored the
  ciphertext on `agent_config.admin_api_key_ct`. The key showed up in the
  dashboard's API-keys settings; a user revoking it silently broke the runner.

  This release replaces the loopback HTTP path with an in-process implementation
  of `MuninRestClient` (`InProcessMuninRestClientFactoryService` in
  `@getmunin/backend-core`). The runner now calls Nest services directly,
  wrapped in `runWithServiceContext` and an `AuditLogger` that records
  `runner:*` audit rows. No bearer token is needed.

  **Breaking** (internal: only affects code embedding `AgentHostModule` directly):
  - `AgentHostModule.forRoot({ adminKeyProvider })` option is removed. Drop it
    from your module config.
  - `AgentHostRunnerOptions.baseUrl` and `.fallbackAdminApiKey` are removed.
  - `AutoMintAdminKeyProvider`, `AdminKeyProvider`, and `NoopAdminKeyProvider`
    exports are removed.
  - `AgentConfigRepository.readDecryptedAdminKey` and `AgentConfigRow.adminApiKeyId`
    are removed from the interface.
  - The `AGENT_HOST_SINGLETON_DDL` / `AGENT_HOST_MULTI_TENANT_DDL` migrations
    now drop `agent_config.admin_api_key_ct` and `admin_api_key_id`, and
    revoke any existing `api_keys` rows with `name = 'agent-host-runner'`.

  The HTTP `createMuninRestClient` factory remains exported from
  `@getmunin/agent-runtime` — embedders running the runtime outside Nest can
  still use it.

### Patch Changes

- @getmunin/core@4.16.0
- @getmunin/db@4.16.0
- @getmunin/types@4.16.0
- @getmunin/mcp-toolkit@4.16.0
- @getmunin/agent-runtime@4.16.0

## 4.15.0

### Minor Changes

- d8ed4f6: Two changes that together unblock running the backend with multiple replicas safely.

  ### `withSchedulerLock(db, name, fn)` (new helper in backend-core)

  Wraps an in-process scheduler tick in a Postgres `pg_try_advisory_xact_lock` so only one replica's tick runs per interval. The lock is transaction-scoped — auto-released on commit/rollback, no connection-pool reuse traps.

  Applied to every cron-driven or `setInterval`-driven tick in the codebase:
  - `curator-scheduler.service.ts` (4 sweep cron jobs)
  - `webhook.worker.ts`
  - `cms.schedule.worker.ts`
  - `conv/widget/widget-email-fallback.worker.ts`
  - `conv/channels/outbound-delivery.worker.ts`
  - `conv/channels/inbound-poll.worker.ts`

  Each replica still ticks on its own clock; only the replica that wins the per-name lock runs the work. No new infrastructure (Redis, separate worker container) needed — Postgres advisory locks are free and idiomatic.

  Public export: `import { withSchedulerLock } from '@getmunin/backend-core'`.

  ### Postgres-backed rate-limit storage for better-auth

  New `auth_rate_limit` table (`@getmunin/db`) backs better-auth's per-endpoint throttling. The auth factory wires it through the drizzle adapter as the `rateLimit` model. Callers opt in by passing `rateLimit: { storage: 'database' }` to `createMuninAuthCore`.

  Previously the rate limit lived in an in-memory `Map()` per process — fine for a single replica, but every replica had its own counters at scale > 1, effectively multiplying the configured limit by N.

  Migration: `0030_auth_rate_limit` adds the table + key index. No RLS (global, service-role).

  ### Together

  Cloud can now safely set `backend_max_scale > 1` (and OSS multi-process deployments behave correctly behind a load balancer). No behaviour change for existing single-replica deployments.

### Patch Changes

- Updated dependencies [d8ed4f6]
  - @getmunin/db@4.15.0
  - @getmunin/core@4.15.0
  - @getmunin/mcp-toolkit@4.15.0
  - @getmunin/types@4.15.0

## 4.14.0

### Minor Changes

- 1fe1031: Make public-facing URLs configurable instead of hardcoding `api.munin.eu` / `docs.getmunin.com`.
  - `packages/docs-pages/src/page.tsx` and `_components/rest-endpoint.tsx`: the example `curl` URL is built from `process.env.NEXT_PUBLIC_API_URL` (defaulting to `http://localhost:3001`), matching the existing pattern in `guides/chat-widget/page.tsx`.
  - `packages/backend-core/scripts/generate-openapi.ts`: the OpenAPI spec's `servers[0]` is built from `MUNIN_OPENAPI_SERVER_URL` / `MUNIN_OPENAPI_SERVER_DESCRIPTION` (defaulting to `http://localhost:3001` / `local dev`). Cloud deploys set these at build time to render docs against the right host.
  - `packages/dashboard-pages/src/data/mcp-setups.ts`: `buildMcpSetups` takes an optional second `docsHost` argument; `MCP_SETUPS` keeps using the cloud-prod default. `get-started.tsx` reads `process.env.NEXT_PUBLIC_DOCS_URL` so dev points at `docs.dev.getmunin.com` and prod at `docs.getmunin.com`.

  Brand-attribution links (`getmunin.com` in the chat-widget "Powered by" footer, the web-crawler User-Agent) stay hardcoded — they identify Munin itself, not the deployment.

### Patch Changes

- Updated dependencies [1fe1031]
  - @getmunin/core@4.14.0
  - @getmunin/mcp-toolkit@4.14.0
  - @getmunin/db@4.14.0
  - @getmunin/types@4.14.0

## 4.13.0

### Minor Changes

- 7977f92: Rename the env var `MUNIN_PUBLIC_URL` → `MUNIN_MCP_URL`.

  The old name didn't say what surface it pointed at; the new name is symmetric with `MUNIN_API_URL` and `MUNIN_WEB_URL` and reflects that the value is the canonical MCP resource URL (used by the JWT issuer, OAuth audience, bootstrap rewriter `→ /mcp`, RFC 9728 metadata, and the SMS/outreach webhook bases that piggyback on the backend's external host).

  **Breaking** — `process.env.MUNIN_PUBLIC_URL` is no longer read. Set `MUNIN_MCP_URL` instead. No backwards-compat alias (no production users yet). Internal constants `PUBLIC_URL_FALLBACK` and `DEFAULT_PUBLIC_URL` renamed to `MCP_URL_FALLBACK` / `DEFAULT_MCP_URL` for consistency.

  Cloud consumers should bump `@getmunin/*` and rename the env in their deployment config.

### Patch Changes

- Updated dependencies [7977f92]
  - @getmunin/core@4.13.0
  - @getmunin/mcp-toolkit@4.13.0
  - @getmunin/db@4.13.0
  - @getmunin/types@4.13.0

## 4.12.0

### Minor Changes

- 458b548: Explicit voice channel routing for orgs with multiple active Vapi voice channels.
  - `conv_voice_call_contact` MCP tool accepts an optional `channelId` to pick a specific voice channel; with a single channel the call falls back to it.
  - Widget channel config gains `voiceChannelId` so the chat widget's "call now" button routes deterministically when multiple voice channels exist.
  - When >1 voice channels are configured and no routing hint is provided, callers get `multiple_active_voice_channels` (tool) / `multiple_voice_channels_without_widget_routing` (widget) instead of an arbitrary pick.

### Patch Changes

- @getmunin/core@4.12.0
- @getmunin/db@4.12.0
- @getmunin/types@4.12.0
- @getmunin/mcp-toolkit@4.12.0

## 4.11.0

### Minor Changes

- 2f2eff8: Handle Vapi `assistant-request` webhook: dynamically inject system prompt + tools + caller context for inbound PSTN calls.

  Before this change, inbound calls fell into the webhook's `default` branch and were ignored — Vapi used whatever assistant prompt was pre-configured in its dashboard, with no Munin context. The first Munin learned about the call was when the first transcript turn arrived (which triggers `findOrCreateConversation` lazily).

  Now, when Vapi fires `assistant-request` (it's the first event for any call, fired before the assistant speaks), the adapter:
  1. **Pre-creates the conversation** by reusing `findOrCreateConversation`, so subsequent transcript / tool-calls events have a known conversationId in `assistantOverrides.metadata`.
  2. **Auto-creates the conv contact + end_user** from the caller's phone (same `findOrCreateContactByPhone` path used elsewhere).
  3. **Looks up the CRM contact** by phone (best-effort).
  4. **Fetches the channel's Vapi assistant config** via `VapiClientService.fetchAssistantConfig` to inherit voice / transcriber / voicemail / recording settings.
  5. **Builds an inline assistant** with:
     - System prompt = KB `voice-system-prompt` + company profile + caller context (CRM name/email if found, otherwise "first-time caller" note).
     - The voice opener prompt as a second system message.
     - The MCP self-service tool surface (`VapiToolBridge.buildToolList()`).
  6. **Returns `{ assistant, assistantOverrides: { metadata: { conversationId, endUserId } } }`** so Vapi uses our inline config for this call and stamps our metadata onto subsequent webhook events.

  **Fail-soft:** if any step fails (Vapi API unreachable, KB read error, etc.), the handler returns `{}` and Vapi uses its default assistant. The conversation pre-create runs _before_ the Vapi fetch so even on Vapi-fetch failure the conversation row still exists and subsequent transcripts resolve correctly.

  **Refactor:** moved `composeVoiceSystemPrompt`, `buildInlineAssistantConfig`, `OrgScopedKbDocReader`, `INHERITED_ASSISTANT_FIELDS` from `widget-voice.service.ts` to a new `vapi-assistant.ts` so both the widget path and the inbound PSTN path share one source. `composeVoiceSystemPrompt` gains an optional `extraContext` parameter for the caller context block.

  `runAsSystem` became generic `<T>` so the assistant-request handler can read DB state out of the transaction.

  Tests: extended `vapi.integration.test.ts` with two cases — assistant-request creates the conversation + contact + end_user even when the Vapi fetch fails; assistant-request with no `callId` is a no-op.

### Patch Changes

- @getmunin/core@4.11.0
- @getmunin/db@4.11.0
- @getmunin/types@4.11.0
- @getmunin/mcp-toolkit@4.11.0

## 4.10.0

### Minor Changes

- 024a314: Extract `createMuninAuthCore` factory in `@getmunin/backend-core/auth` so OSS and cloud share one Better Auth setup.

  Cloud has its own `cloud-auth.ts` because its multi-tenancy model is different (personal-org-per-signup vs OSS's single-shared-org-with-invite-gate) and it wires social providers + user-deletion flows OSS doesn't. But ~70% of the file was a literal copy of the OSS auth config: `drizzleAdapter` schema mapping, `jwt({ issuer })` plugin, `oauthProvider({...})` block, `emailAndPassword`, `emailVerification`, `SUPPORTED_SCOPES` composition, and the `computeValidAudiences` + `uniqueOrigins` helpers. That copy drifted twice — first when the original audience mismatch landed (fixed in OSS #208 then again in cloud #111), and again when the variant-tolerance fix landed (OSS #213, never propagated to cloud, which is why claude.ai's OAuth flow broke on cloud-dev after the 4.9.0 cloud bump).

  New shared factory accepts the caller-specific bits as options:
  - `signupBefore(user)` / `signupAfter(user)` — OSS passes invite-gate + singleton-org membership; cloud passes personal-org provisioning.
  - `sendResetPassword`, `sendVerificationEmail` — callers supply mailer-bound callbacks (OSS and cloud have different template copy).
  - `deleteUser?: { beforeDelete, sendDeleteAccountVerification }` — cloud-only.
  - `socialProviders?: { google, github }` — cloud-only.
  - `crossSubDomainCookies?: { domain }` — cloud-only (`*.getmunin.com`).
  - `rateLimit?` — cloud uses an env toggle for tests.

  Everything OAuth-protocol-related (oauthProvider config, validAudiences derivation, jwt issuer, supported scopes, JWKS schema mapping) lives in one place. `computeValidAudiences` is now exported from `@getmunin/backend-core` directly — its variant set (`{canonical, +slash, origin, origin+/}`) is the canonical source of truth for both OSS and cloud.

  OSS `apps/backend/src/auth/auth.config.ts` slimmed from ~250 to ~135 lines (now only the OSS-specific signup gate + singleton membership logic). The `computeValidAudiences` unit test moved to `packages/backend-core/src/auth/auth-factory.test.ts`.

  Cloud-side adoption ships in a separate cloud-repo PR alongside the @getmunin/\* bump to the resulting release.

### Patch Changes

- @getmunin/core@4.10.0
- @getmunin/db@4.10.0
- @getmunin/types@4.10.0
- @getmunin/mcp-toolkit@4.10.0

## 4.9.0

### Patch Changes

- Updated dependencies [8c1c3c9]
- Updated dependencies [2ca3b4a]
- Updated dependencies [f9a8e0f]
  - @getmunin/core@4.9.0
  - @getmunin/mcp-toolkit@4.9.0
  - @getmunin/db@4.9.0
  - @getmunin/types@4.9.0

## 4.8.0

### Minor Changes

- 0a0e2a1: In-process MCP for the bundled `AgentHostRunner`.

  The runner previously POSTed every admin-side MCP call back into its own backend over loopback HTTP, authenticating with a long-lived per-org admin API key. Every layer added for the public edge (host-allowlist, CORS, audience checks, audit) had to grow a loopback escape hatch, and a single stale `MUNIN_KEY_PEPPER` rotation would dead-letter every agent spawn.

  This drops the loopback hop. The runner now dispatches admin MCP calls directly into the same handlers the HTTP transport runs.

  **`@getmunin/mcp-toolkit`** — factor `createMcpServer`'s per-request handlers into pure `listTools` / `callTool` / `listResources` / `readResource` helpers (new `dispatch.ts`). Both transports now share the exact same scope-check + input-validation + audit logic. Adds `openInProcessMcpClient({ registry, actor, audience, audit, skills? })`.

  **`@getmunin/core`** — exports `buildAdminAgentActor(orgId)` for synthesising the agent's `ActorIdentity` (admin audience, `['*']` scopes).

  **`@getmunin/backend-core`** — exports `openAgentMcpClient({ db, orgId, registry, skills? })`. Every call self-wraps in a tenancy transaction (same GUCs as `TenancyInterceptor` would set on an HTTP request). Also exports `McpRegistryService` + `McpSkillRegistryService` so external modules (agent-host) can inject the registries.

  **`@getmunin/agent-host`** — `AgentHostRunner` uses `openAgentMcpClient` for the admin MCP handle. `AgentHostModule.forRoot(...)` now imports `McpModule` so the registry services resolve. The per-conversation `openMcp({ delegatedToken })` callback inside the chat handler stays on HTTP — that's a real cross-trust boundary (end-user agent calling the backend).

  The REST + realtime paths still use the admin API key (deferred to a follow-up). The admin-key encryption columns and `AdminKeyProvider` interface stay.

### Patch Changes

- 7c9a3d3: Forward the raw request body to Better Auth instead of re-serializing it as JSON. The OAuth token endpoint requires `application/x-www-form-urlencoded` per RFC 6749 §3.2; the previous handler converted every body to JSON and set `Content-Type: application/json`, so Better Auth rejected token exchanges with `UNSUPPORTED_MEDIA_TYPE`. Externally-RFC-compliant clients like claude.ai web therefore never received an access token. Other Better Auth endpoints (sign-in, register, consent) happen to accept JSON, which is why the bug stayed latent until claude.ai connected.

  The handler now passes `req.rawBody` through verbatim (Nest's `rawBody: true` already captures it), preserving the original content-type. JSON fallback is kept for safety when no raw body was captured.

- Updated dependencies [0a0e2a1]
  - @getmunin/mcp-toolkit@4.8.0
  - @getmunin/core@4.8.0
  - @getmunin/db@4.8.0
  - @getmunin/types@4.8.0

## 4.7.1

### Patch Changes

- 8c79922: Two follow-up fixes to the 4.7.0 canonical-URL roll-out:

  **`@getmunin/backend-core`** — `hostAllowlistMiddleware` always permits loopback (`127.0.0.1`, `localhost`, `::1`). Without this, the bundled `AgentHostRunner` (and any in-process MCP client) hit a 421 `misdirected_request` because their `Host` header is the loopback address — not a public hostname. Cloud has been emitting an `AgentHostRunner failed to start runner` error every 30s since `MUNIN_ALLOWED_HOSTS` shipped in 4.5.1.

  The middleware now also parses bracketed IPv6 host headers (`[::1]:3101` → `::1`) correctly.

  **`apps/backend`** — `validAudiences` in OSS `createMuninAuth` now equals `baseUrl` exactly instead of `baseUrl + '/mcp'`. After 4.7.0, the canonical resource URL is `MUNIN_PUBLIC_URL` verbatim, so the OAuth provider's audience whitelist needs to mirror that — otherwise external MCP clients (claude.ai web, etc.) can't complete the token exchange. Also drops the locally-shadowed `SUPPORTED_SCOPES` const in favor of `@getmunin/backend-core`'s canonical list (picks up `outreach:*`).
  - @getmunin/core@4.7.1
  - @getmunin/db@4.7.1
  - @getmunin/types@4.7.1
  - @getmunin/mcp-toolkit@4.7.1

## 4.7.0

### Minor Changes

- 5108510: `MUNIN_PUBLIC_URL` is now the **canonical MCP resource URL** verbatim — no implicit `/mcp` appending. Adds an optional `MUNIN_API_URL` for a canonical REST URL.

  **Backend (`@getmunin/backend-core`)**
  - `mcpResourceUrl()` returns `MUNIN_PUBLIC_URL` exactly. `authorizationServerUrl()` (and `readPublicBaseUrl()`) return its origin.
  - New `publicUrlRewriteMiddleware` maps the canonical external URLs onto the internal Nest mount points — `/mcp` for MCP, `/api/v1` for REST. So a deploy can advertise `https://mcp.example.com` (no path) and `https://api.example.com/v1` while every controller stays mounted at its original internal path. Pass-through when the env vars name the same internal path (OSS default).
  - Adds `MCP_INTERNAL_PATH` (`'/mcp'`) and re-exports the old `MCP_RESOURCE_PATH` for back-compat.

  **Default change** — OSS default `MUNIN_PUBLIC_URL` is now `http://localhost:3001/mcp` (path included). Existing self-hosters who set `MUNIN_PUBLIC_URL=http://localhost:3001` (no path) will see their OAuth resource URL change from `…/mcp` to bare host — every active token will need refreshing. To keep the old behavior verbatim, set `MUNIN_PUBLIC_URL=http://localhost:3001/mcp`.

  **Dashboard (`@getmunin/dashboard-pages`)**
  - `GetStarted` fetches the canonical MCP URL from `/.well-known/oauth-protected-resource` and renders it in the Claude / ChatGPT / Gemini config snippets. OSS self-host now shows `http://localhost:3001/mcp` (or whatever the local backend advertises); cloud shows `mcp.getmunin.com`.
  - `mcp-setups.ts` ships a `buildMcpSetups(host)` helper alongside the static fallback.

### Patch Changes

- Updated dependencies [5108510]
  - @getmunin/core@4.7.0
  - @getmunin/mcp-toolkit@4.7.0
  - @getmunin/db@4.7.0
  - @getmunin/types@4.7.0

## 4.6.1

### Patch Changes

- 04edb03: Send permissive CORS headers from `/mcp`, the OAuth/OIDC discovery endpoints, and the public client-info endpoint (`/api/v1/oauth/clients/:id`).

  Browser-based MCP clients like claude.ai web are served from `https://claude.ai`, which isn't in any deployment's `MUNIN_CORS_ORIGINS` (and shouldn't have to be). Previously the preflight to `/mcp` returned 204 with no `Access-Control-Allow-Origin`, so the browser blocked the POST and showed "Couldn't reach the MCP server". Same gap on the well-known discovery endpoints any OAuth client needs to read cross-origin during dynamic client registration.

  Renames the internal predicate `isPublicWidgetPath` → `isPublicCorsPath` and exports it for tests.

- afcf3a1: Serve `/favicon.ico`, `/icon.png`, `/apple-icon.png` from a configurable `iconAssetDir` (default `<cwd>/public/icons`). Browser-based MCP UIs like claude.ai web use the MCP host's favicon to render the custom-integration tile; previously the host returned 404 and claude.ai fell back to a generic globe placeholder.

  Missing files silently 404 — backwards-compatible for deployments that don't ship icons.
  - @getmunin/core@4.6.1
  - @getmunin/db@4.6.1
  - @getmunin/types@4.6.1
  - @getmunin/mcp-toolkit@4.6.1

## 4.6.0

### Minor Changes

- b770bce: OAuth consent UX rework and bootstrap MCP removal.

  **Backend**
  - New `GET /api/v1/oauth/clients/:clientId` endpoint (anonymous, on `OAuthModule`) returns the disclosure-safe fields `{ client_id, name, uri, icon }` from the `oauth_client` table. Lets the consent page render the registered client name + URL + logo instead of the random RFC 7591 `client_id`.
  - `SUPPORTED_SCOPES` gains `outreach:read` / `outreach:write`. Outreach MCP tools are retagged from `crm:*` to `outreach:*` so an external connector can be granted outreach access without inheriting CRM access.

  **Dashboard pages**
  - `OAuthConsentPage` rewritten:
    - Fetches the new client-info endpoint on mount, falls back to `client_id` if missing.
    - Hides scopes that aren't user-tunable on the consent screen — `openid`, `profile`, `email`, `offline_access` (OIDC/OAuth standards required by any connector), and `mcp:tools` / `mcp:admin` / `mcp:self_service` (the MCP umbrella + audience-decided-by-user, not by-scope).
    - Groups remaining scopes by user-facing app: Knowledge Base, Conversations, Contacts, Content, Outreach. Internal modules (`curator`, `playbooks`, `web`) are not surfaced — they remain reachable via the `mcp:tools` umbrella.
    - Disclosure footer: "Sign-in identity and session refresh are also granted."

  Scope-narrowing checkboxes at consent time are still deferred — needs upstream `@better-auth/oauth-provider` support or a wrap-and-mutate layer in the consumer.

  **Bootstrap MCP removal**
  - Removes the `bootstrap_status` / `bootstrap_answer` MCP tools, the `@getmunin/bootstrap` package, the per-app `*.bootstrap.ts` runners (kb / conv / crm / cms), and the `bootstrap_state` table (migration 0028). The conversational first-run wizard was redundant with the dashboard's UI onboarding and never picked up real callers. Direct admin tools (`kb_create_space`, `crm_create_pipeline`, `cms_create_locale`, `cms_create_collection`, `conv_*_setup_channel`) now cover everything bootstrap did.
  - Skill markdown for `kb-onboarding` and `conv/bulk-channel-setup` rewritten to call the direct tools.

### Patch Changes

- Updated dependencies [b770bce]
  - @getmunin/db@4.6.0
  - @getmunin/core@4.6.0
  - @getmunin/mcp-toolkit@4.6.0
  - @getmunin/types@4.6.0

## 4.5.1

### Patch Changes

- 8d6b8b9: `@AllowAnonymous()` now uses Nest's `SetMetadata(...)` keyed by a stable string (`'munin:allow-anonymous'`) instead of `Reflect.metadata(...)` keyed by a JavaScript `Symbol()`. Symbol identity across compiled module boundaries proved unreliable in production: OAuth discovery endpoints (`/.well-known/oauth-protected-resource`, `/.well-known/oauth-authorization-server`) were 401'ing in the cloud deployment even though the controllers had `@AllowAnonymous()` decorators. That's the same metadata the `AuthGuard` reads, so the bypass never triggered.

  No call-site changes — `AllowAnonymous` is still imported the same way. Existing consumers (CloudAuthController + every controller with anonymous routes) keep working.
  - @getmunin/core@4.5.1
  - @getmunin/db@4.5.1
  - @getmunin/types@4.5.1
  - @getmunin/mcp-toolkit@4.5.1
  - @getmunin/bootstrap@4.5.1

## 4.5.0

### Minor Changes

- 9367ac8: Add an optional `MUNIN_ALLOWED_HOSTS` env var that activates a Host-header allow-list middleware. When set, requests whose `Host` header (port stripped, case-insensitive) isn't in the comma-separated list get a 421 `misdirected_request` response before any controller runs.

  Defense-in-depth: cloud deployments are reachable both by the custom domain (`api.dev.getmunin.com`) and by the raw Scaleway container hostname. A future CORS or cookie-domain misconfig could leak via the raw hostname; this middleware rejects it at the edge. Pass-through (no enforcement) when the env var is unset — OSS dev and tests are unaffected.

### Patch Changes

- @getmunin/core@4.5.0
- @getmunin/db@4.5.0
- @getmunin/types@4.5.0
- @getmunin/mcp-toolkit@4.5.0
- @getmunin/bootstrap@4.5.0

## 4.4.1

### Patch Changes

- @getmunin/core@4.4.1
- @getmunin/db@4.4.1
- @getmunin/types@4.4.1
- @getmunin/mcp-toolkit@4.4.1
- @getmunin/bootstrap@4.4.1

## 4.4.0

### Patch Changes

- @getmunin/core@4.4.0
- @getmunin/db@4.4.0
- @getmunin/types@4.4.0
- @getmunin/mcp-toolkit@4.4.0
- @getmunin/bootstrap@4.4.0

## 4.3.0

### Minor Changes

- 21a8189: Introduce `@getmunin/docs-pages`: lifts the developer-portal routes (`/docs`, `/docs/rest`, `/docs/mcp`, `/docs/skills`, `/docs/guides`) out of `apps/web` into a shared package so munin-cloud can mount the same docs under its own auth/header chrome. The OSS `apps/web/app/[locale]/docs/*` routes are now thin one-liner shells that re-export from the package.

  `@getmunin/backend-core` now publishes the OpenAPI spec and docs fixtures (mcp-tools.json, skills.json) via package subpath exports (`@getmunin/backend-core/openapi.json`, `@getmunin/backend-core/docs-fixtures/*`) so downstream consumers can read them at build time.

  Dashboard: removes the CONV pill from the Last conversations rows — the conversation rows in that section are conversations by definition; the pill was redundant.

- 21a8189: Add a "Last conversations" section to the dashboard home, below the Usage KPIs. Lists up to 10 conversations from the past 7 days, sorted by most recent message. Each row shows the subject (or `Conversation #displayId` fallback), the last inbound (end-user) message as a muted preview, status badge for non-open states, and a relative timestamp. Click opens the conversation drawer. Hidden when there's nothing in the 7-day window.

  Backend: `ConversationSummary` gains an optional `lastInboundPreview` field. `GET /api/v1/conversations` populates it via a correlated subquery over `conv_messages` (latest non-internal `author_type='end_user'` body, collapsed and truncated to 200 chars). Other code paths that build a summary leave the field undefined.

  Dashboard: matching styling pass — Queue and Last-conversations headers now use the same ink-black eyebrow + ink underline pattern as Usage; the trailing row border is dropped via `last:border-b-0`. Extracts `useRelative` to `lib/use-relative.ts` so the new section and the existing inbox rows share one source of truth.

### Patch Changes

- @getmunin/core@4.3.0
- @getmunin/db@4.3.0
- @getmunin/types@4.3.0
- @getmunin/mcp-toolkit@4.3.0
- @getmunin/bootstrap@4.3.0

## 4.2.0

### Minor Changes

- 0040252: Add a "Last conversations" section to the dashboard home, below the Usage KPIs. Lists up to 10 conversations from the past 7 days, sorted by most recent message. Each row shows the subject (or `Conversation #displayId` fallback), the last inbound (end-user) message as a muted preview, status badge for non-open states, and a relative timestamp. Click opens the conversation drawer. Hidden when there's nothing in the 7-day window.

  Backend: `ConversationSummary` gains an optional `lastInboundPreview` field. `GET /api/v1/conversations` populates it via a correlated subquery over `conv_messages` (latest non-internal `author_type='end_user'` body, collapsed and truncated to 200 chars). Other code paths that build a summary leave the field undefined.

  Dashboard: matching styling pass — Queue and Last-conversations headers now use the same ink-black eyebrow + ink underline pattern as Usage; the trailing row border is dropped via `last:border-b-0`. Extracts `useRelative` to `lib/use-relative.ts` so the new section and the existing inbox rows share one source of truth.

### Patch Changes

- @getmunin/core@4.2.0
- @getmunin/db@4.2.0
- @getmunin/types@4.2.0
- @getmunin/mcp-toolkit@4.2.0
- @getmunin/bootstrap@4.2.0

## 4.1.1

### Patch Changes

- @getmunin/core@4.1.1
- @getmunin/db@4.1.1
- @getmunin/types@4.1.1
- @getmunin/mcp-toolkit@4.1.1
- @getmunin/bootstrap@4.1.1

## 4.1.0

### Patch Changes

- Updated dependencies [de1a7a6]
  - @getmunin/core@4.1.0
  - @getmunin/bootstrap@4.1.0
  - @getmunin/mcp-toolkit@4.1.0
  - @getmunin/db@4.1.0
  - @getmunin/types@4.1.0

## 4.0.0

### Patch Changes

- @getmunin/core@4.0.0
- @getmunin/db@4.0.0
- @getmunin/types@4.0.0
- @getmunin/mcp-toolkit@4.0.0
- @getmunin/bootstrap@4.0.0

## 3.9.1

### Patch Changes

- @getmunin/core@3.9.1
- @getmunin/db@3.9.1
- @getmunin/types@3.9.1
- @getmunin/mcp-toolkit@3.9.1
- @getmunin/bootstrap@3.9.1

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
  - @getmunin/mcp-toolkit@3.9.0
  - @getmunin/bootstrap@3.9.0

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
  - @getmunin/db@3.8.0
  - @getmunin/core@3.8.0
  - @getmunin/types@3.8.0
  - @getmunin/mcp-toolkit@3.8.0
  - @getmunin/bootstrap@3.8.0

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
  - @getmunin/mcp-toolkit@3.7.0
  - @getmunin/bootstrap@3.7.0

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
  - @getmunin/mcp-toolkit@3.6.0
  - @getmunin/bootstrap@3.6.0

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
  - @getmunin/types@3.5.0
  - @getmunin/mcp-toolkit@3.5.0
  - @getmunin/bootstrap@3.5.0

## 3.4.1

### Patch Changes

- @getmunin/core@3.4.1
- @getmunin/db@3.4.1
- @getmunin/types@3.4.1
- @getmunin/mcp-toolkit@3.4.1
- @getmunin/bootstrap@3.4.1

## 3.4.0

### Patch Changes

- @getmunin/core@3.4.0
- @getmunin/db@3.4.0
- @getmunin/types@3.4.0
- @getmunin/mcp-toolkit@3.4.0
- @getmunin/bootstrap@3.4.0

## 3.2.1

### Patch Changes

- c5e93e1: Add a `development` package-export condition pointing at `./src/index.ts` (and `./src/schema.ts` for `@getmunin/db`). Loaders that resolve with `--conditions=development` (e.g. the OSS backend's new `node --import @swc-node/register/esm-register --watch --conditions=development src/main.ts` dev script) see the TypeScript source directly; the existing `types` → `dist/*.d.ts` and `default` → `dist/*.js` resolution paths are unchanged, so production runtime, typecheck, and downstream consumers that don't opt into the condition keep their current behavior.
- Updated dependencies [c5e93e1]
  - @getmunin/core@3.2.1
  - @getmunin/db@3.2.1
  - @getmunin/types@3.2.1
  - @getmunin/mcp-toolkit@3.2.1
  - @getmunin/bootstrap@3.2.1

## 3.2.0

### Minor Changes

- 9d84e3c: Drop the unused `displayName` field from chat-widget channels. The field was required at create time but was never read by the chat-widget itself — only echoed in the dashboard's channel list. Removed from the MCP tool inputs (`conv_widget_create_channel`, `conv_widget_update_channel`), the `WidgetChannelConfig` zod schema, the REST body schemas in `ConvChannelsController`, the dashboard's "Add chat widget" form and channel-row display, and the widget-onboarding / bulk-channel-setup skill docs. Existing rows keep `displayName` in their `conv_channels.config` jsonb but it gets silently stripped on next parse — no migration required.

  Also fixes a NestJS route-ordering bug where `ConversationsController @Get(':id')` shadowed `ConvChannelsController @Get()`, causing `/api/v1/conversations/channels` to return `conv_not_found: conversation channels` instead of the channel list. `ConvChannelsController` is now registered before `ConversationsController` in `ControlModule`.

### Patch Changes

- @getmunin/core@3.2.0
- @getmunin/db@3.2.0
- @getmunin/types@3.2.0
- @getmunin/mcp-toolkit@3.2.0
- @getmunin/bootstrap@3.2.0

## 3.1.0

### Patch Changes

- @getmunin/core@3.1.0
- @getmunin/db@3.1.0
- @getmunin/types@3.1.0
- @getmunin/mcp-toolkit@3.1.0
- @getmunin/bootstrap@3.1.0

## 3.0.0

### Major Changes

- e5a5450: Migrate from the deprecated `oidcProvider` (in-tree better-auth plugin) to the published `@better-auth/oauth-provider`. The OAuth schema changes from 3 tables to 4 (`oauth_client`, `oauth_access_token`, `oauth_refresh_token`, `oauth_consent`) plus a `jwks` table for the JWT plugin. RFC 8707 resource indicators are now native via `validAudiences`, JWT access tokens replace opaque tokens for resource-bound flows, and the consent page contract switches from `consent_code` to a signed `oauth_query`. The dashboard consent page is fully localized (en + nb).

  Breaking: any deployment with rows in the old `oauth_applications` / `oauth_access_tokens` / `oauth_consents` tables will lose them — Munin OAuth has not been deployed anywhere yet, so this is a no-op in practice.

### Patch Changes

- Updated dependencies [e5a5450]
  - @getmunin/db@3.0.0
  - @getmunin/core@3.0.0
  - @getmunin/bootstrap@3.0.0
  - @getmunin/mcp-toolkit@3.0.0
  - @getmunin/types@3.0.0

## 2.5.1

### Patch Changes

- @getmunin/core@2.5.1
- @getmunin/db@2.5.1
- @getmunin/types@2.5.1
- @getmunin/mcp-toolkit@2.5.1
- @getmunin/bootstrap@2.5.1

## 2.5.0

### Patch Changes

- @getmunin/core@2.5.0
- @getmunin/db@2.5.0
- @getmunin/types@2.5.0
- @getmunin/mcp-toolkit@2.5.0
- @getmunin/bootstrap@2.5.0

## 2.4.0

### Minor Changes

- 009846d: feat(oauth): RFC 8707 resource indicators (Phase 3)

  OAuth-issued access tokens are now bound to a resource URL (`<MUNIN_PUBLIC_URL>/mcp`). The `AuthGuard` enforces audience match: a token whose `audience` doesn't equal the request's resource is rejected with 401.

  `@getmunin/core`: `ResolvedCredential` gains an `audience` field. `CredentialResolver.resolveBearerToken()` populates it for OAuth-issued tokens (`oauth_access_tokens` lookups) and leaves it undefined for API keys + delegated tokens (which bypass audience binding because the issuer is the resource server).

  `@getmunin/backend-core`: `OAuthResourceController` advertises `resource_indicators_supported: true` in the protected-resource metadata. `AuthGuard.canActivate()` rejects credentials whose `audience` doesn't match `mcpResourceUrl()` for `/mcp/*` requests, with the same `WWW-Authenticate` header semantics from Phase 1.

  Single-resource simplification for v1: every OAuth token is bound to the MCP resource URL, computed from `MUNIN_PUBLIC_URL`. When a second resource ships, the binding becomes per-token (set at issuance from the `resource` parameter in the authorize / token request).

### Patch Changes

- Updated dependencies [009846d]
  - @getmunin/core@2.4.0
  - @getmunin/bootstrap@2.4.0
  - @getmunin/mcp-toolkit@2.4.0
  - @getmunin/db@2.4.0
  - @getmunin/types@2.4.0

## 2.3.0

### Minor Changes

- d07dc99: feat(oauth): wire Better-Auth oidcProvider, add OIDC tables, alias `/.well-known/oauth-authorization-server`

  Phase 2 of MCP-spec OAuth 2.1 compliance. Builds on the Phase 1 resource-discovery scaffolding.

  **`@getmunin/db`**: three new tables for Better-Auth's OIDC provider plugin: `oauth_applications` (registered clients via DCR), `oauth_access_tokens` (issued tokens, separate from the legacy `tokens` table), `oauth_consents` (per-user consent records).

  **`@getmunin/core`**: `CredentialResolver.resolveBearerToken()` now also matches against `oauth_access_tokens`. OAuth-issued tokens resolve to a `user`-type actor with the user's default org membership and the requested scopes. Audiences are derived from `mcp:admin` / `mcp:self_service` scope presence.

  **`@getmunin/backend-core`**:
  - New `OAuthAsAliasController` exposing `/.well-known/oauth-authorization-server` (RFC 8414) by proxying Better-Auth's `/auth/.well-known/openid-configuration`. MCP clients hit a single discovery URL on the resource host.
  - Updated `OAuthModule` to include the alias.

  **`apps/backend`** (not in changeset): wires `oidcProvider` plugin in `auth.config.ts` with PKCE required, DCR enabled, the full Munin scope list (`openid`, `profile`, `email`, `offline_access`, `mcp:tools`, `mcp:admin`, `mcp:self_service`, `kb:*`, `conv:*`, `crm:*`, `cms:*`), and consent-page redirect to `/dashboard/oauth/consent`.

  End-to-end DCR flow tested: `POST /auth/oauth2/register` mints a client; `GET /.well-known/oauth-authorization-server` reports the right endpoints; the issued tokens, when sent as `Authorization: Bearer`, resolve correctly through `CredentialResolver`.

  Still missing for full MCP-spec compliance:
  - RFC 8707 resource indicators (Phase 3) — `aud` claim binding to a specific resource URL
  - Consent UI page (Phase 4) — currently uses Better-Auth's default
  - Conformance audit (Phase 5)

### Patch Changes

- Updated dependencies [d07dc99]
  - @getmunin/db@2.3.0
  - @getmunin/core@2.3.0
  - @getmunin/bootstrap@2.3.0
  - @getmunin/mcp-toolkit@2.3.0
  - @getmunin/types@2.3.0

## 2.2.0

### Minor Changes

- f4515d8: feat(oauth): MCP resource discovery + WWW-Authenticate (Phase 1)

  First step toward MCP-spec OAuth 2.1 compliance:
  - New `GET /.well-known/oauth-protected-resource` (RFC 9728) describing the `/mcp` resource: where it lives, which authorization servers can issue tokens for it, supported scopes (`mcp:tools`, `mcp:admin`, `mcp:self_service`, `kb:read`, `conv:write`, …), bearer transport.
  - `AuthGuard` emits `WWW-Authenticate: Bearer resource_metadata="…"` on 401 responses for `/mcp/*` requests, per the MCP authorization spec. Other authenticated routes are unchanged.
  - New `OAuthModule` exported from `@getmunin/backend-core` so cloud picks it up automatically.

  This phase publishes the resource-side metadata. The authorization server endpoints (Better-Auth `oidcProvider`, RFC 8707 resource indicators, consent UI) come in subsequent phases. Existing API key + delegated token flows are untouched.

### Patch Changes

- @getmunin/core@2.2.0
- @getmunin/db@2.2.0
- @getmunin/types@2.2.0
- @getmunin/mcp-toolkit@2.2.0
- @getmunin/bootstrap@2.2.0

## 2.1.0

### Minor Changes

- f9ecaa9: feat(widget): in-tree chat widget — drop-in `<script>` for self-hosted Munin

  Self-hosted Munin now serves a first-party browser chat widget directly
  at `https://<host>/widget.js`. Operators don't need a token-mint proxy,
  a separate hosting target, or the old `chat-widget-vanilla` example —
  they create a chat-widget channel in the dashboard, copy the embed
  snippet from **Settings → Channels → Embed snippet**, and paste it on
  their site.

  **`@getmunin/backend-core`**
  - Per-channel `identityVerificationSecret` + `requireVerifiedIdentity`
    flag on `WidgetChannelConfig`. The secret is generated at channel
    creation, surfaced once via `conv_widget_create_channel`, and rotatable
    via the new `conv_widget_rotate_identity_secret` MCP tool.
  - `verifyIdentity()` runs on every widget request: timing-safe HMAC check
    on the `(verifiedExternalId, userHash)` pair against the channel's
    secret. Failures collapse to a single `403 identity_verification_failed`
    so callers can't distinguish failure modes by status or timing.
  - `originAllowlist` is now enforced on `POST /api/v1/widget/messages` —
    browser callers must declare an `Origin` on the channel's allowlist;
    server-to-server callers (no `Origin`) pass through unchanged.
  - New `GET /api/v1/widget/messages?since=` endpoint for WS-reconnect
    backfill. Capped at 100, returns `hasMore`. Verified mode binds the
    result set to the requester's externalId (mismatch returns empty
    rather than 403 to avoid leaking session existence).
  - `RealtimeGateway` learns a `widget` subscription type. Widget keys
    authenticate at upgrade with origin-allowlist + HMAC identity gates;
    subscriptions are scoped to `widget:<channelId>:<sessionId>`.
    Operator-side replies fan out via a per-connection conversation-meta
    cache, no upstream emit-site changes needed.
  - Bidirectional `typing` events: visitor ↔ operator, server-side throttle
    of 1 broadcast per 1.5 s per (sender, conversation), 5 s auto-clear if
    the sender goes silent. `requireVerifiedIdentity` is honored for both
    sides.
  - Inbound WS frames capped at 64 KB.
  - Backend serves the bundle: `GET /widget/<sha>.js` is immutable
    (`max-age=31536000, immutable`); `GET /widget.js` is a 302 redirect to
    the current sha with `max-age=300, must-revalidate`. The redirect
    target is read from `manifest.json` and refreshed on file mtime change
    so deploy-time swaps propagate without restart. Path traversal is
    blocked; missing manifest yields 503 `no-store`.
  - Visitor-message body capped at 1000 chars (`role: end_user`); operator
    / agent / system messages keep the prior 50K cap.
  - New REST surface for the dashboard: `requireVerifiedIdentity` on the
    create/update bodies and `POST .../widget/:id/rotate-identity-secret`.

  **`@getmunin/dashboard-pages`**
  - The Channels page now surfaces the identity-verification secret on
    channel creation alongside the widget API key (one combined callout,
    shown once).
  - New per-chat-channel actions: **Embed snippet** (a dialog with a
    copyable `<script>` tag pre-filled with the dashboard origin and
    channel id, plus tabbed Node / Ruby / PHP / Python snippets for
    computing `data-user-hash` server-side) and **Rotate identity secret**.

  **Companion changes**
  - A new `@getmunin/chat-widget` workspace package (private, deployable
    artifact like `apps/backend` and `apps/web`; not published to npm)
    hosts the widget source. Built as a single content-hashed IIFE bundle
    via Vite, copied into `apps/backend/public/widget/` by a `prebuild`
    step.
  - The standalone `chat-widget-vanilla` example in the `munin-examples`
    repo is removed — the dashboard's embed snippet replaces it.

### Patch Changes

- @getmunin/core@2.1.0
- @getmunin/db@2.1.0
- @getmunin/types@2.1.0
- @getmunin/mcp-toolkit@2.1.0
- @getmunin/bootstrap@2.1.0

## 2.0.0

### Patch Changes

- @getmunin/core@2.0.0
- @getmunin/db@2.0.0
- @getmunin/types@2.0.0
- @getmunin/mcp-toolkit@2.0.0
- @getmunin/bootstrap@2.0.0

## 1.0.0

### Major Changes

- dc34579: refactor(api)!: version every JSON endpoint under /api/v1

  Pre-launch cleanup of the HTTP API surface. Stamps `/api/v1/...` on
  every JSON endpoint and locks in conventions before any external
  client embeds a URL.

  **Breaking** for every API consumer. Excluded paths are unchanged:
  `/healthz`, `/readyz`, `/version`, `/auth/*`, `/static/assets/*`, and
  `/mcp` (which lives on the `mcp.getmunin.com` subdomain in production
  and uses the host as its namespace).

  Notable structural moves:
  - `/whoami` → `/api/v1/whoami`
  - `/api/audit-log` → `/api/v1/admin/audit-logs` (admin-prefixed, plural)
  - `/api/orgs/me/memberships` → `/api/v1/me/memberships` (it lists the user's orgs, not the active org's data)
  - `/api/end-user/conversations/...` → `/api/v1/end-users/me/conversations/...`
  - `/api/conv/...` → `/api/v1/conversations/...` (abbreviation spelled out)
  - `/api/conv/widget/messages` → `/api/v1/widget/messages` (avoids a `:id` collision with `/api/v1/conversations/:id/messages`)
  - `/api/curator/jobs` → `/api/v1/curation/jobs`
  - `/api/inbox/queue` → `/api/v1/inbox`
  - `/api/cms/v1/...` → `/api/v1/cms/...` (collapsed inner version)
  - `/api/realtime` (WebSocket) → `/api/v1/realtime`
  - `/api/delegated-token` → `/api/v1/tokens/delegated`

  Verb fixes:
  - `POST /api/tokens/:id/revoke` → `DELETE /api/v1/tokens/:id`
  - `POST /api/conv/channels/widget/:id` (update) → `PATCH /api/v1/conversations/channels/widget/:id`
  - `POST /api/crm/segments/:id` (update) → `PATCH /api/v1/crm/segments/:id`
  - `DELETE /api/kb/curation/candidates/:id` (dismiss) → `POST .../candidates/:id/dismiss`

  `api-keys` and `tokens` stay as separate sibling resources because they map to different DB tables (`schema.apiKeys` vs `schema.tokens`); delegated-token mint moves under `/tokens/delegated` since it writes to `schema.tokens`.

### Patch Changes

- @getmunin/core@1.0.0
- @getmunin/db@1.0.0
- @getmunin/types@1.0.0
- @getmunin/mcp-toolkit@1.0.0
- @getmunin/bootstrap@1.0.0

## 0.25.0

### Patch Changes

- @getmunin/core@0.25.0
- @getmunin/db@0.25.0
- @getmunin/types@0.25.0
- @getmunin/mcp-toolkit@0.25.0
- @getmunin/bootstrap@0.25.0

## 0.24.1

### Patch Changes

- @getmunin/core@0.24.1
- @getmunin/db@0.24.1
- @getmunin/types@0.24.1
- @getmunin/mcp-toolkit@0.24.1
- @getmunin/bootstrap@0.24.1

## 0.24.0

### Patch Changes

- @getmunin/core@0.24.0
- @getmunin/db@0.24.0
- @getmunin/types@0.24.0
- @getmunin/mcp-toolkit@0.24.0
- @getmunin/bootstrap@0.24.0

## 0.23.3

### Patch Changes

- @getmunin/core@0.23.3
- @getmunin/db@0.23.3
- @getmunin/types@0.23.3
- @getmunin/mcp-toolkit@0.23.3
- @getmunin/bootstrap@0.23.3

## 0.23.2

### Patch Changes

- b9b5968: Fix self-service agent detection in realtime gateway. The dashboard's "agent connected" indicator was checking `actor.audiences.includes('self_service')` — but OSS admin API keys default to `['admin']` only (cloud mints runner keys with both audiences as a flag). Self-hosters running `@getmunin/agent-runtime` against their local Munin saw "no agent connected" even with chat working fine.

  Drop the audience overlay. A live WebSocket subscriber that isn't an end-user-agent token _is_ the runner — there's no other admin caller that opens a sustained WS in OSS (dashboard uses session cookies, control-plane scripts don't subscribe). Removes the OSS/cloud asymmetry. No migration needed; existing keys work immediately.
  - @getmunin/core@0.23.2
  - @getmunin/db@0.23.2
  - @getmunin/types@0.23.2
  - @getmunin/mcp-toolkit@0.23.2
  - @getmunin/bootstrap@0.23.2

## 0.23.1

### Patch Changes

- 4ff9c11: Remove dashboard outreach campaigns config page. Campaign CRUD now lives only via the admin MCP tools (`outreach_create_campaign`, `outreach_update_campaign`, `outreach_list_campaigns`, `outreach_get_campaign`) — agent-native setup, dashboard-native review. Drops the `/dashboard/settings/outreach` route, the `OutreachCampaignsPage` export, and the `/api/outreach/campaigns` REST controller. The Review tab (`OutreachDraftsTab`) and `/api/outreach/proposals` are unaffected.
  - @getmunin/core@0.23.1
  - @getmunin/db@0.23.1
  - @getmunin/types@0.23.1
  - @getmunin/mcp-toolkit@0.23.1
  - @getmunin/bootstrap@0.23.1

## 0.23.0

### Minor Changes

- 88b1bc3: Outreach feature, PR3 of 3 — `agentMode` + draft-on-reply loop. Closes the outreach loop: every reply on an outreach-originated conversation gets drafted by an admin agent and waits for human approval. The AI conversational runner never auto-replies on these conversations, even when the prospect responds.

  **`agentMode` on conversations.** New enum column `agent_mode` on `conv_conversations` with values `auto | draft_only | off`, default `auto`. Orthogonal to claims (claims are _who's working it now, with TTL_; agentMode is _what posture the agent takes, durable_). Reusable beyond outreach — a customer can flip a single conversation or a whole channel into `draft_only` for trust-building, moderation, or VIP review.
  - `ConvService.setAgentMode(id, mode)` + REST `POST /api/conversations/:id/agent-mode`.
  - `ConvService.createConversation` accepts `agentMode` (default `'auto'`).
  - `ConversationSummary`/`Detail` DTOs now expose `agentMode` and `outreachCampaignId`.
  - `agent-runtime`'s `ConversationHandler.shouldRespond` defers when `agentMode !== 'auto'` (logged as `skip <id>: agentMode=draft_only`). Two new unit tests cover both `draft_only` and `off`.
  - `MuninRestClient.ConversationDetail` adds `agentMode` and `outreachCampaignId`.

  **Outreach reply-curator skill.** New `skill://outreach/draft-reply`. Triggered event-driven: when an inbound message lands on a conversation that has both `outreachCampaignId` set and `agentMode='draft_only'`, `ConvService.sendMessage` enqueues a curator job (dedupe-keyed by message id). The skill reads the thread, identifies the prospect's intent (question / decline / ask-for-human / off-topic / hostile), grounds factual claims via `kb_search`, drafts a 30–120-word reply, and files it via `outreach_propose_reply` for human approval. Strict rules: no unsubscribe footer (initials carry it; replies thread inside), no auto-send.

  **Outreach service.**
  - `OutreachService.proposeReply({ conversationId, draftBody, evidence })` — files a `kind='reply'` proposal. Rejects when the conversation is not outreach-originated. Resolves CRM contact via the conversation's `conv_contacts.email`.
  - `OutreachService.approveProposal` now branches on kind. `kind='initial'` flips the new conversation to `agentMode='draft_only'` (so the AI runner defers on subsequent inbound messages). `kind='reply'` sends the draft body verbatim via `conv.sendMessage` on the existing conversation — no unsubscribe footer.
  - New MCP tool `outreach_propose_reply` (admin audience). The reply skill calls it.

  **Sidecar `toolPrefixesFor`** adds `'skill://outreach/draft-reply'` → `['conv_', 'kb_', 'crm_', 'outreach_']`. Cloud `AgentRunnerService.toolPrefixesFor` needs the same one-line addition (separate cloud PR after this OSS release).

  **Dashboard.** `OutreachDraftsTab` differentiates kind with a coloured badge (`Reply` filled, `Initial` outline). Reply cards link to `/dashboard/conversations?id=<id>` so the operator can see thread context before approving. i18n string `viewThread` added in en + nb.

  **Schema migration** `0013_conv_agent_mode.sql` — single column add; default `'auto'` so all existing conversations are unaffected. Outreach conversations created via `approveProposal` going forward land in `'draft_only'`.

  **Tests.** 6 new (2 in agent-runtime for the defer; 2 in conv.service for the inbound-on-outreach enqueue path; 4 in outreach.service for proposeReply, approveReply send + no-footer assertion, agentMode=draft_only on initial approve, and the not-outreach-conversation rejection). All 321 backend-core tests pass; 67 agent-runtime tests pass.

  **End-to-end:** an operator can now run a campaign where the entire loop — first send and every reply — is human-approved. Combined with PR1's suppression+consent floor and the unsubscribe infrastructure, this is the GDPR-compliant, never-auto-sends outbound channel the plan promised.

### Patch Changes

- Updated dependencies [88b1bc3]
  - @getmunin/db@0.23.0
  - @getmunin/bootstrap@0.23.0
  - @getmunin/core@0.23.0
  - @getmunin/mcp-toolkit@0.23.0
  - @getmunin/types@0.23.0

## 0.22.0

### Minor Changes

- 355856a: CRM contact-extract curator — auto-applied per-conversation contact creation from chat.

  When a conversation is `changeStatus`'d to `closed`, `ConvService` now enqueues a `skill://crm/contact-extract` curator job (dedupe-keyed by conversation id). The skill runs once per closed conversation, reads the thread, extracts identifying info volunteered by the end-user (name, email, phone, title, company), dedupes via `crm_find_contact`, then either `crm_create_contact` (new visitor) or `crm_update_contact` (backfills empty fields only — never overwrites human-curated data) with the conversation's `endUserId` linking the contact back to its participant. Tagged `from-chat` so operators can filter contacts that arrived this way.

  **Auto-apply, not propose.** The data source is the user's own typed message — qualitatively different from KB curation, where the curator drafts new factual claims (LLM hallucination risk → must propose). For contact extraction the agent transcribes what the user said; if it's wrong the operator dismisses via the existing CRM list. No new Review tab, no proposal table.

  **Composes with existing `skill://crm/hygiene`.** The hygiene curator runs weekly across the whole population and proposes merges for any duplicates this per-conversation extraction misses (e.g. visitor gives email in conv #1 and phone in conv #2 with no overlap). Different windows, different scope, complementary.

  **Scope filtering:** the skill skips silently when the conversation has no `endUserId`, when nothing identifying was said, or when the linked contact already has email + phone + name populated.

  Sidecar `toolPrefixesFor()` updated to allow `['conv_', 'crm_']` for the new skill. The cloud's `AgentRunnerService.toolPrefixesFor()` needs the same one-line addition (separate cloud PR after this OSS release).

- 355856a: CRM segments, GDPR consent on contacts, and outreach unsubscribe infrastructure — the foundation for the upcoming outreach feature, but independently useful as compliance work.

  **Schema additions** (`@getmunin/db`)
  - New `crm_segments` table — saved contact filters with org-scoped uniqueness on `(org_id, name)`. Filter shape: `tagsAny`, `tagsAll`, `companyId`, `searchQuery`, `contactedSince` — all optional, ANDed together. RLS-isolated and admin-only via the existing `app_org_id()` / `app_end_user_id()` policy pattern.
  - `crm_contacts` gains `consent_lawful_basis` (varchar 32), `consent_given_at` (timestamptz), `consent_source` (text), `consent_evidence` (jsonb). Lawful basis values: `consent | legitimate_interest | contract`.

  **CRM service + MCP tools** (`@getmunin/backend-core`)
  - New service methods: `createSegment`, `updateSegment`, `getSegment`, `listSegments`, `deleteSegment`, `listContactsInSegment`, `setContactConsent`.
  - `listContactsInSegment` enforces a non-overridable suppression+consent floor: it always excludes contacts where `do_not_contact = true`, `unsubscribed_at IS NOT NULL`, or `consent_lawful_basis IS NULL`. Use this — not `listContacts` — to materialize an outreach audience; the floor lives in the service layer so every caller (operator UI, curator skill, future automation) inherits the same compliance posture.
  - New MCP tools (admin audience): `crm_create_segment`, `crm_update_segment`, `crm_list_segments`, `crm_get_segment`, `crm_delete_segment`, `crm_list_contacts_in_segment`, `crm_set_contact_consent`. The consent tool logs a CRM activity row for audit.
  - `ContactDto` now exposes the consent fields.

  **REST controllers** (`@getmunin/backend-core`)
  - `GET/POST /api/crm/segments`, `GET/POST/DELETE /api/crm/segments/:id`, `GET /api/crm/segments/:id/contacts` — admin-auth, mirrors the merge-proposals controller shape.
  - `GET /api/outreach/unsubscribe?token=...` — public (`@AllowAnonymous`), token-resolved. Verifies HMAC, marks `unsubscribed_at` and `do_not_contact = true`, logs an `Unsubscribed` activity row, and returns `{ ok, alreadyUnsubscribed, contactFound }`. Replays as a no-op for already-unsubscribed contacts.

  **HMAC unsubscribe tokens** (`@getmunin/core`)
  - New `signUnsubscribeToken({orgId, contactId, campaignId})` and `verifyUnsubscribeToken(token)` helpers. Format: `v1.<orgId>.<contactId>.<campaignId>.<issuedAt>.<hmacSig>`. Signed with `MUNIN_KEY_PEPPER` via the existing `signHmac` primitive; constant-time verified. No expiry by design — survives forwarding so a forwarded recipient can also unsubscribe themselves. `UnsubscribeTokenError` thrown on malformed / tampered / wrong-pepper tokens.

- 355856a: Fill in missing webhook / activity-log events across CRM, end-users, and API keys.

  Before: the dashboard's Activity log subtitle promised "every conversation message, status change, handover, KB write, **and CRM update** as it happens", but the CRM service only ever emitted events for merge proposals — `crm_create_contact`, `crm_update_contact`, deal moves, and activity logs all wrote silently. The end-users and API keys controllers similarly emitted nothing — surprising for surfaces a SIEM / audit consumer would specifically want to subscribe to.

  Now emitting:
  - **CRM** — `crm.contact.created`, `crm.contact.updated`, `crm.company.created`, `crm.deal.created`, `crm.deal.stage_changed` (with `winLoss` + `closedAt` on terminal transitions), `crm.activity.logged`. Existing `crm.merge_proposal.{proposed,applied,dismissed}` unchanged.
  - **End-users** — `end_user.created` on first-touch find-or-create. `end_user.tokens_revoked` on `/revoke-tokens` (security-relevant).
  - **API keys** — `api_key.minted` on POST, `api_key.revoked` on DELETE. The kind of event a SIEM webhook subscriber actually wants.

  All events flow through the same `WebhookDispatcher` already used by the conv / kb / cms modules — they land in the `events` table for the dashboard Activity log and ride the existing realtime + webhook delivery path. No new tables, no new routes; just plugging holes.

- ebda56e: Outreach feature, PR2 of 3 — campaigns + initial drafts + send-approve loop.

  The first user-visible piece of outbound: an operator defines a campaign (name + brief + CRM segment + email channel + cadence + CTA), the new `skill://outreach/draft-initial` curator drafts a personalised first-touch email per consenting contact in the segment, the operator reviews each draft on `/dashboard/review` (third tab), and approving sends via the existing email-channel outbound pipeline. Replies thread into normal conversations via the existing RFC 5322 thread-resolution.

  **Schema:**
  - `outreach_campaigns` — operator-defined campaigns (segment_id → `crm_segments`, channel_id → `conv_channels` (must be email), brief, cadence_rules JSONB, cta_url, enabled, unsubscribe_required). Unique `(org_id, name)`. RLS admin-only.
  - `outreach_proposals` — drafted email queue with `kind` (`initial` in PR2; `reply` in PR3), nullable `conversation_id` (set when sent), `status` lifecycle (pending → sent / dismissed / failed), evidence JSONB, audit fields. **Unique pending index on (campaign_id, contact_id, kind)** to prevent dup drafts. RLS admin-only.
  - `conv_conversations` gains `outreach_campaign_id` (nullable FK + index) — sticky once set, used for reply attribution and (in PR3) `agentMode` defaulting.
  - New `packages/db/src/sql/outreach.sql` with RLS policies, wired into `runMigrations`.

  **Service / MCP / REST** (all in new `@getmunin/backend-core/src/modules/outreach/`):
  - `OutreachService` — `listCampaigns`/`getCampaign`/`createCampaign`/`updateCampaign`/`listProposals`/`getProposal`/`proposeInitial`/`approveProposal`/`dismissProposal`. `approveProposal` re-checks suppression+consent at decision-time (the contact may have unsubscribed between draft and approval), creates a conversation with `outreach_campaign_id` set, sends via the existing email outbound pipeline, and appends a signed unsubscribe footer to the body server-side so it can't be tampered with at draft-time.
  - MCP tools (admin audience): `outreach_create_campaign`, `outreach_update_campaign`, `outreach_list_campaigns`, `outreach_get_campaign`, `outreach_list_proposals`, `outreach_propose_initial`.
  - REST: `GET/POST /api/outreach/campaigns`, `GET/POST /api/outreach/campaigns/:id`, `GET /api/outreach/proposals?status=pending&kind=initial&campaignId=…`, `GET /api/outreach/proposals/:id`, `POST /api/outreach/proposals/:id/approve`, `POST /api/outreach/proposals/:id/dismiss`. The proposals list/get embeds `contact` and `campaign` summaries so the dashboard doesn't need parallel fetches.
  - Realtime events: `outreach.proposal.created`, `outreach.proposal.sent`, `outreach.proposal.dismissed` (rides existing WebhookDispatcher).

  **Conv-side:** `ConvService.createConversation` now accepts `outreachCampaignId` and enqueues outbound delivery for non-end_user authors on email channels (it previously only did this from `sendMessage`, which broke first-touch sends). All existing flows are unaffected — they don't pass `outreachCampaignId` and their authorType doesn't trigger outbound enqueue.

  **Skill:** `skill://outreach/draft-initial` (markdown, copied into dist by the existing `copy-skills.mjs`). Procedure: list enabled campaigns → materialise audience via `crm_list_contacts_in_segment` (which already enforces the suppression+consent floor) → dedupe via `outreach_list_proposals` → ground in `kb_search` → draft 80–200 word personalised email → file via `outreach_propose_initial`. Strict formatting: no headings, plain prose, no JSON-escaping; the unsubscribe footer is appended at approve-time, not draft-time.

  **Curator scheduling:**
  - New sweep `curator-outreach-draft-initial` (default cron `'0 0 * * 0'` weekly, env `MUNIN_CURATOR_OUTREACH_INITIAL_CRON`).
  - Sidecar `toolPrefixesFor` adds `'skill://outreach/draft-initial'` → `['conv_', 'kb_', 'crm_', 'outreach_']`. Cloud `AgentRunnerService.toolPrefixesFor` needs the same one-line addition (separate cloud PR after this OSS release).

  **Dashboard:**
  - Third tab on `/dashboard/review`: `OutreachDraftsTab` lists pending proposals with markdown body (heading-flatten components shared with KB), Approve / Edit (placeholder; inline editing ships next) / Dismiss buttons. Realtime updates on `outreach.proposal.*` events.
  - New `/dashboard/settings/outreach` (under Monitoring → Workspace group) — list campaigns, create dialog with name + brief + segment dropdown + channel dropdown + CTA URL, enable/disable toggle. Empty-state nudges the operator if they have no email channels or segments yet.
  - i18n: `dashboard.outreach.*`, `dashboard.outreachDrafts.*`, `nav.outreach`, `dashboard.review.tabs.outreach` in en + nb.

  **Tests:** 9 new integration tests covering campaign CRUD (including non-email-channel rejection and duplicate-name conflict), `proposeInitial` (dedupe + consent floor), `approveProposal` (success path stamps conv id + delivery row, suppression-race refuses, disabled-campaign refuses), and `dismissProposal`. Existing 306 backend-core tests unchanged. `curator-scheduler.test.ts` updated to expect the new fourth cron job.

  **Out of PR2 scope (lands in PR3):** `agentMode` column + reply-curator skill + draft-on-reply loop. Operators currently get a one-way send; replies land in normal conversations and the AI agent will reply auto-mode by default until PR3 wires `agentMode = 'draft_only'` on outreach-originated conversations.

### Patch Changes

- Updated dependencies [355856a]
- Updated dependencies [ebda56e]
  - @getmunin/core@0.22.0
  - @getmunin/db@0.22.0
  - @getmunin/bootstrap@0.22.0
  - @getmunin/mcp-toolkit@0.22.0
  - @getmunin/types@0.22.0

## 0.21.0

### Minor Changes

- 914477f: Staff messages now atomically take over the conversation.

  **Backend** — `ConvService.sendMessage` auto-acquires a `ConversationClaim` whenever a non-internal user-authored message lands. Existing claims by the same user are refreshed; claims held by _other_ users no-op rather than throwing — the staff member already replying is implicitly the holder. The handover guard previously rejected any write where `actor.type === 'end_user_agent' || authorType === 'agent'`; that was too broad and blocked the chat-widget surface (which posts as `end_user_agent` on behalf of the end-user). The check is now strictly `authorType === 'agent'`, which is the only write type the claim guard exists to gate.

  **Agent runtime** — `shouldRespond` previously deferred whenever any prior `user`-authored message existed in the transcript. That was a coarse stand-in for "is a human handling this?" and it stayed sticky forever. The check now reads the conversation's `claim`: if `claim.holderType === 'user'`, defer until the holder releases (claims have a TTL, so this self-heals).

  The combined effect: a human reply takes the conversation, the AI silently steps back, and a "Release" action (or claim TTL expiry) hands it back. End-user follow-ups during the held window still go through, but the AI no longer races the human on the reply.

  `ConversationDetail` (returned by `MuninRestClient.getConversation`) gains a `claim: { holderType, holderId, expiresAt } | null` field so any agent-runtime consumer can read the same signal.

- 914477f: Channels can now be created and managed from the dashboard.

  **Backend** — new REST controller at `/api/conv/channels`:
  - `GET /` — list widget + email channels for the org.
  - `POST /widget` — create a chat-widget channel; mints and returns a one-shot `mn_widget_*` API key bound to the channel and origin allowlist.
  - `POST /widget/:id` — update name / origin allowlist / display name.
  - `POST /widget/:id/rotate-key` — revoke prior keys and mint a new one (one-shot return).
  - `POST /email` — create an email channel with operator-supplied SMTP credentials and optional IMAP for inbound. Passwords are encrypted at rest.
  - `POST /email/:id/test` — verify SMTP/IMAP credentials before enabling.

  Munin doesn't ship a built-in mailer; email channels require operator-provided SMTP, matching the OSS posture for outbound on every other surface.

  **Dashboard** — new "Channels" entry under Settings with an "Add channel" dropdown (chat widget / email). Each option opens a dedicated dialog. Widget cards expose the bound key on creation and rotation; email cards expose a "Test" button. Norwegian (`nb`) translations included.

- 914477f: Unified Review surface for KB suggestions and CRM merges, with structured-field-driven curation candidates.

  **Dashboard** — replaces the standalone `/dashboard/crm-merge-proposals` page (now redirects) with `/dashboard/review`, a tabbed page combining KB suggestions and CRM merges. Tab counts update live from `kb.*` and `crm.merge_proposal.*` realtime events; the home overview backlog rows for both queues now link into Review. The KB tab renders each candidate's body as markdown (via `react-markdown`, peer dep) inside a `prose` block; `h1`–`h6` are flattened to bold paragraphs so the body never visually competes with the candidate title. Each card has its own "Publish to:" picker pre-selected to the candidate's proposed target space, with a per-card override.

  **Backend — KB candidate DTO** — new structured fields on the curation candidate response:
  - `proposedTargetSpaceSlug: string | null` — extracted from the candidate's `target:<slug>` tag.
  - `sourceConversationId: string | null` — extracted from the `source:<id>` tag.

  Two new service methods (`KbService.listCurationCandidates`, `KbService.getCurationCandidate`) return these fields directly so the dashboard never has to regex over body prose. New REST routes at `/api/kb/curation/candidates` (list/get/publish/dismiss) and `/api/kb/spaces` (list) back the new UI. The "Source conversation / Proposed target space" footer that `proposeCurationCandidate` used to splice into the body is gone — the tags carry the same data and the structured fields surface it.

  **KB curation skill prompt** — Step 4 now sets explicit formatting rules for candidate bodies: subject is the title, body is plain prose with bold/italic/inline-code/short bullets allowed, **no `#`/`##`/`###` headings**, no JSON-escaping the body string, no tables/HTML/images. The "Drafted from conversation …" footer example is gone (now redundant with structured fields). This makes review-UI rendering predictable and prevents big duplicate-of-title H1s in the body.

  **UI fix** — `TabsTrigger` previously used `data-[selected]:` for the active-tab styling, but `@base-ui/react` Tabs emit `data-active`. The selected pill never highlighted. Fixed.

### Patch Changes

- @getmunin/core@0.21.0
- @getmunin/db@0.21.0
- @getmunin/types@0.21.0
- @getmunin/mcp-toolkit@0.21.0
- @getmunin/bootstrap@0.21.0

## 0.20.0

### Patch Changes

- @getmunin/core@0.20.0
- @getmunin/db@0.20.0
- @getmunin/types@0.20.0
- @getmunin/mcp-toolkit@0.20.0
- @getmunin/bootstrap@0.20.0

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

### Patch Changes

- Updated dependencies [f57a86b]
  - @getmunin/db@0.19.0
  - @getmunin/bootstrap@0.19.0
  - @getmunin/core@0.19.0
  - @getmunin/mcp-toolkit@0.19.0
  - @getmunin/types@0.19.0

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

### Patch Changes

- @getmunin/core@0.18.0
- @getmunin/db@0.18.0
- @getmunin/types@0.18.0
- @getmunin/mcp-toolkit@0.18.0
- @getmunin/bootstrap@0.18.0

## 0.17.0

### Minor Changes

- db26079: Adds a self-service-agent availability indicator to the dashboard. The realtime gateway now tracks live subscribers whose audiences include `self_service` (excluding end-user widgets) per org. New endpoint `GET /api/overview/agent-status` returns `{ selfServiceAgentSubscriberCount, lastInboundEndUserMessageAt, lastAgentMessageAt }`. Overview page renders a card showing connected/not-connected, and surfaces a warning state when there's no agent connected and end-user messages are unanswered. Solves the OSS bootstrapping confusion where a self-hoster's chat widget delivers messages into the void with no UI signal that nothing is listening on the agent side.

  Adds an `audiences` jsonb column on `api_keys` (default `['admin']`) and the credential resolver now reads it instead of hardcoding the audience set. This lets a key be minted with `audiences: ['admin', 'self_service']` so its realtime subscriptions are recognised as self-service-agent connections. Backwards compatible — existing rows default to admin-only.

### Patch Changes

- Updated dependencies [db26079]
  - @getmunin/core@0.17.0
  - @getmunin/db@0.17.0
  - @getmunin/bootstrap@0.17.0
  - @getmunin/mcp-toolkit@0.17.0
  - @getmunin/types@0.17.0

## 0.16.1

### Patch Changes

- Updated dependencies [cd2ba29]
  - @getmunin/db@0.16.1
  - @getmunin/bootstrap@0.16.1
  - @getmunin/core@0.16.1
  - @getmunin/mcp-toolkit@0.16.1
  - @getmunin/types@0.16.1

## 0.16.0

### Minor Changes

- b130ed7: `crm_apply_merge_proposal` now atomically reassigns the duplicate's activities (`crm_activities.contact_id`), deals (`crm_deals.primary_contact_id`), and contact-typed relationships (`crm_relationships.from_id`/`to_id` where the type is `contact`) onto the keeper inside the same transaction. The duplicate's `endUserId` transfers to the keeper if the keeper had none; otherwise it's cleared on the duplicate. The previously-documented limitation that "activities and deals stay on the original contactId" is gone.

  Adds webhook + realtime events for merge proposals: `crm.merge_proposal.proposed`, `crm.merge_proposal.applied`, `crm.merge_proposal.dismissed`. The dashboard review queue can now subscribe via the existing realtime gateway instead of polling `/api/overview/backlog`.

  New `skill://cms/stale-content-review` walks an admin agent through a periodic stale-content audit (drafts, unrefreshed published entries, orphaned assets) and produces a structured action report. v1 is propose-only — no persistent inbox; the operator reviews the curator-runner's reply and acts via the existing `cms_*` tools.

- 109e723: Adds a CRM merge proposals review page to the dashboard. New REST controller exposes `GET /api/crm/merge-proposals`, `GET /api/crm/merge-proposals/:id`, `POST /api/crm/merge-proposals/:id/apply`, `POST /api/crm/merge-proposals/:id/dismiss` so the dashboard can list pending proposals and resolve them with one click. The page subscribes to the new `crm.merge_proposal.*` realtime events so the queue updates without polling, and falls back to a 60s poll. The "Needs attention" backlog tile gets a CRM merge counter that links to the page; nav adds a top-level "CRM merges" entry. en + nb i18n strings included.

### Patch Changes

- @getmunin/core@0.16.0
- @getmunin/db@0.16.0
- @getmunin/types@0.16.0
- @getmunin/mcp-toolkit@0.16.0
- @getmunin/bootstrap@0.16.0

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

- b7b7644: CRM merge proposals: new `crm_merge_proposals` table (migration `0007`) plus four admin MCP tools — `crm_propose_merge_candidate`, `crm_list_merge_proposals`, `crm_apply_merge_proposal`, `crm_dismiss_merge_proposal`. New `skill://crm/hygiene` walks an admin agent through filing structured proposals; `crm_apply_merge_proposal` atomically copies the recommended patch onto the keeper, archives the duplicate (`dedup-archived-YYYY-MM` tag + `customFields.mergedInto` + `doNotContact`), and marks the proposal applied. Pending proposals are unique per `(orgId, contactA, contactB)` pair so re-running the curator is idempotent. `OverviewBacklog` now exposes `crmMergeProposalsPending` for the dashboard backlog card.

### Patch Changes

- Updated dependencies [b7b7644]
  - @getmunin/db@0.15.0
  - @getmunin/bootstrap@0.15.0
  - @getmunin/core@0.15.0
  - @getmunin/mcp-toolkit@0.15.0
  - @getmunin/types@0.15.0

## 0.14.0

### Patch Changes

- @getmunin/core@0.14.0
- @getmunin/db@0.14.0
- @getmunin/types@0.14.0
- @getmunin/mcp-toolkit@0.14.0
- @getmunin/bootstrap@0.14.0

## 0.13.0

### Minor Changes

- a61dd11: Add a "Needs attention" backlog card to the dashboard overview, plus a
  small `/api/overview/backlog` aggregator that returns counts of items
  across modules waiting on human or admin-agent attention.

  The card is a _signal_, not a CRUD surface — it tells the operator
  what to attend to (open conversations needing handover, KB curation
  candidates pending review) but the actual work still happens through
  the connected admin agent. This keeps the dashboard on-thesis ("the
  agent is the UI") while still giving operators a single place to see
  the backlog grow and shrink.

  Today the card surfaces:
  - conversations with `needsHumanAttention = true`
  - KB documents in the `kb-curation-inbox` space tagged `candidate`

  Future modules (CRM dirty-data, CMS stale-content, …) can extend the
  endpoint shape without controller refactoring — it returns a flat
  `{ key: count }` object.

### Patch Changes

- @getmunin/core@0.13.0
- @getmunin/db@0.13.0
- @getmunin/types@0.13.0
- @getmunin/mcp-toolkit@0.13.0
- @getmunin/bootstrap@0.13.0

## 0.12.0

### Minor Changes

- d391104: Add the agent-native primitives for closing the curation loop: when the
  self-service agent flags a conversation for handover and a human reply
  later clears the flag, that (question, answer) pair should eventually
  become a KB document so the next end-user gets a real answer instead of
  another handover.

  This change ships the primitives — the actual curation work happens
  through the operator's connected admin agent following the new skill.
  - New skill: `skill://kb/curation` — the procedure an admin agent
    follows to turn resolved-handover conversations into draft KB docs.
  - New admin tool: `kb_propose_curation_candidate({ subject, draftBody,
sourceConversationId?, sourceMessageIds?, proposedTargetSpaceSlug? })`.
    Lazily creates the `kb-curation-inbox` KB space (audience: admin) on
    first call, then files the draft as a KB document tagged
    `curation`/`candidate`. Source conversation traceability lands in the
    body footer.
  - New admin tool: `kb_publish_curation_candidate({ candidateDocumentId,
targetSpaceSlug, audiences? })` — promotes a reviewed candidate into
    a target space, drops the candidate tags, defaults audiences to
    `['admin', 'self_service']` so the self-service agent can find it.
  - New realtime event: `conversation.handover_resolved` — emitted when
    `convConversations.needsHumanAttention` flips from true to false via
    a non-internal user/agent message. Payload: `{ conversationId,
messageId, authorType }`. Currently consumed by no one in OSS; a
    follow-up cloud curator runner will subscribe to drive auto-curation
    passes.

  No CRUD UI for the curation inbox — candidates are reviewed via the
  agent (or the existing `kb_list_documents` tool with `tag: 'candidate'`).
  The dashboard's overview card (PR-B) surfaces the _count_ of pending
  candidates as an operational signal.

### Patch Changes

- dafbd5b: Fix the AuthGuard and RealtimeGateway routing delegated end-user tokens
  (`mn_dlg_*`) to `resolveApiKey` because they match the generic
  `mn_<kind>_*` shape. `resolveApiKey` only queries the `api_keys` table,
  so delegated tokens never resolved and every protected endpoint
  (including `/mcp` and `/api/realtime`) returned 401 when called with a
  freshly minted delegated token.

  Tokens with the `mn_dlg_` prefix now route to `resolveBearerToken`
  directly, which queries the `tokens` table where they actually live.

  The integration test fixtures were using bare 32-byte random tokens
  (no `mn_dlg_` prefix) for delegated-token cases, which masked the bug.
  Updated those fixtures to use `buildApiKey('dlg')` so they exercise the
  real prefix routing path.
  - @getmunin/core@0.12.0
  - @getmunin/db@0.12.0
  - @getmunin/types@0.12.0
  - @getmunin/mcp-toolkit@0.12.0
  - @getmunin/bootstrap@0.12.0

## 0.11.0

### Patch Changes

- @getmunin/core@0.11.0
- @getmunin/db@0.11.0
- @getmunin/types@0.11.0
- @getmunin/mcp-toolkit@0.11.0
- @getmunin/bootstrap@0.11.0

## 0.10.0

### Patch Changes

- @getmunin/core@0.10.0
- @getmunin/db@0.10.0
- @getmunin/types@0.10.0
- @getmunin/mcp-toolkit@0.10.0
- @getmunin/bootstrap@0.10.0

## 0.9.1

### Patch Changes

- @getmunin/core@0.9.1
- @getmunin/db@0.9.1
- @getmunin/types@0.9.1
- @getmunin/mcp-toolkit@0.9.1
- @getmunin/bootstrap@0.9.1

## Unreleased

### Major Changes

- **BREAKING:** Rename "runbooks" → "skills" across the MCP layer, public REST API, and dashboard. The MCP resource URI scheme changes from `runbook://<module>/<slug>` to `skill://<module>/<slug>`. The public REST mirror moves from `/api/public/runbooks{,/:module/:slug}` to `/api/public/skills{,/:module/:slug}`. The Nest providers `McpRunbookRegistryService` / `PublicRunbooksController` are renamed to `McpSkillRegistryService` / `PublicSkillsController`; `mcp-toolkit` exports `SkillRegistry` / `RegisteredSkill` in place of the runbook-named equivalents and the `createMcpServer` option `runbooks` is now `skills`. Per-module markdown directories move from `modules/<m>/runbooks/*.md` to `modules/<m>/skills/*.md`. A new top-level `modules/playbooks/skills/*.md` namespace is introduced for cross-module workflows; agents can find them at `skill://playbooks/<slug>`. No backwards-compat shims — clients must update URI prefixes and REST paths atomically.

## 0.9.0

### Patch Changes

- @getmunin/core@0.9.0
- @getmunin/db@0.9.0
- @getmunin/types@0.9.0
- @getmunin/mcp-toolkit@0.9.0
- @getmunin/bootstrap@0.9.0

## 0.8.0

### Minor Changes

- 26d3007: Add public REST endpoint `/api/public/runbooks` (list) + `/api/public/runbooks/:module/:slug` (read) so a marketing site can render runbooks server-side. Honors a `public: true|false` field in runbook frontmatter (default true). The same audience-filtered MCP `resources/list` + `resources/read` paths are unchanged. Also fixes runbook URI derivation so files inside `<module>/runbooks/*.md` produce `runbook://<module>/<slug>` (not `runbook://runbooks/<slug>`).

### Patch Changes

- Updated dependencies [26d3007]
  - @getmunin/mcp-toolkit@0.8.0
  - @getmunin/core@0.8.0
  - @getmunin/db@0.8.0
  - @getmunin/types@0.8.0
  - @getmunin/bootstrap@0.8.0

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
