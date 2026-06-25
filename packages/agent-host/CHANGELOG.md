# @getmunin/agent-host

## 4.59.0

### Patch Changes

- Updated dependencies [2e3b87a]
- Updated dependencies [0fb358d]
  - @getmunin/types@4.59.0
  - @getmunin/db@4.59.0
  - @getmunin/backend-core@4.59.0
  - @getmunin/core@4.59.0
  - @getmunin/agent-runtime@4.59.0

## 4.58.0

### Patch Changes

- 3d91858: Reduce curator token usage: tighter per-skill tool allowlists and a lower iteration cap.

  - **Tighter tool allowlists.** `TOOL_PREFIXES_BY_URI` in the job catalog gated each curator skill by broad module prefixes (`conv_`, `kb_`, `crm_`, `outreach_`), which loaded 10–30 tool schemas into the model context on every turn of the tool loop — re-sent on each iteration. Each scheduled/event-driven skill now allowlists only the exact tools its procedure actually calls (e.g. `set-topic-and-title` drops from all `conv_*` to 5 tools; `clean-contact-data` drops the unused `conv_` prefix entirely; `review-stale-entries` drops every mutating `cms_*` tool, enforcing its propose-only invariant at the runtime layer). Behavior is unchanged — the dropped tools were either operator-review-loop tools or ones the skills never call.
  - **Lower iteration cap.** Curator skill passes now stop after `CURATOR_MAX_TOOL_ITERATIONS` (16) tool-loop iterations instead of 24. Since the full prompt prefix is re-sent on every iteration, this clips the worst-case per-job token spend; batch sweeps that don't finish in one pass resume on the next scheduled run (dedupe keeps them idempotent).

- Updated dependencies [cd6b338]
- Updated dependencies [3d91858]
  - @getmunin/backend-core@4.58.0
  - @getmunin/types@4.58.0
  - @getmunin/core@4.58.0
  - @getmunin/db@4.58.0
  - @getmunin/agent-runtime@4.58.0

## 4.57.1

### Patch Changes

- Updated dependencies [f23f7e3]
  - @getmunin/agent-runtime@4.57.1
  - @getmunin/core@4.57.1
  - @getmunin/backend-core@4.57.1
  - @getmunin/db@4.57.1
  - @getmunin/types@4.57.1

## 4.57.0

### Patch Changes

- Updated dependencies [3ce6c5d]
- Updated dependencies [4c3a9f7]
  - @getmunin/backend-core@4.57.0
  - @getmunin/agent-runtime@4.57.0
  - @getmunin/core@4.57.0
  - @getmunin/db@4.57.0
  - @getmunin/types@4.57.0

## 4.56.1

### Patch Changes

- @getmunin/core@4.56.1
- @getmunin/db@4.56.1
- @getmunin/types@4.56.1
- @getmunin/backend-core@4.56.1
- @getmunin/agent-runtime@4.56.1

## 4.56.0

### Minor Changes

- 2d69094: Recover chat replies when the in-memory NOTIFY misses a live runner. A widget/chat reply was driven purely by an in-process `conversation.message.received` event reaching a subscribed runner; if no runner was resident when the NOTIFY fired (cold start, restart, scale-to-zero, dropped listener), the reply was silently lost because nothing durable recorded that one was owed.

  The runner now also drives replies from a durable recovery set: `GET /v1/conversations/awaiting-reply` returns open, auto-mode, unassigned, non-voice conversations whose latest non-internal message is from the visitor. The agent host sweeps this on every (re)spawn — the same on-boot drain that lets the curator queue survive scale-to-zero — and on each reconcile tick, re-driving anything that slipped through. Already-answered and staff-handled threads are excluded, and the existing `shouldRespond` + conversation-claim + `sinceMessageId` guards keep a redundant trigger a no-op, so no duplicate replies.

### Patch Changes

- Updated dependencies [2d69094]
- Updated dependencies [373d29e]
  - @getmunin/agent-runtime@4.56.0
  - @getmunin/backend-core@4.56.0
  - @getmunin/core@4.56.0
  - @getmunin/db@4.56.0
  - @getmunin/types@4.56.0

## 4.55.0

### Minor Changes

- e64b320: The setup/onboarding gate now treats an org as configured when the agent has a usable provider — not only when an org-level API key is set. `/v1/agent-config` exposes `providerConfigured` (`providerApiKeySet` OR a host-supplied `defaultProviderAvailable`), and `AgentHostModule.forRoot`/`forRootAsync` accept a `defaultProviderAvailable` flag. Hosts that supply a default provider can let key-less orgs finish onboarding and reach the dashboard; self-hosted setups (no flag) are unchanged.

### Patch Changes

- @getmunin/core@4.55.0
- @getmunin/db@4.55.0
- @getmunin/types@4.55.0
- @getmunin/backend-core@4.55.0
- @getmunin/agent-runtime@4.55.0

## 4.54.0

### Minor Changes

- dfbfb8c: Add `AgentHostModule.forRootAsync({ configRepository, imports, inject, useFactory })` so `runnerOptions` (provider factory, credential resolver, pre-generate gate) can be built from a DI factory with injected services, instead of only a static value.
- 0d4dd00: Record AI token usage for the agent's own configured LLM provider. The runner now meters token consumption on its default provider path — covering live chat, scheduled curator work, and website imports — so the monthly AI-tokens figure on the usage and overview pages reflects real usage instead of staying at zero.

### Patch Changes

- c74bcc3: Fix a polynomial-time ReDoS in provider credential validation: the trailing-slash trim on the user-supplied provider base URL used a backtracking regex (`/\/+$/`) on attacker-controllable input. Replace it with a linear scan.
  - @getmunin/core@4.54.0
  - @getmunin/db@4.54.0
  - @getmunin/types@4.54.0
  - @getmunin/backend-core@4.54.0
  - @getmunin/agent-runtime@4.54.0

## 4.53.0

### Minor Changes

- c3a62e1: Add host extensibility hooks for the agent runner and provider configuration:
  - Rate-limit counters can be incremented by an arbitrary amount (`record(bucket, amount)`); add monthly `ai_tokens` and per-minute `ai_generates` buckets.
  - The usage summary (`/v1/usage/summary`) reports monthly AI token usage, surfaced as a tile on the usage and overview pages.
  - Agent passes can report a `quota_exceeded` skip outcome.
  - The agent host accepts an optional provider factory, credential resolver, and pre-generate gate via `runnerOptions`. The gate is consulted for both live chat and scheduled background work (distinguished by a `trigger` argument), so a host can supply its own provider implementation and meter or limit usage per org without forking the runner.
  - The provider picker accepts host-supplied presets — including a credential-less "managed" preset that renders host content and clears the org key on selection — plus a default selection. The AI settings and usage pages accept an optional content slot.

- 82fef68: Redesign the onboarding "Lift-off" summary's website-import section into three real states — importing, failed, and succeeded — driven by live crawl progress.

  The web crawler now emits incremental progress (`{ total, done, recentPaths }`) as it reads pages; the runner persists it to a new nullable `curator_jobs.progress` column (throttled, best-effort), and the curator-job DTO surfaces it via `GET /v1/curator/jobs/:id`. The summary screen polls that to show a live `done / total` counter, a progress bar, and the paths being read while importing; the imported page count and duration on success; and the failure reason plus an inline **Retry import** on failure. A new internal `POST /v1/curator/jobs/:id/progress` endpoint backs the out-of-process runner path.

  Also align the full-screen loading screens with the page background: `AuthLoading` (and the root route loader) now paint `bg-bone` so the loader no longer flashes the lighter paper surface before the bone-backed page resolves.

### Patch Changes

- c8a2026: Actually verify AI provider credentials on save. Previously the "Save & test" step only failed on an explicit 401/403, so a bogus custom endpoint or a 200/404/HTML response was accepted silently. Validation now requires a 2xx response and an OpenAI-compatible body shape (`data: []` for `/models`, `data: {}` for OpenRouter's `/auth/key`); non-2xx, unreachable, non-JSON, and wrong-shape responses are rejected with a descriptive error.
- c3a62e1: Website import no longer fails the whole job when company-profile generation hits an LLM provider error (e.g. invalid credentials). The crawled pages are imported regardless — the optional profile step is skipped, a warning is logged, and the job completes successfully.
- Updated dependencies [c3a62e1]
- Updated dependencies [95f2983]
- Updated dependencies [82fef68]
  - @getmunin/backend-core@4.53.0
  - @getmunin/agent-runtime@4.53.0
  - @getmunin/types@4.53.0
  - @getmunin/db@4.53.0
  - @getmunin/core@4.53.0

## 4.52.1

### Patch Changes

- @getmunin/core@4.52.1
- @getmunin/db@4.52.1
- @getmunin/types@4.52.1
- @getmunin/backend-core@4.52.1
- @getmunin/agent-runtime@4.52.1

## 4.52.0

### Patch Changes

- Updated dependencies [72869c4]
- Updated dependencies [e0a87c0]
  - @getmunin/backend-core@4.52.0
  - @getmunin/core@4.52.0
  - @getmunin/agent-runtime@4.52.0
  - @getmunin/db@4.52.0
  - @getmunin/types@4.52.0

## 4.51.4

### Patch Changes

- @getmunin/core@4.51.4
- @getmunin/db@4.51.4
- @getmunin/types@4.51.4
- @getmunin/backend-core@4.51.4
- @getmunin/agent-runtime@4.51.4

## 4.51.3

### Patch Changes

- Updated dependencies [5018e2b]
- Updated dependencies [139d00e]
- Updated dependencies [0cc9260]
  - @getmunin/core@4.51.3
  - @getmunin/backend-core@4.51.3
  - @getmunin/types@4.51.3
  - @getmunin/agent-runtime@4.51.3
  - @getmunin/db@4.51.3

## 4.51.2

### Patch Changes

- Updated dependencies [657b2bf]
  - @getmunin/backend-core@4.51.2
  - @getmunin/core@4.51.2
  - @getmunin/db@4.51.2
  - @getmunin/types@4.51.2
  - @getmunin/agent-runtime@4.51.2

## 4.51.1

### Patch Changes

- @getmunin/core@4.51.1
- @getmunin/db@4.51.1
- @getmunin/types@4.51.1
- @getmunin/backend-core@4.51.1
- @getmunin/agent-runtime@4.51.1

## 4.51.0

### Minor Changes

- 7ea516e: Website import now reaches client-rendered sites, prunes deleted pages, and titles pages correctly.
  - The crawler follows client-side root redirects (`<meta http-equiv="refresh">` / `<link rel="canonical">`), so importing a bare domain that bounces to a locale path (e.g. `/` → `/en/`) discovers the real page tree instead of stalling on an empty shell.
  - Title extraction prefers the first `<h1>` over a shared static `<title>`, so SPA routes no longer collapse to one repeated title.
  - `kb_import_website` reconciles by default: after a healthy crawl, previously imported pages that are individually re-checked and confirmed gone (HTTP 404/410) are deleted from the knowledge base. Pass `reconcile: false` to import additively. Each imported document records its origin as a `source-url:<url>` tag for precise revalidation.
  - `kb_list_documents` now returns each document's `slug`.

### Patch Changes

- Updated dependencies [7ea516e]
  - @getmunin/agent-runtime@4.51.0
  - @getmunin/backend-core@4.51.0
  - @getmunin/core@4.51.0
  - @getmunin/db@4.51.0
  - @getmunin/types@4.51.0

## 4.50.1

### Patch Changes

- Updated dependencies [d612e6a]
  - @getmunin/core@4.50.1
  - @getmunin/backend-core@4.50.1
  - @getmunin/agent-runtime@4.50.1
  - @getmunin/db@4.50.1
  - @getmunin/types@4.50.1

## 4.50.0

### Minor Changes

- 3dafe87: Add the `kb_import_website` MCP tool so admin agents can initiate a knowledge-base website scrape directly over `/mcp`. Previously the `task://web/scrape-website` job could only be enqueued via the `/v1/curator/jobs` control-plane endpoint (driven from the dashboard's website-import card). The new tool wraps that enqueue: it takes a homepage URL (bare domains accepted), validates it is publicly reachable, and returns the curator job id. Re-importing a URL with a scrape still pending returns the in-flight job instead of starting a second one. A companion `kb_import_website_status` tool lets the agent poll that job id for progress (pending / done / failed) and the imported-document summary.

  The company-profile synthesis is now optional. The web-import handler reads a `synthesizeCompanyProfile` flag from the job's `sourceEventPayload` (defaulting to `true` when absent, so the dashboard onboarding flow is unchanged), and `kb_import_website` exposes it as a parameter. Set `synthesizeCompanyProfile: false` when importing third-party or topic pages so the import doesn't overwrite the company-profile document (slug `company-profile`) — which seeds the chat widget — with unrelated content.

### Patch Changes

- Updated dependencies [3dafe87]
- Updated dependencies [3f034de]
  - @getmunin/backend-core@4.50.0
  - @getmunin/types@4.50.0
  - @getmunin/core@4.50.0
  - @getmunin/db@4.50.0
  - @getmunin/agent-runtime@4.50.0

## 4.49.0

### Patch Changes

- Updated dependencies [2b8fd7d]
- Updated dependencies [38f4775]
- Updated dependencies [f13f5c5]
  - @getmunin/backend-core@4.49.0
  - @getmunin/core@4.49.0
  - @getmunin/agent-runtime@4.49.0
  - @getmunin/db@4.49.0
  - @getmunin/types@4.49.0

## 4.48.0

### Patch Changes

- Updated dependencies [dc70c67]
  - @getmunin/backend-core@4.48.0
  - @getmunin/types@4.48.0
  - @getmunin/core@4.48.0
  - @getmunin/db@4.48.0
  - @getmunin/agent-runtime@4.48.0

## 4.47.0

### Patch Changes

- Updated dependencies [4b889cf]
- Updated dependencies [448953f]
  - @getmunin/backend-core@4.47.0
  - @getmunin/agent-runtime@4.47.0
  - @getmunin/core@4.47.0
  - @getmunin/db@4.47.0
  - @getmunin/types@4.47.0

## 4.46.0

### Patch Changes

- Updated dependencies [bfb850e]
- Updated dependencies [1892d75]
  - @getmunin/backend-core@4.46.0
  - @getmunin/core@4.46.0
  - @getmunin/db@4.46.0
  - @getmunin/types@4.46.0
  - @getmunin/agent-runtime@4.46.0

## 4.45.1

### Patch Changes

- @getmunin/core@4.45.1
- @getmunin/db@4.45.1
- @getmunin/types@4.45.1
- @getmunin/backend-core@4.45.1
- @getmunin/agent-runtime@4.45.1

## 4.45.0

### Patch Changes

- Updated dependencies [c1b4b58]
  - @getmunin/backend-core@4.45.0
  - @getmunin/core@4.45.0
  - @getmunin/db@4.45.0
  - @getmunin/types@4.45.0
  - @getmunin/agent-runtime@4.45.0

## 4.44.1

### Patch Changes

- Updated dependencies [ea18794]
  - @getmunin/backend-core@4.44.1
  - @getmunin/core@4.44.1
  - @getmunin/db@4.44.1
  - @getmunin/types@4.44.1
  - @getmunin/agent-runtime@4.44.1

## 4.44.0

### Patch Changes

- Updated dependencies [10ae30e]
- Updated dependencies [10ae30e]
- Updated dependencies [70d50ed]
  - @getmunin/backend-core@4.44.0
  - @getmunin/core@4.44.0
  - @getmunin/db@4.44.0
  - @getmunin/types@4.44.0
  - @getmunin/agent-runtime@4.44.0

## 4.43.2

### Patch Changes

- @getmunin/core@4.43.2
- @getmunin/db@4.43.2
- @getmunin/types@4.43.2
- @getmunin/backend-core@4.43.2
- @getmunin/agent-runtime@4.43.2

## 4.43.1

### Patch Changes

- @getmunin/core@4.43.1
- @getmunin/db@4.43.1
- @getmunin/types@4.43.1
- @getmunin/backend-core@4.43.1
- @getmunin/agent-runtime@4.43.1

## 4.43.0

### Patch Changes

- de6865f: Fix the default OpenRouter provider base URL — was `https://openrouter.ai/v1`, should be `https://openrouter.ai/api/v1`.

  `PerOrgConfigRepository` materialized new `agent_config` rows with the wrong host, so hitting `/models` returned OpenRouter's marketing HTML page and `AgentModelsService` choked when parsing it. Same typo in the dashboard's `PROVIDER_PRESETS` and in two `shouldEnablePromptCache` test fixtures.

  Existing rows already persisted with the wrong URL are backfilled by an idempotent `UPDATE` inside `AGENT_HOST_MULTI_TENANT_DDL` (multi-tenant only — the OSS singleton DDL defaults to Anthropic).

- Updated dependencies [3858d3e]
- Updated dependencies [d3c5d6f]
  - @getmunin/db@4.43.0
  - @getmunin/backend-core@4.43.0
  - @getmunin/types@4.43.0
  - @getmunin/core@4.43.0
  - @getmunin/agent-runtime@4.43.0

## 4.42.0

### Patch Changes

- Updated dependencies [15d6ed4]
- Updated dependencies [205e1eb]
  - @getmunin/backend-core@4.42.0
  - @getmunin/db@4.42.0
  - @getmunin/core@4.42.0
  - @getmunin/agent-runtime@4.42.0
  - @getmunin/types@4.42.0

## 4.41.1

### Patch Changes

- Updated dependencies [360b7d4]
- Updated dependencies [e9ec27d]
  - @getmunin/backend-core@4.41.1
  - @getmunin/core@4.41.1
  - @getmunin/db@4.41.1
  - @getmunin/types@4.41.1
  - @getmunin/agent-runtime@4.41.1

## 4.41.0

### Patch Changes

- Updated dependencies [145dbd9]
  - @getmunin/backend-core@4.41.0
  - @getmunin/db@4.41.0
  - @getmunin/core@4.41.0
  - @getmunin/agent-runtime@4.41.0
  - @getmunin/types@4.41.0

## 4.40.4

### Patch Changes

- Updated dependencies [335d67f]
- Updated dependencies [ed2161a]
  - @getmunin/backend-core@4.40.4
  - @getmunin/core@4.40.4
  - @getmunin/db@4.40.4
  - @getmunin/types@4.40.4
  - @getmunin/agent-runtime@4.40.4

## 4.40.3

### Patch Changes

- Updated dependencies [1fe3019]
- Updated dependencies [1fe3019]
  - @getmunin/backend-core@4.40.3
  - @getmunin/core@4.40.3
  - @getmunin/db@4.40.3
  - @getmunin/types@4.40.3
  - @getmunin/agent-runtime@4.40.3

## 4.40.2

### Patch Changes

- @getmunin/core@4.40.2
- @getmunin/db@4.40.2
- @getmunin/types@4.40.2
- @getmunin/backend-core@4.40.2
- @getmunin/agent-runtime@4.40.2

## 4.40.1

### Patch Changes

- Updated dependencies [706d8c9]
- Updated dependencies [09c75ea]
  - @getmunin/agent-runtime@4.40.1
  - @getmunin/backend-core@4.40.1
  - @getmunin/db@4.40.1
  - @getmunin/core@4.40.1
  - @getmunin/types@4.40.1

## 4.40.0

### Patch Changes

- d7d1ce1: Add tenant-isolation RLS policies to `agent_config` and `agent_health` when they're built in **multi-tenant** mode (one row per org). Closes a defense-in-depth gap: in the multi-tenant variant, `id` references `orgs(id)` so each row holds an org's encrypted LLM provider API key, provider URL, and agent settings, but the table had no RLS policy. An app-DB query with the wrong `app.org_id` GUC could read another tenant's row (the encryption envelope still protects the key value itself, but everything else leaked).

  The new policy uses the same `tenant_isolation` template as the rest of the schema: `id = app_org_id()` with an `app_bypass_rls()` short-circuit. `app_org_id()` / `app_bypass_rls()` are the helpers installed by `@getmunin/db`'s `rls.sql`, which `runMigrations` always applies before the agent-host DDL runs in cloud.

  `AGENT_HOST_SINGLETON_DDL` and `AGENT_HEALTH_SINGLETON_DDL` (the OSS one-row variants) are **intentionally untouched** — RLS on a one-row, no-org-GUC table would just lock out the singleton fetch.

  DDL is idempotent (`ALTER TABLE … ENABLE`, `DROP POLICY IF EXISTS`, `CREATE POLICY`) so re-applying on every cloud boot is safe.

- Updated dependencies [547a97b]
- Updated dependencies [e166c78]
- Updated dependencies [8e4dee8]
- Updated dependencies [f8e82f2]
- Updated dependencies [67c91c3]
- Updated dependencies [014b431]
  - @getmunin/db@4.40.0
  - @getmunin/backend-core@4.40.0
  - @getmunin/core@4.40.0
  - @getmunin/agent-runtime@4.40.0
  - @getmunin/types@4.40.0

## 4.39.0

### Patch Changes

- Updated dependencies [1b757bc]
  - @getmunin/backend-core@4.39.0
  - @getmunin/core@4.39.0
  - @getmunin/db@4.39.0
  - @getmunin/types@4.39.0
  - @getmunin/agent-runtime@4.39.0

## 4.38.0

### Patch Changes

- 0110a7e: MCP dispatch now records redacted `args` on every audit row — including the `denied`, `invalid_input`, `rate_limited`, and thrown-handler paths that previously dropped the args. The success path is unchanged. The `invalid_input` row also now carries the Zod error message in its `error` column instead of just the literal string `"invalid_input"`. Caller-controlled args on `unknown_tool` are still dropped (no schema available to redact against).

  A new optional `captureException` hook on `createMcpServer` / `openInProcessMcpClient` receives any error thrown by a tool handler, along with the tool name, actor identity (type / id / orgId), and redacted args. `mcp-toolkit` remains observability-vendor agnostic.

  `@getmunin/backend-core` exposes the wiring: a new `ErrorReporterModule` registers a `NoopErrorReporter` against the `ERROR_REPORTER` injection token. `McpController` injects it and forwards thrown handler errors. Hosts that want Sentry (or any other reporter) replace the provider for `ERROR_REPORTER` with their own `ErrorReporter` subclass — `apps/backend` does this with a `SentryErrorReporter` that uses `Sentry.withScope` to attach the tool / actor / args context.

  The `cms_upload_asset_from_url` / `cms_upload_asset_from_file` error path now walks the `Error.cause` chain when an outbound fetch fails, so the surfaced message includes the underlying error code (e.g. `ENOTFOUND`, `ECONNRESET`, `CERT_HAS_EXPIRED`) instead of undici's opaque `"fetch failed"`. The unwrapping helper lives in `@getmunin/core` as `describeError(err, maxDepth?)` so other callers of `safeFetch` (and anywhere else cause-chain visibility matters) can reuse it.

  `describeError` also replaces three sites that previously surfaced only `err.message`: the webhook delivery worker (`webhook_deliveries.error` — visible to customers via `webhooks_list_deliveries`), `@getmunin/agent-host`'s models fetcher, and `@getmunin/agent-runtime`'s web crawler. Each of those had its own local `describe(err)` helper that did the inferior version.

- Updated dependencies [0110a7e]
  - @getmunin/backend-core@4.38.0
  - @getmunin/core@4.38.0
  - @getmunin/agent-runtime@4.38.0
  - @getmunin/db@4.38.0
  - @getmunin/types@4.38.0

## 4.37.0

### Patch Changes

- Updated dependencies [bb39ece]
- Updated dependencies [8e88ac1]
  - @getmunin/backend-core@4.37.0
  - @getmunin/core@4.37.0
  - @getmunin/db@4.37.0
  - @getmunin/types@4.37.0
  - @getmunin/agent-runtime@4.37.0

## 4.36.0

### Patch Changes

- Updated dependencies [c3feb08]
- Updated dependencies [15796b9]
- Updated dependencies [584420d]
- Updated dependencies [c10c12e]
- Updated dependencies [de1b520]
  - @getmunin/backend-core@4.36.0
  - @getmunin/core@4.36.0
  - @getmunin/db@4.36.0
  - @getmunin/types@4.36.0
  - @getmunin/agent-runtime@4.36.0

## 4.35.0

### Patch Changes

- Updated dependencies [73320e2]
- Updated dependencies [b502fe6]
  - @getmunin/backend-core@4.35.0
  - @getmunin/core@4.35.0
  - @getmunin/db@4.35.0
  - @getmunin/agent-runtime@4.35.0
  - @getmunin/types@4.35.0

## 4.34.0

### Patch Changes

- Updated dependencies [290472e]
- Updated dependencies [8d25fee]
  - @getmunin/backend-core@4.34.0
  - @getmunin/core@4.34.0
  - @getmunin/db@4.34.0
  - @getmunin/agent-runtime@4.34.0
  - @getmunin/types@4.34.0

## 4.33.0

### Patch Changes

- Updated dependencies [9042f0e]
  - @getmunin/backend-core@4.33.0
  - @getmunin/core@4.33.0
  - @getmunin/agent-runtime@4.33.0
  - @getmunin/db@4.33.0
  - @getmunin/types@4.33.0

## 4.32.0

### Patch Changes

- 7ed04f9: Fix `org_alerts` insert failure when the agent-host records a provider outage in singleton mode. `runWithServiceContext` was seeding the actor's `orgId` from the config id (`'singleton'`), which violates the `org_alerts.org_id` → `orgs.id` foreign key. The function now accepts an explicit `{ orgId }` override, and the four alert-touching call sites in `AgentHostRunner` (`onProviderError`, `onProviderSuccess`, and the curator worker's success/failure paths) thread through the resolved org id. Also fixes the symmetric latent bug where `recordSuccess` never auto-resolved the alert because `resolveAlert` was scoped to `org='singleton'` and found nothing.
- Updated dependencies [bd8cd79]
- Updated dependencies [f6cb178]
- Updated dependencies [211f215]
- Updated dependencies [03d62af]
  - @getmunin/backend-core@4.32.0
  - @getmunin/core@4.32.0
  - @getmunin/types@4.32.0
  - @getmunin/agent-runtime@4.32.0
  - @getmunin/db@4.32.0

## 4.31.0

### Patch Changes

- Updated dependencies [8b270d4]
  - @getmunin/backend-core@4.31.0
  - @getmunin/core@4.31.0
  - @getmunin/db@4.31.0
  - @getmunin/types@4.31.0
  - @getmunin/agent-runtime@4.31.0

## 4.30.0

### Patch Changes

- @getmunin/core@4.30.0
- @getmunin/db@4.30.0
- @getmunin/types@4.30.0
- @getmunin/backend-core@4.30.0
- @getmunin/agent-runtime@4.30.0

## 4.29.2

### Patch Changes

- @getmunin/core@4.29.2
- @getmunin/db@4.29.2
- @getmunin/types@4.29.2
- @getmunin/backend-core@4.29.2
- @getmunin/agent-runtime@4.29.2

## 4.29.1

### Patch Changes

- Updated dependencies [84b988d]
- Updated dependencies [84b988d]
  - @getmunin/core@4.29.1
  - @getmunin/backend-core@4.29.1
  - @getmunin/agent-runtime@4.29.1
  - @getmunin/db@4.29.1
  - @getmunin/types@4.29.1

## 4.29.0

### Minor Changes

- bc0d601: Introduces `org_alerts`, a first-class operational alerts surface (new `system_alerts_*` MCP tools, `GET /v1/system/alerts`, `org_alert.opened|resolved|acknowledged` realtime events). LLM-provider and channel-inbound failure paths now write to alerts instead of dedicated `last_error` columns on `agent_health` / `conv_inbound_state`, which are dropped. The dashboard banner reads from the alerts feed and renders per-source CTAs.

  Auto-deactivates an inbound poll channel after 5 consecutive failures: `conv_channels.active` flips to `false` (so the worker stops hammering broken credentials), the existing alert metadata records `deactivatedAt` + `attemptCount`, and the channels settings page renders an `ACTIVATE` button. `POST /v1/conversations/channels/:id/activate` re-enables the channel and resolves the alert.

  Also fixes an `imapflow` crash loop in the email adapter: a late TLS socket error after `tick()` returned was emitted with no listener attached, terminating the Node process. The adapter now attaches an `error` listener at construction and tears down the client on `connect()` failure.

### Patch Changes

- 320ae7d: Saving a new fast or smart model in the agent config now calls `agent_health.recordSuccess`, the same recovery path that already runs after a successful API-key validation. If the agent was degraded with `model_not_found` (or any other model-level error), the admin can recover it by picking a different model — previously only an API-key edit cleared the degraded status. Same-value patches don't trigger the call, so a noop save still won't fake-recover a truly broken agent.
- Updated dependencies [bc0d601]
  - @getmunin/backend-core@4.29.0
  - @getmunin/db@4.29.0
  - @getmunin/core@4.29.0
  - @getmunin/agent-runtime@4.29.0
  - @getmunin/types@4.29.0

## 4.28.0

### Patch Changes

- Updated dependencies [7436b8c]
- Updated dependencies [4e09934]
- Updated dependencies [025b064]
  - @getmunin/backend-core@4.28.0
  - @getmunin/core@4.28.0
  - @getmunin/agent-runtime@4.28.0
  - @getmunin/db@4.28.0
  - @getmunin/types@4.28.0

## 4.27.1

### Patch Changes

- @getmunin/core@4.27.1
- @getmunin/db@4.27.1
- @getmunin/types@4.27.1
- @getmunin/backend-core@4.27.1
- @getmunin/agent-runtime@4.27.1

## 4.27.0

### Patch Changes

- Updated dependencies [ee1098c]
- Updated dependencies [97bfdb8]
- Updated dependencies [489b65c]
- Updated dependencies [2605e0f]
- Updated dependencies [24905e6]
- Updated dependencies [524a812]
- Updated dependencies [6c585ba]
- Updated dependencies [b46a41c]
  - @getmunin/backend-core@4.27.0
  - @getmunin/core@4.27.0
  - @getmunin/db@4.27.0
  - @getmunin/agent-runtime@4.27.0
  - @getmunin/types@4.27.0

## 4.26.0

### Patch Changes

- @getmunin/core@4.26.0
- @getmunin/db@4.26.0
- @getmunin/types@4.26.0
- @getmunin/backend-core@4.26.0
- @getmunin/agent-runtime@4.26.0

## 4.25.0

### Patch Changes

- 7ddf932: **Security**: address four audit findings.
  - **High**: gate every sensitive control-plane endpoint on owner/admin role (webhooks, conversation channels, agent-config, org/assistant PATCH, etc.). Previously any signed-in member could rotate widget keys, change LLM provider credentials, or create event-exfiltrating webhooks.
  - **High**: agent provider URLs (`providerBaseUrl`) now route through `safeFetch` (blocks private/loopback/link-local hosts) and reject `http://` unless `MUNIN_SSRF_ALLOW_PRIVATE` is set. Closes the SSRF + credential-exfil path that let a misconfigured base URL leak the provider API key.
  - **High**: add RLS policy on `conv_widget_email_fallbacks` (the ledger had `org_id` but no policy). Plus a meta-test in `rls.test.ts` that fails when any `org_id`-bearing table is missing RLS.
  - **Medium**: expand role-coverage integration tests to cover the newly-gated endpoints (webhooks, conv channels, org/assistant PATCH).

  **Ergonomics**: introduce `@RequireRole(...)` / `@RequireActorType(...)` decorators + a single `RoleGuard` to replace inline `assertOwnerOrAdmin(...)` calls scattered across ~13 controllers. Conditional / body-dependent checks (`members:patch`) stay inline.

- Updated dependencies [33b6613]
- Updated dependencies [7ddf932]
  - @getmunin/backend-core@4.25.0
  - @getmunin/agent-runtime@4.25.0
  - @getmunin/db@4.25.0
  - @getmunin/core@4.25.0
  - @getmunin/types@4.25.0

## 4.24.3

### Patch Changes

- Updated dependencies [622745a]
  - @getmunin/backend-core@4.24.3
  - @getmunin/core@4.24.3
  - @getmunin/db@4.24.3
  - @getmunin/types@4.24.3
  - @getmunin/agent-runtime@4.24.3

## 4.24.2

### Patch Changes

- Updated dependencies [b8da5b6]
  - @getmunin/backend-core@4.24.2
  - @getmunin/core@4.24.2
  - @getmunin/db@4.24.2
  - @getmunin/types@4.24.2
  - @getmunin/agent-runtime@4.24.2

## 4.24.1

### Patch Changes

- Updated dependencies [f96c899]
  - @getmunin/db@4.24.1
  - @getmunin/backend-core@4.24.1
  - @getmunin/core@4.24.1
  - @getmunin/agent-runtime@4.24.1
  - @getmunin/types@4.24.1

## 4.24.0

### Patch Changes

- Updated dependencies [e095d61]
- Updated dependencies [ef55e18]
- Updated dependencies [bbfc677]
  - @getmunin/backend-core@4.24.0
  - @getmunin/core@4.24.0
  - @getmunin/db@4.24.0
  - @getmunin/agent-runtime@4.24.0
  - @getmunin/types@4.24.0

## 4.23.5

### Patch Changes

- @getmunin/backend-core@4.23.5
- @getmunin/core@4.23.5
- @getmunin/db@4.23.5
- @getmunin/types@4.23.5
- @getmunin/agent-runtime@4.23.5

## 4.23.4

### Patch Changes

- Updated dependencies [6dfabd2]
  - @getmunin/core@4.23.4
  - @getmunin/backend-core@4.23.4
  - @getmunin/agent-runtime@4.23.4
  - @getmunin/db@4.23.4
  - @getmunin/types@4.23.4

## 4.23.3

### Patch Changes

- Updated dependencies [57d7901]
  - @getmunin/core@4.23.3
  - @getmunin/agent-runtime@4.23.3
  - @getmunin/backend-core@4.23.3
  - @getmunin/db@4.23.3
  - @getmunin/types@4.23.3

## 4.23.2

### Patch Changes

- Updated dependencies [377e87d]
- Updated dependencies [f0e5389]
  - @getmunin/backend-core@4.23.2
  - @getmunin/core@4.23.2
  - @getmunin/agent-runtime@4.23.2
  - @getmunin/types@4.23.2
  - @getmunin/db@4.23.2

## 4.23.1

### Patch Changes

- Updated dependencies [1f1a139]
  - @getmunin/backend-core@4.23.1
  - @getmunin/core@4.23.1
  - @getmunin/db@4.23.1
  - @getmunin/types@4.23.1
  - @getmunin/agent-runtime@4.23.1

## 4.23.0

### Patch Changes

- Updated dependencies [2dd56ef]
- Updated dependencies [31f5346]
  - @getmunin/backend-core@4.23.0
  - @getmunin/core@4.23.0
  - @getmunin/db@4.23.0
  - @getmunin/types@4.23.0
  - @getmunin/agent-runtime@4.23.0

## 4.22.0

### Patch Changes

- Updated dependencies [6b4276d]
  - @getmunin/backend-core@4.22.0
  - @getmunin/core@4.22.0
  - @getmunin/db@4.22.0
  - @getmunin/types@4.22.0
  - @getmunin/agent-runtime@4.22.0

## 4.21.0

### Patch Changes

- Updated dependencies [cc45f6c]
  - @getmunin/backend-core@4.21.0
  - @getmunin/core@4.21.0
  - @getmunin/db@4.21.0
  - @getmunin/types@4.21.0
  - @getmunin/agent-runtime@4.21.0

## 4.20.0

### Patch Changes

- Updated dependencies [cedba8d]
- Updated dependencies [75ad065]
  - @getmunin/backend-core@4.20.0
  - @getmunin/db@4.20.0
  - @getmunin/core@4.20.0
  - @getmunin/agent-runtime@4.20.0
  - @getmunin/types@4.20.0

## 4.19.4

### Patch Changes

- 623dd4d: Fix the in-process end-user agent actor having no scopes, which silently disabled every self-service-audience tool that requires a write scope (handover, phone-call request, my-contact update, log-activity-self).
  - `agent-host`'s `openMcp` factory now passes a default scope set to `openEndUserAgentMcpClient` covering the full self-service surface: `conv:read`, `conv:write`, `kb:read`, `crm:read`, `crm:write`. Previously the actor was built with `[]`, so the MCP dispatcher rejected every gated tool call with a structured `errorResult('Missing required scope: …')` — silently, because tool errors do not throw — and the LLM's call was a no-op.
  - `agent-runtime`'s HTTP `mintDelegatedToken` default now includes `crm:write` for parity, so delegated end-user tokens minted by the runtime can call the same self-service surface.
  - Adds a regression test asserting a self-service actor with broad scopes is still blocked from admin-audience tools — the audience gate runs before the scope check, so granting an end-user agent `conv:write` does _not_ unlock admin conv tools.

- Updated dependencies [aa30308]
- Updated dependencies [623dd4d]
  - @getmunin/backend-core@4.19.4
  - @getmunin/agent-runtime@4.19.4
  - @getmunin/core@4.19.4
  - @getmunin/db@4.19.4
  - @getmunin/types@4.19.4

## 4.19.3

### Patch Changes

- @getmunin/core@4.19.3
- @getmunin/db@4.19.3
- @getmunin/types@4.19.3
- @getmunin/backend-core@4.19.3
- @getmunin/agent-runtime@4.19.3

## 4.19.2

### Patch Changes

- @getmunin/core@4.19.2
- @getmunin/db@4.19.2
- @getmunin/types@4.19.2
- @getmunin/backend-core@4.19.2
- @getmunin/agent-runtime@4.19.2

## 4.19.1

### Patch Changes

- Updated dependencies [fb04e33]
  - @getmunin/agent-runtime@4.19.1
  - @getmunin/backend-core@4.19.1
  - @getmunin/core@4.19.1
  - @getmunin/db@4.19.1
  - @getmunin/types@4.19.1

## 4.19.0

### Patch Changes

- Updated dependencies [0501880]
  - @getmunin/backend-core@4.19.0
  - @getmunin/core@4.19.0
  - @getmunin/db@4.19.0
  - @getmunin/types@4.19.0
  - @getmunin/agent-runtime@4.19.0

## 4.18.0

### Patch Changes

- Updated dependencies [a0d31d7]
  - @getmunin/backend-core@4.18.0
  - @getmunin/core@4.18.0
  - @getmunin/db@4.18.0
  - @getmunin/types@4.18.0
  - @getmunin/agent-runtime@4.18.0

## 4.17.0

### Patch Changes

- @getmunin/core@4.17.0
- @getmunin/db@4.17.0
- @getmunin/types@4.17.0
- @getmunin/backend-core@4.17.0
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

- Updated dependencies [7e16468]
  - @getmunin/backend-core@4.16.0
  - @getmunin/core@4.16.0
  - @getmunin/db@4.16.0
  - @getmunin/types@4.16.0
  - @getmunin/agent-runtime@4.16.0

## 4.15.0

### Patch Changes

- Updated dependencies [d8ed4f6]
  - @getmunin/backend-core@4.15.0
  - @getmunin/db@4.15.0
  - @getmunin/core@4.15.0
  - @getmunin/agent-runtime@4.15.0
  - @getmunin/types@4.15.0

## 4.14.0

### Patch Changes

- Updated dependencies [1fe1031]
  - @getmunin/backend-core@4.14.0
  - @getmunin/core@4.14.0
  - @getmunin/agent-runtime@4.14.0
  - @getmunin/db@4.14.0
  - @getmunin/types@4.14.0

## 4.13.0

### Patch Changes

- Updated dependencies [7977f92]
  - @getmunin/backend-core@4.13.0
  - @getmunin/core@4.13.0
  - @getmunin/agent-runtime@4.13.0
  - @getmunin/db@4.13.0
  - @getmunin/types@4.13.0

## 4.12.0

### Patch Changes

- Updated dependencies [458b548]
  - @getmunin/backend-core@4.12.0
  - @getmunin/core@4.12.0
  - @getmunin/db@4.12.0
  - @getmunin/types@4.12.0
  - @getmunin/agent-runtime@4.12.0

## 4.11.0

### Patch Changes

- Updated dependencies [2f2eff8]
  - @getmunin/backend-core@4.11.0
  - @getmunin/core@4.11.0
  - @getmunin/db@4.11.0
  - @getmunin/types@4.11.0
  - @getmunin/agent-runtime@4.11.0

## 4.10.0

### Patch Changes

- Updated dependencies [024a314]
  - @getmunin/backend-core@4.10.0
  - @getmunin/core@4.10.0
  - @getmunin/db@4.10.0
  - @getmunin/types@4.10.0
  - @getmunin/agent-runtime@4.10.0

## 4.9.0

### Patch Changes

- Updated dependencies [8c1c3c9]
- Updated dependencies [2ca3b4a]
- Updated dependencies [f9a8e0f]
  - @getmunin/core@4.9.0
  - @getmunin/agent-runtime@4.9.0
  - @getmunin/backend-core@4.9.0
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

- Updated dependencies [7c9a3d3]
- Updated dependencies [0a0e2a1]
  - @getmunin/backend-core@4.8.0
  - @getmunin/core@4.8.0
  - @getmunin/agent-runtime@4.8.0
  - @getmunin/db@4.8.0
  - @getmunin/types@4.8.0

## 4.7.1

### Patch Changes

- Updated dependencies [8c79922]
  - @getmunin/backend-core@4.7.1
  - @getmunin/core@4.7.1
  - @getmunin/db@4.7.1
  - @getmunin/types@4.7.1
  - @getmunin/agent-runtime@4.7.1

## 4.7.0

### Patch Changes

- Updated dependencies [5108510]
  - @getmunin/backend-core@4.7.0
  - @getmunin/core@4.7.0
  - @getmunin/agent-runtime@4.7.0
  - @getmunin/db@4.7.0
  - @getmunin/types@4.7.0

## 4.6.1

### Patch Changes

- Updated dependencies [04edb03]
- Updated dependencies [afcf3a1]
  - @getmunin/backend-core@4.6.1
  - @getmunin/core@4.6.1
  - @getmunin/db@4.6.1
  - @getmunin/types@4.6.1
  - @getmunin/agent-runtime@4.6.1

## 4.6.0

### Patch Changes

- Updated dependencies [b770bce]
  - @getmunin/backend-core@4.6.0
  - @getmunin/db@4.6.0
  - @getmunin/core@4.6.0
  - @getmunin/agent-runtime@4.6.0
  - @getmunin/types@4.6.0

## 4.5.1

### Patch Changes

- Updated dependencies [8d6b8b9]
  - @getmunin/backend-core@4.5.1
  - @getmunin/core@4.5.1
  - @getmunin/db@4.5.1
  - @getmunin/types@4.5.1
  - @getmunin/agent-runtime@4.5.1

## 4.5.0

### Patch Changes

- Updated dependencies [9367ac8]
  - @getmunin/backend-core@4.5.0
  - @getmunin/core@4.5.0
  - @getmunin/db@4.5.0
  - @getmunin/types@4.5.0
  - @getmunin/agent-runtime@4.5.0

## 4.4.1

### Patch Changes

- @getmunin/core@4.4.1
- @getmunin/db@4.4.1
- @getmunin/types@4.4.1
- @getmunin/backend-core@4.4.1
- @getmunin/agent-runtime@4.4.1

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
