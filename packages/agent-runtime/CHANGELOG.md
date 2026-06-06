# @getmunin/agent-runtime

## 4.40.2

### Patch Changes

- @getmunin/core@4.40.2

## 4.40.1

### Patch Changes

- 706d8c9: CodeQL cleanup: drop the `Math.random` session-id fallback in the chat widget (modern browsers always have `crypto.randomUUID`/`getRandomValues`), tighten the HTML-stripping regexes used by the web crawler and widget email fallback so nested/whitespaced `</script>` tags don't slip through, and rejection-sample in `makeId` to remove the modulo bias on the cryptographic random source.
  - @getmunin/core@4.40.1

## 4.40.0

### Patch Changes

- @getmunin/core@4.40.0

## 4.39.0

### Patch Changes

- @getmunin/core@4.39.0

## 4.38.0

### Patch Changes

- 0110a7e: MCP dispatch now records redacted `args` on every audit row — including the `denied`, `invalid_input`, `rate_limited`, and thrown-handler paths that previously dropped the args. The success path is unchanged. The `invalid_input` row also now carries the Zod error message in its `error` column instead of just the literal string `"invalid_input"`. Caller-controlled args on `unknown_tool` are still dropped (no schema available to redact against).

  A new optional `captureException` hook on `createMcpServer` / `openInProcessMcpClient` receives any error thrown by a tool handler, along with the tool name, actor identity (type / id / orgId), and redacted args. `mcp-toolkit` remains observability-vendor agnostic.

  `@getmunin/backend-core` exposes the wiring: a new `ErrorReporterModule` registers a `NoopErrorReporter` against the `ERROR_REPORTER` injection token. `McpController` injects it and forwards thrown handler errors. Hosts that want Sentry (or any other reporter) replace the provider for `ERROR_REPORTER` with their own `ErrorReporter` subclass — `apps/backend` does this with a `SentryErrorReporter` that uses `Sentry.withScope` to attach the tool / actor / args context.

  The `cms_upload_asset_from_url` / `cms_upload_asset_from_file` error path now walks the `Error.cause` chain when an outbound fetch fails, so the surfaced message includes the underlying error code (e.g. `ENOTFOUND`, `ECONNRESET`, `CERT_HAS_EXPIRED`) instead of undici's opaque `"fetch failed"`. The unwrapping helper lives in `@getmunin/core` as `describeError(err, maxDepth?)` so other callers of `safeFetch` (and anywhere else cause-chain visibility matters) can reuse it.

  `describeError` also replaces three sites that previously surfaced only `err.message`: the webhook delivery worker (`webhook_deliveries.error` — visible to customers via `webhooks_list_deliveries`), `@getmunin/agent-host`'s models fetcher, and `@getmunin/agent-runtime`'s web crawler. Each of those had its own local `describe(err)` helper that did the inferior version.

- Updated dependencies [0110a7e]
  - @getmunin/core@4.38.0

## 4.37.0

### Patch Changes

- @getmunin/core@4.37.0

## 4.36.0

### Patch Changes

- @getmunin/core@4.36.0

## 4.35.0

### Patch Changes

- Updated dependencies [73320e2]
  - @getmunin/core@4.35.0

## 4.34.0

### Patch Changes

- Updated dependencies [290472e]
  - @getmunin/core@4.34.0

## 4.33.0

### Patch Changes

- Updated dependencies [9042f0e]
  - @getmunin/core@4.33.0

## 4.32.0

### Patch Changes

- Updated dependencies [f6cb178]
- Updated dependencies [211f215]
  - @getmunin/core@4.32.0

## 4.31.0

### Patch Changes

- @getmunin/core@4.31.0

## 4.30.0

### Patch Changes

- @getmunin/core@4.30.0

## 4.29.2

### Patch Changes

- @getmunin/core@4.29.2

## 4.29.1

### Patch Changes

- Updated dependencies [84b988d]
  - @getmunin/core@4.29.1

## 4.29.0

### Patch Changes

- @getmunin/core@4.29.0

## 4.28.0

### Patch Changes

- Updated dependencies [7436b8c]
- Updated dependencies [025b064]
  - @getmunin/core@4.28.0

## 4.27.1

### Patch Changes

- @getmunin/core@4.27.1

## 4.27.0

### Minor Changes

- 6c585ba: Localize the AI-down greet and handover fallback messages to the visitor's widget locale across all 13 widget-supported locales (en, nb, da, sv, fi, is, de, fr, es, it, pt, nl, pl). Previously a Norwegian visitor whose widget was in `nb` still saw English fallback copy when the LLM provider was unreachable.

  The chat widget now sends its picked locale on every conv-create / message-ingest request. The backend stashes it in `end_users.metadata.locale` (no schema migration — the column was already jsonb). `ConversationDetail.endUserLocale` exposes the value to the agent runtime, which looks up the localized string from a new `fallback-messages` module. Unknown locales and other channels (email, SMS, voice) fall back to English at lookup time.

  Greet copy mirrors the widget's existing `defaultGreeting` tone per locale (e.g. `nb: "Hei. Hva kan vi hjelpe deg med?"`); handover copy is a fresh translation matching each locale's existing widget tone.

- b46a41c: Rename agent recipes to role/task-shaped names that match how teams already describe the work: Lead Enricher → **Lead Research**, Lead Scorer → **Lead Scoring**, Bug Spotter → **Bug Triage**, Renewal Watcher → **Renewal Watch**, Win-Back Agent → **Win-Back**, Outreach Drafter → **SDR**. Recipe slugs in `packages/docs-pages/src/guides/` follow (e.g. `recipe-bug-spotter` → `recipe-bug-triage`, `recipe-outreach-drafter` → `recipe-sdr`); `dashboard-pages` `RECIPES` data updated to match. Cloud-side dependants need a coordinated bump of `@getmunin/docs-pages` to pick up the new exports.

  Add two client guides: **Connect Hermes Agent** (Nous Research) and **Connect OpenClaw**, each with config snippets verified against the upstream MCP reference docs and the standard mint-key / verify / scope flow. Sort the Recipes and Clients categories alphabetically in `guidesByCategory()` so the sidebar and overview grid stay predictable as the library grows.

  Tighten cloud landing-page copy and tool chips to match the actual recipes: drop the non-existent `task://web/scrape-website` chip from Lead Research; fix Bug Triage's italic ("hiding in conversations", not "tickets") and body (filed as internal notes via `conv_send_message`, not "structured proposals"); soften Renewal Watch's body ("account signals" rather than a fabricated "usage + sentiment + open issues"); fill in tool chips that were omitted (Lead Scoring, Renewal Watch, Event Follow-up, SDR, Conversation Distiller).

  When the AI provider is unreachable on a brand-new conversation, the runtime now posts a generic hardcoded greeting (`"Hi, what can we do for you?"`) instead of escalating to a human — there is nothing for an operator to reply to before the visitor has said anything. The handover fallback path is unchanged for visitor replies: those still escalate with `"I'm having trouble responding right now. A teammate will follow up shortly."` (the trailing `"Thanks for your message —"` opener was dropped — the lead-in doesn't fit a turn where the visitor hasn't messaged us yet).

### Patch Changes

- Updated dependencies [97bfdb8]
- Updated dependencies [2605e0f]
- Updated dependencies [24905e6]
  - @getmunin/core@4.27.0

## 4.26.0

### Patch Changes

- @getmunin/core@4.26.0

## 4.25.0

### Patch Changes

- 7ddf932: **Security**: address four audit findings.
  - **High**: gate every sensitive control-plane endpoint on owner/admin role (webhooks, conversation channels, agent-config, org/assistant PATCH, etc.). Previously any signed-in member could rotate widget keys, change LLM provider credentials, or create event-exfiltrating webhooks.
  - **High**: agent provider URLs (`providerBaseUrl`) now route through `safeFetch` (blocks private/loopback/link-local hosts) and reject `http://` unless `MUNIN_SSRF_ALLOW_PRIVATE` is set. Closes the SSRF + credential-exfil path that let a misconfigured base URL leak the provider API key.
  - **High**: add RLS policy on `conv_widget_email_fallbacks` (the ledger had `org_id` but no policy). Plus a meta-test in `rls.test.ts` that fails when any `org_id`-bearing table is missing RLS.
  - **Medium**: expand role-coverage integration tests to cover the newly-gated endpoints (webhooks, conv channels, org/assistant PATCH).

  **Ergonomics**: introduce `@RequireRole(...)` / `@RequireActorType(...)` decorators + a single `RoleGuard` to replace inline `assertOwnerOrAdmin(...)` calls scattered across ~13 controllers. Conditional / body-dependent checks (`members:patch`) stay inline.
  - @getmunin/core@4.25.0

## 4.24.3

### Patch Changes

- @getmunin/core@4.24.3

## 4.24.2

### Patch Changes

- @getmunin/core@4.24.2

## 4.24.1

### Patch Changes

- @getmunin/core@4.24.1

## 4.24.0

### Patch Changes

- Updated dependencies [ef55e18]
  - @getmunin/core@4.24.0

## 4.23.5

### Patch Changes

- @getmunin/core@4.23.5

## 4.23.4

### Patch Changes

- Updated dependencies [6dfabd2]
  - @getmunin/core@4.23.4

## 4.23.3

### Patch Changes

- Updated dependencies [57d7901]
  - @getmunin/core@4.23.3

## 4.23.2

### Patch Changes

- f0e5389: Security: close widget→admin escalation, SSRF in website-import, upload signing weaknesses, and control-plane authorization gaps.
  - Public `mn_widget_*` keys now resolve as a new `widget_agent` actor (not `admin_agent`), with audience forced to `self_service` and scopes narrowed to `conv:widget:write`. New `ControlPlaneGuard` rejects widget/end-user/partner actors and scoped admin keys (must have `*`) on `/v1/*` admin routes, so embedded widget keys can no longer mint, list, or revoke admin API keys, configure channels, or enqueue curator jobs.
  - Website-import enqueue and the underlying crawler validate URLs against private/loopback/link-local/cloud-metadata ranges. A new `safeFetch` helper enforces an undici dispatcher that re-validates the resolved IP at connect time (DNS-rebinding-safe) and walks redirects manually.
  - Local-storage upload signing switched from plain SHA-256 to HMAC-SHA256; `LocalFsStorage` throws on startup if `MUNIN_STORAGE_LOCAL_SECRET` is missing under `NODE_ENV=production`. Static asset serving sets `X-Content-Type-Options: nosniff`.
  - S3 uploads switched from presigned PUT to presigned POST with a `content-length-range` policy condition pinned to the declared size, so an oversized body is rejected by S3 itself. `cms_complete_asset_upload` HEADs the object and rejects (deleting the storage object) on size mismatch. `AssetStorage.presignedUpload` now returns `{ uploadUrl, uploadMethod, uploadFields, … }`; `AssetStorage.statBytes` is now required on the interface.

- Updated dependencies [f0e5389]
  - @getmunin/core@4.23.2

## 4.23.1

### Patch Changes

- @getmunin/core@4.23.1

## 4.23.0

### Patch Changes

- @getmunin/core@4.23.0

## 4.22.0

### Patch Changes

- @getmunin/core@4.22.0

## 4.21.0

### Patch Changes

- @getmunin/core@4.21.0

## 4.20.0

### Patch Changes

- @getmunin/core@4.20.0

## 4.19.4

### Patch Changes

- aa30308: Fix silent handover when the agent runtime exhausts retries against an unhealthy LLM provider.
  - `conversation-handler` now calls a new admin REST endpoint (`POST /v1/conversations/:id/request-handover` with `publicFallbackMessage`) instead of routing handover through an end-user MCP tool call. The MCP path required `conv:write` scope on the end-user agent actor, which the in-process agent host doesn't grant — so the call was being silently denied with an MCP `errorResult`, leaving the conversation un-flagged and the end user staring at an empty widget.
  - `convService.requestHandover()` now accepts an optional `publicFallbackMessage`. When set, it posts a user-visible agent message (`internal: false`, `metadata.kind = "handover_fallback"`) so the end user sees confirmation that a teammate is coming, even when the LLM never produced any reply. Mirrored on the admin `conv_request_handover` MCP tool and `POST /v1/conversations/:id/request-handover` HTTP route.
  - `MuninRestClient` gains a `requestHandover(conversationId, { reason, publicFallbackMessage })` method.

- 623dd4d: Fix the in-process end-user agent actor having no scopes, which silently disabled every self-service-audience tool that requires a write scope (handover, phone-call request, my-contact update, log-activity-self).
  - `agent-host`'s `openMcp` factory now passes a default scope set to `openEndUserAgentMcpClient` covering the full self-service surface: `conv:read`, `conv:write`, `kb:read`, `crm:read`, `crm:write`. Previously the actor was built with `[]`, so the MCP dispatcher rejected every gated tool call with a structured `errorResult('Missing required scope: …')` — silently, because tool errors do not throw — and the LLM's call was a no-op.
  - `agent-runtime`'s HTTP `mintDelegatedToken` default now includes `crm:write` for parity, so delegated end-user tokens minted by the runtime can call the same self-service surface.
  - Adds a regression test asserting a self-service actor with broad scopes is still blocked from admin-audience tools — the audience gate runs before the scope check, so granting an end-user agent `conv:write` does _not_ unlock admin conv tools.
  - @getmunin/core@4.19.4

## 4.19.3

### Patch Changes

- @getmunin/core@4.19.3

## 4.19.2

### Patch Changes

- @getmunin/core@4.19.2

## 4.19.1

### Patch Changes

- fb04e33: Fix misleading `created KB space agent-runtime` log on every backend
  startup. `ensureSpace` and `ensureDocument` were using `try/catch` to
  detect "already exists" conflicts, but `mcp.callTool()` never throws on
  tool errors — the MCP dispatch layer converts thrown errors into
  `{ isError: true, content: [...] }` results. The catch was unreachable
  dead code, so the success log fired on every reconcile even when the
  space/document already existed (the row itself was not being recreated).

  Switch both helpers to inspect `result.isError` (the same pattern as
  `parseDocumentBody`). Conflict path returns silently; non-conflict
  errors now actually throw. Test fake MCP handle was also returning a
  rejected promise for the conflict case, which hid the bug — updated to
  match real dispatch behavior.
  - @getmunin/core@4.19.1

## 4.19.0

### Patch Changes

- @getmunin/core@4.19.0

## 4.18.0

### Patch Changes

- @getmunin/core@4.18.0

## 4.17.0

### Patch Changes

- @getmunin/core@4.17.0

## 4.16.0

### Patch Changes

- @getmunin/core@4.16.0

## 4.15.0

### Patch Changes

- Updated dependencies [d8ed4f6]
  - @getmunin/core@4.15.0

## 4.14.0

### Patch Changes

- Updated dependencies [1fe1031]
  - @getmunin/core@4.14.0

## 4.13.0

### Patch Changes

- Updated dependencies [7977f92]
  - @getmunin/core@4.13.0

## 4.12.0

### Patch Changes

- @getmunin/core@4.12.0

## 4.11.0

### Patch Changes

- @getmunin/core@4.11.0

## 4.10.0

### Patch Changes

- @getmunin/core@4.10.0

## 4.9.0

### Patch Changes

- Updated dependencies [8c1c3c9]
- Updated dependencies [2ca3b4a]
- Updated dependencies [f9a8e0f]
  - @getmunin/core@4.9.0

## 4.8.0

### Patch Changes

- Updated dependencies [0a0e2a1]
  - @getmunin/core@4.8.0

## 4.7.1

### Patch Changes

- @getmunin/core@4.7.1

## 4.7.0

### Patch Changes

- Updated dependencies [5108510]
  - @getmunin/core@4.7.0

## 4.6.1

### Patch Changes

- @getmunin/core@4.6.1

## 4.6.0

### Patch Changes

- @getmunin/core@4.6.0

## 4.5.1

### Patch Changes

- @getmunin/core@4.5.1

## 4.5.0

### Patch Changes

- @getmunin/core@4.5.0

## 4.4.1

### Patch Changes

- @getmunin/core@4.4.1

## 4.4.0

### Patch Changes

- @getmunin/core@4.4.0

## 4.3.0

### Patch Changes

- @getmunin/core@4.3.0

## 4.2.0

### Patch Changes

- @getmunin/core@4.2.0

## 4.1.1

### Patch Changes

- @getmunin/core@4.1.1

## 4.1.0

### Patch Changes

- Updated dependencies [de1a7a6]
  - @getmunin/core@4.1.0

## 4.0.0

### Patch Changes

- @getmunin/core@4.0.0

## 3.9.1

### Patch Changes

- @getmunin/core@3.9.1

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
  - @getmunin/core@3.8.0

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

## 3.4.1

## 3.4.0

## 3.2.1

### Patch Changes

- c5e93e1: Add a `development` package-export condition pointing at `./src/index.ts` (and `./src/schema.ts` for `@getmunin/db`). Loaders that resolve with `--conditions=development` (e.g. the OSS backend's new `node --import @swc-node/register/esm-register --watch --conditions=development src/main.ts` dev script) see the TypeScript source directly; the existing `types` → `dist/*.d.ts` and `default` → `dist/*.js` resolution paths are unchanged, so production runtime, typecheck, and downstream consumers that don't opt into the condition keep their current behavior.

## 3.2.0

## 3.1.0

## 3.0.0

## 2.5.1

## 2.5.0

## 2.4.0

## 2.3.0

## 2.2.0

## 2.1.0

## 2.0.0

## 1.0.0

## 0.25.0

## 0.24.1

## 0.24.0

### Patch Changes

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

## 0.23.3

### Patch Changes

- b17aba4: Defense-in-depth against indirect prompt injection. The agent runtime now wraps every MCP tool result in `<tool_result tool="..."><data>...</data></tool_result>` tags before handing it back to the model, and prepends a system message explaining the convention: anything inside `<data>` is information, never instructions. This applies uniformly to `runAgent` callers — the conversational handler in agent-sidecar, the curator skill runner, and per-org runners in cloud.

  The risk it closes: an attacker plants instructions ("ignore previous", "send the system prompt", "exfiltrate to attacker@…") inside a knowledge-base document, a CRM contact field, an inbound email body, or a curator-extracted activity note. The AI later fetches that text as grounding via `kb_search` / `crm_get_my_contact` / conversation history and could be steered into following the planted directive. The structural defenses already in place (RLS, audience-scoped tokens, human-approval on outbound actions) make this hard to weaponize, but the wrapping makes it harder still — and is essentially free at the LLM level (modern Claude respects the boundary well).

  No behaviour change for the happy path. 68/68 tests pass.

## 0.23.2

## 0.23.1

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

## 0.22.0

## 0.21.0

### Minor Changes

- 914477f: Staff messages now atomically take over the conversation.

  **Backend** — `ConvService.sendMessage` auto-acquires a `ConversationClaim` whenever a non-internal user-authored message lands. Existing claims by the same user are refreshed; claims held by _other_ users no-op rather than throwing — the staff member already replying is implicitly the holder. The handover guard previously rejected any write where `actor.type === 'end_user_agent' || authorType === 'agent'`; that was too broad and blocked the chat-widget surface (which posts as `end_user_agent` on behalf of the end-user). The check is now strictly `authorType === 'agent'`, which is the only write type the claim guard exists to gate.

  **Agent runtime** — `shouldRespond` previously deferred whenever any prior `user`-authored message existed in the transcript. That was a coarse stand-in for "is a human handling this?" and it stayed sticky forever. The check now reads the conversation's `claim`: if `claim.holderType === 'user'`, defer until the holder releases (claims have a TTL, so this self-heals).

  The combined effect: a human reply takes the conversation, the AI silently steps back, and a "Release" action (or claim TTL expiry) hands it back. End-user follow-ups during the held window still go through, but the AI no longer races the human on the reply.

  `ConversationDetail` (returned by `MuninRestClient.getConversation`) gains a `claim: { holderType, holderId, expiresAt } | null` field so any agent-runtime consumer can read the same signal.

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
