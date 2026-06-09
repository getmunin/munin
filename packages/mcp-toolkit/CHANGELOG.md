# @getmunin/mcp-toolkit

## 4.43.2

### Patch Changes

- @getmunin/core@4.43.2
- @getmunin/types@4.43.2

## 4.43.1

### Patch Changes

- @getmunin/core@4.43.1
- @getmunin/types@4.43.1

## 4.43.0

### Patch Changes

- Updated dependencies [3858d3e]
  - @getmunin/types@4.43.0
  - @getmunin/core@4.43.0

## 4.42.0

### Patch Changes

- @getmunin/core@4.42.0
- @getmunin/types@4.42.0

## 4.41.1

### Patch Changes

- @getmunin/core@4.41.1
- @getmunin/types@4.41.1

## 4.41.0

### Patch Changes

- @getmunin/core@4.41.0
- @getmunin/types@4.41.0

## 4.40.4

### Patch Changes

- @getmunin/core@4.40.4
- @getmunin/types@4.40.4

## 4.40.3

### Patch Changes

- @getmunin/core@4.40.3
- @getmunin/types@4.40.3

## 4.40.2

### Patch Changes

- @getmunin/core@4.40.2
- @getmunin/types@4.40.2

## 4.40.1

### Patch Changes

- @getmunin/core@4.40.1
- @getmunin/types@4.40.1

## 4.40.0

### Minor Changes

- 8e4dee8: `tools/list` now intersects the caller's scopes with each tool's required `scopes`, in addition to the existing audience filter. Previously the list returned every audience-matched tool regardless of whether the caller actually held the scopes needed to invoke it — so a connector advertising `analytics:read` would happily list `analytics_*` tools to an OAuth caller whose token didn't carry that scope, and the model would only discover the mismatch by wasting a turn on a `"Missing required scope: ..."` error.

  After this change, `listTools` (and therefore the MCP `tools/list` response) only returns tools where every scope in `tool.meta.scopes` is held by the actor — including the existing `*` wildcard short-circuit, so internal `buildAdminAgentActor` callers are unaffected. Tools with `scopes: []` (like the feedback module) remain visible to everyone in the audience.

  `callTool` is unchanged — defense-in-depth scope check at dispatch time still fires if a caller invokes a hidden tool by name.

### Patch Changes

- @getmunin/core@4.40.0
- @getmunin/types@4.40.0

## 4.39.0

### Patch Changes

- @getmunin/core@4.39.0
- @getmunin/types@4.39.0

## 4.38.0

### Minor Changes

- 0110a7e: MCP dispatch now records redacted `args` on every audit row — including the `denied`, `invalid_input`, `rate_limited`, and thrown-handler paths that previously dropped the args. The success path is unchanged. The `invalid_input` row also now carries the Zod error message in its `error` column instead of just the literal string `"invalid_input"`. Caller-controlled args on `unknown_tool` are still dropped (no schema available to redact against).

  A new optional `captureException` hook on `createMcpServer` / `openInProcessMcpClient` receives any error thrown by a tool handler, along with the tool name, actor identity (type / id / orgId), and redacted args. `mcp-toolkit` remains observability-vendor agnostic.

  `@getmunin/backend-core` exposes the wiring: a new `ErrorReporterModule` registers a `NoopErrorReporter` against the `ERROR_REPORTER` injection token. `McpController` injects it and forwards thrown handler errors. Hosts that want Sentry (or any other reporter) replace the provider for `ERROR_REPORTER` with their own `ErrorReporter` subclass — `apps/backend` does this with a `SentryErrorReporter` that uses `Sentry.withScope` to attach the tool / actor / args context.

  The `cms_upload_asset_from_url` / `cms_upload_asset_from_file` error path now walks the `Error.cause` chain when an outbound fetch fails, so the surfaced message includes the underlying error code (e.g. `ENOTFOUND`, `ECONNRESET`, `CERT_HAS_EXPIRED`) instead of undici's opaque `"fetch failed"`. The unwrapping helper lives in `@getmunin/core` as `describeError(err, maxDepth?)` so other callers of `safeFetch` (and anywhere else cause-chain visibility matters) can reuse it.

  `describeError` also replaces three sites that previously surfaced only `err.message`: the webhook delivery worker (`webhook_deliveries.error` — visible to customers via `webhooks_list_deliveries`), `@getmunin/agent-host`'s models fetcher, and `@getmunin/agent-runtime`'s web crawler. Each of those had its own local `describe(err)` helper that did the inferior version.

### Patch Changes

- Updated dependencies [0110a7e]
  - @getmunin/core@4.38.0
  - @getmunin/types@4.38.0

## 4.37.0

### Minor Changes

- bb39ece: Replace `cms_upload_asset_bytes` with `cms_upload_asset_from_file`, a ChatGPT-native upload path.

  The base64-bytes tool didn't work for any realistic image from ChatGPT workspace agents — JSON-encoded base64 blew past the tool-call token budget around 2–3 MB. The new tool declares `_meta["openai/fileParams"]: ["file"]` so ChatGPT hands the server a short-lived signed download URL for a file already in the conversation; the backend fetches it through the existing `safeFetch` + SSRF + 50 MB cap path. Accepts `image/*`, `video/*`, `audio/*`, and `application/pdf`; SVG rejected.

  The `uploadAssetBytes` service method is kept (the dashboard's `/v1/cms/drafts/:id/assets` REST endpoint still uses it); only the MCP tool was removed.

  Also: `@McpTool` now accepts an optional `_meta` bag that flows through to `tools/list` entries, so any module can attach OpenAI Apps-SDK metadata (or future MCP extensions) without changing the toolkit.

### Patch Changes

- @getmunin/core@4.37.0
- @getmunin/types@4.37.0

## 4.36.0

### Patch Changes

- @getmunin/core@4.36.0
- @getmunin/types@4.36.0

## 4.35.0

### Patch Changes

- Updated dependencies [73320e2]
  - @getmunin/core@4.35.0
  - @getmunin/types@4.35.0

## 4.34.0

### Patch Changes

- Updated dependencies [290472e]
  - @getmunin/core@4.34.0
  - @getmunin/types@4.34.0

## 4.33.0

### Patch Changes

- Updated dependencies [9042f0e]
  - @getmunin/core@4.33.0
  - @getmunin/types@4.33.0

## 4.32.0

### Patch Changes

- Updated dependencies [f6cb178]
- Updated dependencies [211f215]
- Updated dependencies [03d62af]
  - @getmunin/core@4.32.0
  - @getmunin/types@4.32.0

## 4.31.0

### Patch Changes

- @getmunin/core@4.31.0
- @getmunin/types@4.31.0

## 4.30.0

### Patch Changes

- @getmunin/core@4.30.0
- @getmunin/types@4.30.0

## 4.29.2

### Patch Changes

- @getmunin/core@4.29.2
- @getmunin/types@4.29.2

## 4.29.1

### Patch Changes

- Updated dependencies [84b988d]
  - @getmunin/core@4.29.1
  - @getmunin/types@4.29.1

## 4.29.0

### Patch Changes

- @getmunin/core@4.29.0
- @getmunin/types@4.29.0

## 4.28.0

### Patch Changes

- Updated dependencies [7436b8c]
- Updated dependencies [025b064]
  - @getmunin/core@4.28.0
  - @getmunin/types@4.28.0

## 4.27.1

### Patch Changes

- @getmunin/core@4.27.1
- @getmunin/types@4.27.1

## 4.27.0

### Patch Changes

- Updated dependencies [97bfdb8]
- Updated dependencies [2605e0f]
- Updated dependencies [24905e6]
  - @getmunin/core@4.27.0
  - @getmunin/types@4.27.0

## 4.26.0

### Patch Changes

- @getmunin/core@4.26.0
- @getmunin/types@4.26.0

## 4.25.0

### Patch Changes

- @getmunin/core@4.25.0
- @getmunin/types@4.25.0

## 4.24.3

### Patch Changes

- @getmunin/core@4.24.3
- @getmunin/types@4.24.3

## 4.24.2

### Patch Changes

- @getmunin/core@4.24.2
- @getmunin/types@4.24.2

## 4.24.1

### Patch Changes

- @getmunin/core@4.24.1
- @getmunin/types@4.24.1

## 4.24.0

### Patch Changes

- Updated dependencies [ef55e18]
  - @getmunin/core@4.24.0
  - @getmunin/types@4.24.0

## 4.23.5

### Patch Changes

- @getmunin/core@4.23.5
- @getmunin/types@4.23.5

## 4.23.4

### Patch Changes

- Updated dependencies [6dfabd2]
  - @getmunin/core@4.23.4
  - @getmunin/types@4.23.4

## 4.23.3

### Patch Changes

- Updated dependencies [57d7901]
  - @getmunin/core@4.23.3
  - @getmunin/types@4.23.3

## 4.23.2

### Patch Changes

- Updated dependencies [f0e5389]
  - @getmunin/core@4.23.2
  - @getmunin/types@4.23.2

## 4.23.1

### Patch Changes

- @getmunin/core@4.23.1
- @getmunin/types@4.23.1

## 4.23.0

### Patch Changes

- @getmunin/core@4.23.0
- @getmunin/types@4.23.0

## 4.22.0

### Patch Changes

- @getmunin/core@4.22.0
- @getmunin/types@4.22.0

## 4.21.0

### Patch Changes

- @getmunin/core@4.21.0
- @getmunin/types@4.21.0

## 4.20.0

### Patch Changes

- @getmunin/core@4.20.0
- @getmunin/types@4.20.0

## 4.19.4

### Patch Changes

- 623dd4d: Fix the in-process end-user agent actor having no scopes, which silently disabled every self-service-audience tool that requires a write scope (handover, phone-call request, my-contact update, log-activity-self).
  - `agent-host`'s `openMcp` factory now passes a default scope set to `openEndUserAgentMcpClient` covering the full self-service surface: `conv:read`, `conv:write`, `kb:read`, `crm:read`, `crm:write`. Previously the actor was built with `[]`, so the MCP dispatcher rejected every gated tool call with a structured `errorResult('Missing required scope: …')` — silently, because tool errors do not throw — and the LLM's call was a no-op.
  - `agent-runtime`'s HTTP `mintDelegatedToken` default now includes `crm:write` for parity, so delegated end-user tokens minted by the runtime can call the same self-service surface.
  - Adds a regression test asserting a self-service actor with broad scopes is still blocked from admin-audience tools — the audience gate runs before the scope check, so granting an end-user agent `conv:write` does _not_ unlock admin conv tools.
  - @getmunin/core@4.19.4
  - @getmunin/types@4.19.4

## 4.19.3

### Patch Changes

- @getmunin/core@4.19.3
- @getmunin/types@4.19.3

## 4.19.2

### Patch Changes

- @getmunin/core@4.19.2
- @getmunin/types@4.19.2

## 4.19.1

### Patch Changes

- @getmunin/core@4.19.1
- @getmunin/types@4.19.1

## 4.19.0

### Patch Changes

- @getmunin/core@4.19.0
- @getmunin/types@4.19.0

## 4.18.0

### Patch Changes

- @getmunin/core@4.18.0
- @getmunin/types@4.18.0

## 4.17.0

### Patch Changes

- @getmunin/core@4.17.0
- @getmunin/types@4.17.0

## 4.16.0

### Patch Changes

- @getmunin/core@4.16.0
- @getmunin/types@4.16.0

## 4.15.0

### Patch Changes

- Updated dependencies [d8ed4f6]
  - @getmunin/core@4.15.0
  - @getmunin/types@4.15.0

## 4.14.0

### Patch Changes

- Updated dependencies [1fe1031]
  - @getmunin/core@4.14.0
  - @getmunin/types@4.14.0

## 4.13.0

### Patch Changes

- Updated dependencies [7977f92]
  - @getmunin/core@4.13.0
  - @getmunin/types@4.13.0

## 4.12.0

### Patch Changes

- @getmunin/core@4.12.0
- @getmunin/types@4.12.0

## 4.11.0

### Patch Changes

- @getmunin/core@4.11.0
- @getmunin/types@4.11.0

## 4.10.0

### Patch Changes

- @getmunin/core@4.10.0
- @getmunin/types@4.10.0

## 4.9.0

### Patch Changes

- Updated dependencies [8c1c3c9]
- Updated dependencies [2ca3b4a]
- Updated dependencies [f9a8e0f]
  - @getmunin/core@4.9.0
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

- Updated dependencies [0a0e2a1]
  - @getmunin/core@4.8.0
  - @getmunin/types@4.8.0

## 4.7.1

### Patch Changes

- @getmunin/core@4.7.1
- @getmunin/types@4.7.1

## 4.7.0

### Patch Changes

- Updated dependencies [5108510]
  - @getmunin/core@4.7.0
  - @getmunin/types@4.7.0

## 4.6.1

### Patch Changes

- @getmunin/core@4.6.1
- @getmunin/types@4.6.1

## 4.6.0

### Patch Changes

- @getmunin/core@4.6.0
- @getmunin/types@4.6.0

## 4.5.1

### Patch Changes

- @getmunin/core@4.5.1
- @getmunin/types@4.5.1

## 4.5.0

### Patch Changes

- @getmunin/core@4.5.0
- @getmunin/types@4.5.0

## 4.4.1

### Patch Changes

- @getmunin/core@4.4.1
- @getmunin/types@4.4.1

## 4.4.0

### Patch Changes

- @getmunin/core@4.4.0
- @getmunin/types@4.4.0

## 4.3.0

### Patch Changes

- @getmunin/core@4.3.0
- @getmunin/types@4.3.0

## 4.2.0

### Patch Changes

- @getmunin/core@4.2.0
- @getmunin/types@4.2.0

## 4.1.1

### Patch Changes

- @getmunin/core@4.1.1
- @getmunin/types@4.1.1

## 4.1.0

### Patch Changes

- Updated dependencies [de1a7a6]
  - @getmunin/core@4.1.0
  - @getmunin/types@4.1.0

## 4.0.0

### Patch Changes

- @getmunin/core@4.0.0
- @getmunin/types@4.0.0

## 3.9.1

### Patch Changes

- @getmunin/core@3.9.1
- @getmunin/types@3.9.1

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
  - @getmunin/types@3.9.0

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
  - @getmunin/types@3.7.0

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
  - @getmunin/types@3.6.0

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
  - @getmunin/types@3.5.0

## 3.4.1

### Patch Changes

- @getmunin/core@3.4.1
- @getmunin/types@3.4.1

## 3.4.0

### Patch Changes

- @getmunin/core@3.4.0
- @getmunin/types@3.4.0

## 3.2.1

### Patch Changes

- c5e93e1: Add a `development` package-export condition pointing at `./src/index.ts` (and `./src/schema.ts` for `@getmunin/db`). Loaders that resolve with `--conditions=development` (e.g. the OSS backend's new `node --import @swc-node/register/esm-register --watch --conditions=development src/main.ts` dev script) see the TypeScript source directly; the existing `types` → `dist/*.d.ts` and `default` → `dist/*.js` resolution paths are unchanged, so production runtime, typecheck, and downstream consumers that don't opt into the condition keep their current behavior.
- Updated dependencies [c5e93e1]
  - @getmunin/core@3.2.1
  - @getmunin/types@3.2.1

## 3.2.0

### Patch Changes

- @getmunin/core@3.2.0
- @getmunin/types@3.2.0

## 3.1.0

### Patch Changes

- @getmunin/core@3.1.0
- @getmunin/types@3.1.0

## 3.0.0

### Patch Changes

- Updated dependencies [e5a5450]
  - @getmunin/core@3.0.0
  - @getmunin/types@3.0.0

## 2.5.1

### Patch Changes

- @getmunin/core@2.5.1
- @getmunin/types@2.5.1

## 2.5.0

### Patch Changes

- @getmunin/core@2.5.0
- @getmunin/types@2.5.0

## 2.4.0

### Patch Changes

- Updated dependencies [009846d]
  - @getmunin/core@2.4.0
  - @getmunin/types@2.4.0

## 2.3.0

### Patch Changes

- Updated dependencies [d07dc99]
  - @getmunin/core@2.3.0
  - @getmunin/types@2.3.0

## 2.2.0

### Patch Changes

- @getmunin/core@2.2.0
- @getmunin/types@2.2.0

## 2.1.0

### Patch Changes

- @getmunin/core@2.1.0
- @getmunin/types@2.1.0

## 2.0.0

### Patch Changes

- @getmunin/core@2.0.0
- @getmunin/types@2.0.0

## 1.0.0

### Patch Changes

- @getmunin/core@1.0.0
- @getmunin/types@1.0.0

## 0.25.0

### Patch Changes

- @getmunin/core@0.25.0
- @getmunin/types@0.25.0

## 0.24.1

### Patch Changes

- @getmunin/core@0.24.1
- @getmunin/types@0.24.1

## 0.24.0

### Patch Changes

- @getmunin/core@0.24.0
- @getmunin/types@0.24.0

## 0.23.3

### Patch Changes

- @getmunin/core@0.23.3
- @getmunin/types@0.23.3

## 0.23.2

### Patch Changes

- @getmunin/core@0.23.2
- @getmunin/types@0.23.2

## 0.23.1

### Patch Changes

- @getmunin/core@0.23.1
- @getmunin/types@0.23.1

## 0.23.0

### Patch Changes

- @getmunin/core@0.23.0
- @getmunin/types@0.23.0

## 0.22.0

### Patch Changes

- Updated dependencies [355856a]
  - @getmunin/core@0.22.0
  - @getmunin/types@0.22.0

## 0.21.0

### Patch Changes

- @getmunin/core@0.21.0
- @getmunin/types@0.21.0

## 0.20.0

### Patch Changes

- @getmunin/core@0.20.0
- @getmunin/types@0.20.0

## 0.19.0

### Patch Changes

- @getmunin/core@0.19.0
- @getmunin/types@0.19.0

## 0.18.0

### Patch Changes

- @getmunin/core@0.18.0
- @getmunin/types@0.18.0

## 0.17.0

### Patch Changes

- Updated dependencies [db26079]
  - @getmunin/core@0.17.0
  - @getmunin/types@0.17.0

## 0.16.1

### Patch Changes

- @getmunin/core@0.16.1
- @getmunin/types@0.16.1

## 0.16.0

### Patch Changes

- @getmunin/core@0.16.0
- @getmunin/types@0.16.0

## 0.15.0

### Patch Changes

- @getmunin/core@0.15.0
- @getmunin/types@0.15.0

## 0.14.0

### Patch Changes

- @getmunin/core@0.14.0
- @getmunin/types@0.14.0

## 0.13.0

### Patch Changes

- @getmunin/core@0.13.0
- @getmunin/types@0.13.0

## 0.12.0

### Patch Changes

- @getmunin/core@0.12.0
- @getmunin/types@0.12.0

## 0.11.0

### Patch Changes

- @getmunin/core@0.11.0
- @getmunin/types@0.11.0

## 0.10.0

### Patch Changes

- @getmunin/core@0.10.0
- @getmunin/types@0.10.0

## 0.9.1

### Patch Changes

- @getmunin/core@0.9.1
- @getmunin/types@0.9.1

## Unreleased

### Major Changes

- **BREAKING:** Rename `RunbookRegistry` → `SkillRegistry` and `RegisteredRunbook` → `RegisteredSkill`. The `createMcpServer` option `runbooks` is renamed to `skills`. No backwards-compat exports — consumers must update import names and option keys.

## 0.9.0

### Patch Changes

- @getmunin/core@0.9.0
- @getmunin/types@0.9.0

## 0.8.0

### Minor Changes

- 26d3007: Add public REST endpoint `/api/public/runbooks` (list) + `/api/public/runbooks/:module/:slug` (read) so a marketing site can render runbooks server-side. Honors a `public: true|false` field in runbook frontmatter (default true). The same audience-filtered MCP `resources/list` + `resources/read` paths are unchanged. Also fixes runbook URI derivation so files inside `<module>/runbooks/*.md` produce `runbook://<module>/<slug>` (not `runbook://runbooks/<slug>`).

### Patch Changes

- @getmunin/core@0.8.0
- @getmunin/types@0.8.0

## 0.7.0

### Minor Changes

- 93c385a: Publish runbooks to connecting MCP agents via the spec's standard primitives.
  - `@getmunin/mcp-toolkit` adds `RunbookRegistry` (parallel to `McpToolRegistry`) and extends `createMcpServer` with optional `runbooks` and `instructions` fields. When runbooks are provided the server declares the `resources` capability and registers `resources/list` + `resources/read` handlers, audience-filtered the same way tools are.
  - `@getmunin/backend-core` ships a markdown runbook loader that scans `src/modules/**/runbooks/*.md` at boot, parses YAML frontmatter, and registers each into a `RunbookRegistry`. The MCP controller passes the registry plus an auto-generated `instructions` string into every per-request server.
  - Five starter runbooks: email-channel-setup, widget-onboarding, handoff-from-ai-agent, customer-onboarding, kb/import-from-google-docs.
  - Build step copies `*.md` from `src` to `dist` so runbooks ship inside the published tarball.

  Result: agents connecting to `/mcp` get a short orientation in their `initialize` response (`instructions` field) and can discover detailed workflow guides via `resources/list`.

### Patch Changes

- @getmunin/core@0.7.0
- @getmunin/types@0.7.0

## 0.6.0

### Patch Changes

- @getmunin/core@0.6.0
- @getmunin/types@0.6.0

## 0.5.0

### Patch Changes

- Updated dependencies [6506b10]
  - @getmunin/core@0.5.0
  - @getmunin/types@0.5.0

## 0.4.0

### Patch Changes

- @getmunin/core@0.4.0
- @getmunin/types@0.4.0

## 0.3.1

### Patch Changes

- fe8fd21: TenancyInterceptor: bypass RLS for `actor.type === 'partner'`.

  Partner actors (in a downstream package) operate across multiple orgs they
  provisioned. Their controllers filter manually by `partner_id`. OSS
  never produces `'partner'` actors, so this branch is dead code there.

- Updated dependencies [fe8fd21]
  - @getmunin/core@0.3.1
  - @getmunin/types@0.3.1

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
  - @getmunin/types@0.3.0

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
  - @getmunin/types@0.2.0
