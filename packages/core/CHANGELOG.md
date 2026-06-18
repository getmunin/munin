# @getmunin/core

## 4.50.1

### Patch Changes

- d612e6a: Patch security-vulnerable dependencies. Bump nodemailer to ^8.0.9 (CRLF header injection, OAuth2 TLS certificate validation) and ws to ^8.21.0 (memory-exhaustion DoS), and force patched transitive versions of hono, form-data, multer, @opentelemetry/core, and @babel/core via pnpm overrides.
  - @getmunin/db@4.50.1
  - @getmunin/types@4.50.1

## 4.50.0

### Patch Changes

- Updated dependencies [3f034de]
  - @getmunin/types@4.50.0
  - @getmunin/db@4.50.0

## 4.49.0

### Patch Changes

- f13f5c5: Flush MCP responses only after the request's tenant transaction commits.

  `TenancyInterceptor` wraps each authenticated request in a transaction, but the MCP controller's `transport.handleRequest` writes the JSON-RPC response to the socket from inside that transaction — so the response (and any returned data, e.g. a freshly minted tracker key) reached the client before the write committed. A client that immediately used the result against another endpoint could read-after-write through a separate DB connection and miss the not-yet-committed row.

  The MCP POST handler now buffers its (stateless, JSON) response and flushes it via a new `RequestContext.afterCommit` hook that `TenancyInterceptor` runs once the transaction has committed. GET (SSE streaming) is unaffected. This removes a read-after-write race that surfaced as a flaky analytics tracker integration test.
  - @getmunin/db@4.49.0
  - @getmunin/types@4.49.0

## 4.48.0

### Patch Changes

- Updated dependencies [dc70c67]
  - @getmunin/types@4.48.0
  - @getmunin/db@4.48.0

## 4.47.0

### Patch Changes

- 4b889cf: Rename MCP tools for naming consistency. The dominant convention is `<module>_<verb>_<object>`; these tools deviated and have been renamed:
  - `crm_propose_merge_candidate` → `crm_propose_merge` (the other merge tools all say "proposal", not "candidate")
  - conv channel admin (verb/object order): `conv_channel_configure` → `conv_configure_channel`, `conv_channel_test` → `conv_test_channel`, `conv_channel_send_test` → `conv_send_channel_test`
  - conv email: `conv_email_setup_channel` → `conv_setup_email_channel`, `conv_email_test_channel` → `conv_test_email_channel`, `conv_email_send_test` → `conv_send_email_test`
  - voice ("call", not voice/phone split): `conv_voice_call` → `conv_call_channel`, `conv_voice_call_contact` → `conv_call_contact`
  - end-user self-service (drop awkward possessive/suffix): `crm_log_activity_self` → `crm_log_my_activity`, `conv_request_handover_in_my_conversation` → `conv_request_human`, `conv_request_phone_call_for_my_conversation` → `conv_request_callback`
  - analytics report tools (add the verb the rest of the surface uses): `analytics_top_subjects` → `analytics_list_top_subjects`, `analytics_top_countries` → `analytics_list_top_countries`, `analytics_traffic_by_source` → `analytics_get_traffic_by_source`, `analytics_referrer_hosts` → `analytics_list_referrer_hosts`, `analytics_views_over_time` → `analytics_get_views_over_time`, `analytics_subject_engagement` → `analytics_get_subject_engagement`, `analytics_contact_journey` → `analytics_get_contact_journey`, `analytics_zero_result_searches` → `analytics_list_zero_result_searches`

  Breaking for MCP clients pinned to the old tool names.
  - @getmunin/db@4.47.0
  - @getmunin/types@4.47.0

## 4.46.0

### Patch Changes

- @getmunin/db@4.46.0
- @getmunin/types@4.46.0

## 4.45.1

### Patch Changes

- @getmunin/db@4.45.1
- @getmunin/types@4.45.1

## 4.45.0

### Patch Changes

- @getmunin/db@4.45.0
- @getmunin/types@4.45.0

## 4.44.1

### Patch Changes

- @getmunin/db@4.44.1
- @getmunin/types@4.44.1

## 4.44.0

### Patch Changes

- @getmunin/db@4.44.0
- @getmunin/types@4.44.0

## 4.43.2

### Patch Changes

- @getmunin/db@4.43.2
- @getmunin/types@4.43.2

## 4.43.1

### Patch Changes

- @getmunin/db@4.43.1
- @getmunin/types@4.43.1

## 4.43.0

### Patch Changes

- Updated dependencies [3858d3e]
  - @getmunin/db@4.43.0
  - @getmunin/types@4.43.0

## 4.42.0

### Patch Changes

- Updated dependencies [205e1eb]
  - @getmunin/db@4.42.0
  - @getmunin/types@4.42.0

## 4.41.1

### Patch Changes

- @getmunin/db@4.41.1
- @getmunin/types@4.41.1

## 4.41.0

### Patch Changes

- Updated dependencies [145dbd9]
  - @getmunin/db@4.41.0
  - @getmunin/types@4.41.0

## 4.40.4

### Patch Changes

- @getmunin/db@4.40.4
- @getmunin/types@4.40.4

## 4.40.3

### Patch Changes

- @getmunin/db@4.40.3
- @getmunin/types@4.40.3

## 4.40.2

### Patch Changes

- @getmunin/db@4.40.2
- @getmunin/types@4.40.2

## 4.40.1

### Patch Changes

- Updated dependencies [706d8c9]
  - @getmunin/db@4.40.1
  - @getmunin/types@4.40.1

## 4.40.0

### Patch Changes

- Updated dependencies [547a97b]
  - @getmunin/db@4.40.0
  - @getmunin/types@4.40.0

## 4.39.0

### Patch Changes

- @getmunin/db@4.39.0
- @getmunin/types@4.39.0

## 4.38.0

### Minor Changes

- 0110a7e: MCP dispatch now records redacted `args` on every audit row — including the `denied`, `invalid_input`, `rate_limited`, and thrown-handler paths that previously dropped the args. The success path is unchanged. The `invalid_input` row also now carries the Zod error message in its `error` column instead of just the literal string `"invalid_input"`. Caller-controlled args on `unknown_tool` are still dropped (no schema available to redact against).

  A new optional `captureException` hook on `createMcpServer` / `openInProcessMcpClient` receives any error thrown by a tool handler, along with the tool name, actor identity (type / id / orgId), and redacted args. `mcp-toolkit` remains observability-vendor agnostic.

  `@getmunin/backend-core` exposes the wiring: a new `ErrorReporterModule` registers a `NoopErrorReporter` against the `ERROR_REPORTER` injection token. `McpController` injects it and forwards thrown handler errors. Hosts that want Sentry (or any other reporter) replace the provider for `ERROR_REPORTER` with their own `ErrorReporter` subclass — `apps/backend` does this with a `SentryErrorReporter` that uses `Sentry.withScope` to attach the tool / actor / args context.

  The `cms_upload_asset_from_url` / `cms_upload_asset_from_file` error path now walks the `Error.cause` chain when an outbound fetch fails, so the surfaced message includes the underlying error code (e.g. `ENOTFOUND`, `ECONNRESET`, `CERT_HAS_EXPIRED`) instead of undici's opaque `"fetch failed"`. The unwrapping helper lives in `@getmunin/core` as `describeError(err, maxDepth?)` so other callers of `safeFetch` (and anywhere else cause-chain visibility matters) can reuse it.

  `describeError` also replaces three sites that previously surfaced only `err.message`: the webhook delivery worker (`webhook_deliveries.error` — visible to customers via `webhooks_list_deliveries`), `@getmunin/agent-host`'s models fetcher, and `@getmunin/agent-runtime`'s web crawler. Each of those had its own local `describe(err)` helper that did the inferior version.

### Patch Changes

- @getmunin/db@4.38.0
- @getmunin/types@4.38.0

## 4.37.0

### Patch Changes

- @getmunin/db@4.37.0
- @getmunin/types@4.37.0

## 4.36.0

### Patch Changes

- @getmunin/db@4.36.0
- @getmunin/types@4.36.0

## 4.35.0

### Minor Changes

- 73320e2: Add a drop-in tracker script for arbitrary web pages — same ergonomics as the chat widget. `analytics_create_tracker` mints a public `mn_track_*` API key, then a single `<script async src=".../v1/a/tracker.js" data-key="mn_track_…">` tag auto-fires page views, tracks dwell on `pagehide`, and exposes `window.mn.track(subjectId, attrs)` for SPA route changes. Events land in `analytics_view_events` with `source='tracker'`. Tracker keys are write-only and org-scoped — safe to embed in browsers.

  Also adds three admin read tools: `analytics_top_subjects` (most-viewed pages/entries), `analytics_subject_engagement` (views/dwell/depth for one subject), `analytics_zero_result_searches` (queries readers asked that returned nothing — the best "what to write next" signal). The `cms/review-stale-entries` skill now consults `analytics_subject_engagement` to judge refresh-vs-archive instead of relying on inbound references alone; a new `skill://analytics/track-website-traffic` walks operators through the full setup.

### Patch Changes

- Updated dependencies [73320e2]
  - @getmunin/db@4.35.0
  - @getmunin/types@4.35.0

## 4.34.0

### Minor Changes

- 290472e: Add an `analytics` module that records page-view and search events for any consumer surface. Two ingress paths: a 1×1 GIF pixel at `GET /v1/a/v/:token.gif` and a JSON beacon at `POST /v1/a/v`. Both anonymous, throttled, bot-UA filtered, and gated by an HMAC-signed view token bound to `(orgId, subjectType, subjectId)` so callers can't spoof arbitrary subjects. Events land in two new polymorphic tables (`analytics_view_events`, `analytics_search_events`) keyed by `subject_type` (`'cms_entry'` today, `'landing'`/`'dashboard_route'`/… later) — no per-consumer schema churn.

  CMS delivery wires in as the first consumer: every entry and list item from `/v1/cms/{orgId}/...` now ships with a `_tracking: { pixelUrl, beaconUrl }` block (suppressible via `?tracking=0`), and the public `/search` endpoint logs every query plus its `result_count` for "what to write next" analysis (zero-result queries are indexed for fast lookup).

  Also: the email open pixel and the new CMS tracking URLs both now build off `MUNIN_API_URL` via a new `readApiBaseUrl()` helper, fixing a latent bug where pixels were minted against the MCP host on split-host deployments (`api.*` vs `mcp.*` subdomains). The unused `readPublicBaseUrl()` shim is removed, and `MUNIN_API_URL` is documented in `.env.example` under the Backend section.

### Patch Changes

- Updated dependencies [290472e]
- Updated dependencies [8d25fee]
  - @getmunin/db@4.34.0
  - @getmunin/types@4.34.0

## 4.33.0

### Patch Changes

- 9042f0e: Schema-driven CMS draft drawer + safeFetch streaming fix.

  **`@getmunin/core` — `safeFetch` body-stream lifecycle fix.** The undici agent was closed in a `finally` block as soon as `safeFetch` returned, so any response body larger than the initial socket receive buffer got cut off mid-stream and the body reader hung until the caller's `AbortSignal.timeout` fired. `safeFetch` now hands the agent's lifetime over to the response body via a `ReadableStream` wrapper that closes the agent on stream end, error, or cancel; small bodies and redirect/error paths still close immediately. New regression test exercises a 2 MB payload flushed in two halves with a 50 ms gap so this class of bug can't sneak back in. As part of the cleanup the same module dropped two silent `catch (() => {})` swallows in favour of `console.warn`, and the redirect/agent-cleanup logic was DRYed up.

  **`@getmunin/backend-core` — CMS draft + asset endpoints.**
  - `GET` and `PATCH /v1/cms-drafts/:id` now return `CmsDraftDetailDto extends EntryDto { fields: FieldDef[] }` so the dashboard always has the collection schema in hand.
  - New `POST /v1/cms-drafts/:id/assets` uploads an asset (`{ name, mime, base64Body, altText? }` JSON) and returns the `AssetDto`. It does not touch the entry — the dashboard stages the new asset locally and commits it on Save.
  - `CmsService.updateEntry` now runs `expandAssetsInDtos` before returning, so the PATCH response carries fully-expanded asset objects (previously the bare id string).
  - `CmsService.listDraftEntries` derives a fallback `title` (and exposes `titleFieldName`) via `title → name → headline → subject → first required text field → slug`, so collections without a hardcoded `title` field still surface a sensible header.
  - `validateEntryData` treats `""` / `[]` as "not present" for required-field purposes — previously a required text field with empty string passed validation.
  - `CmsInvalidError` carries structured `fieldErrors`, and the controller surfaces them as `{ message, fieldErrors: [{ field, message }] }` on 400 responses so the dashboard can highlight the offending field instead of dropping a toast.
  - `cms_create_collection` / `cms_update_collection` MCP descriptions now spell out that `fields` is an **ordered** array — order = render order in editor and public surfaces — and that `cms_update_collection` REPLACES the existing array.

  **`@getmunin/dashboard-pages` — schema-driven CMS draft drawer.**
  - Replaced the body-only editor with a per-field editor driven by `detail.fields`. Editors per type: `text` → input, `markdown` / `rich_text` → textarea (markdown is multi-row), `integer` / `number` → number input, `boolean` → checkbox, `select` → dropdown of `options.choices`, `date` / `datetime` → matching inputs, `asset` → drop-zone with click-to-pick, drag-and-drop, in-place replace, and uploading state.
  - Read-mode renders each field in a consistent `ValueBox` (matches body's existing border treatment); markdown via `ReactMarkdown`; assets as a 16:9 figure. Empty optional fields are hidden in read mode; the field whose name matches `titleFieldName` is also hidden (drawer header already shows it).
  - Save sends only the diffed fields as a single `PATCH /v1/cms-drafts/:id` with `{ data: ... }`. Asset fields serialize back to their id string.
  - Backend `fieldErrors` surface inline: red label + destructive border + `aria-invalid` + a `role="alert"` message under each editor (no more "validation failed: x" toast).
  - Asset drop-zone now reveals its "Replace cover image" label on hover with a paper-tinted overlay, instead of always overlaying text on the image.
  - Drawer header close button gets `shrink-0 whitespace-nowrap` so "close ×" stays inline next to long wrapping titles.
  - Inbox drawer reads its queue item from the live queue (by id) instead of holding a snapshot, so post-save header refreshes are visible.
  - New `ApiError.fieldErrors` carries structured field errors through the fetch helper. Unused i18n keys (`cmsBody`, `cmsBodyPlaceholder`, `cmsCoverImage`, `cmsCoverEmpty`) removed.
  - @getmunin/db@4.33.0
  - @getmunin/types@4.33.0

## 4.32.0

### Minor Changes

- 211f215: feat(core): add shared env-parsing helpers (`parseEnvInt`, `parseEnvBool`, `parseEnvDisableFlag`, `parseEnvCron`) and migrate existing call sites in core, backend-core, agent-host, and apps/backend.

  `Number(process.env.X ?? D)` patterns previously passed NaN through silently when an env var was set to garbage; `parseEnvInt` falls back to the default in that case. `parseEnvDisableFlag` and `parseEnvBool` accept both `'1'` and `'true'` (case-insensitive). `parseEnvCron` returns `null` when the value is `'off'` or `'0'`, so callers can opt out of a cron without an inline guard.

### Patch Changes

- f6cb178: `safeFetch`: factor the agent's connect-time DNS lookup behind a `ConnectLookup` seam and expose it as the optional `__connectLookup` option on `SafeFetchOptions`. Behavior is unchanged when the option is not passed — the default uses `dns.lookup` with `{ all: true, verbatim: true }`. The SSRF DNS-rebinding regression test stops depending on real-world DNS for `127.0.0.1.nip.io` (a flaky source of test timeouts on CI) and uses the seam to deterministically simulate a connect-time DNS that returns a private address.
- Updated dependencies [03d62af]
  - @getmunin/types@4.32.0
  - @getmunin/db@4.32.0

## 4.31.0

### Patch Changes

- @getmunin/db@4.31.0
- @getmunin/types@4.31.0

## 4.30.0

### Patch Changes

- @getmunin/db@4.30.0
- @getmunin/types@4.30.0

## 4.29.2

### Patch Changes

- @getmunin/db@4.29.2
- @getmunin/types@4.29.2

## 4.29.1

### Patch Changes

- 84b988d: KB and CMS vector search now cast the query embedding to match the deployed column type. The hard-coded `::vector` cast in `kb.search.ts` and `cms.search.ts` bypassed the HNSW index when the column was switched to `halfvec` (required for embeddings above 2000 dimensions, since pgvector's `vector` type caps HNSW indexing at 2000). Queries fell back to sequential scans of every chunk in the org. A new `embeddingColumnType()` helper in `@getmunin/core` reads `MUNIN_EMBEDDING_COLUMN_TYPE` (defaulting to `vector`), and the search SQL uses it via `sql.raw` to keep the index in play. Set `MUNIN_EMBEDDING_COLUMN_TYPE=halfvec` on deployments where the column was migrated to `halfvec`.
  - @getmunin/db@4.29.1
  - @getmunin/types@4.29.1

## 4.29.0

### Patch Changes

- Updated dependencies [bc0d601]
  - @getmunin/db@4.29.0
  - @getmunin/types@4.29.0

## 4.28.0

### Minor Changes

- 7436b8c: Add `cms_upload_asset_bytes` MCP tool: agentic clients can now upload small assets (≤2 MB after base64 decode) in a single call, without the `cms_request_asset_upload` → out-of-band S3 PUT → `cms_complete_asset_upload` round-trip. The new tool decodes server-side, writes the bytes through the storage abstraction, and persists the row already marked `uploaded: true`. SVG is rejected on the same grounds as the request/complete path. For larger files the existing two-step flow remains the right shape.

  To support this, `S3CompatibleStorage` now implements `writeDirect` using a SigV4 `PUT` with full-payload `x-amz-content-sha256` hashing (compatible with strict S3 implementations). The Nest JSON body limit moves from the Express default (~100 kB) to 4 MB to accommodate base64-inflated payloads.

### Patch Changes

- 025b064: **Critical fix:** `safeFetch` now returns the array-shaped callback undici expects when it asks for `all: true` resolution.

  Every `safeFetch` call against a non-IP-literal host (i.e. virtually every real-world call) was failing with `TypeError: fetch failed` → `cause: Invalid IP address: undefined` after undici started passing `lookup({ ..., all: true }, cb)`. The custom SSRF agent's `lookup` was forcing `all: false` internally and calling `cb(null, address, family)`. Undici read the wrong shape from that callback, ended up with `undefined` where it expected an IP, and threw inside `node:net`'s `emitLookup`.

  The fix: always resolve with `all: true` (which also lets us SSRF-check every resolved address, not just the first one), then format the callback response to match what undici asked for — array if `all: true`, single string if `all: false`. Adds a regression test that fetches through the DNS path against an `*.nip.io` hostname with `MUNIN_SSRF_ALLOW_PRIVATE` set (existing tests used literal `127.0.0.1`, which short-circuits the lookup callback and didn't exercise this code).

  Impact of the bug while live: AI provider credential validation, model listing, agent-runtime LLM calls, outbound webhook delivery (incl. CMS-content webhooks), and website-import crawls all failed against any real host.
  - @getmunin/db@4.28.0
  - @getmunin/types@4.28.0

## 4.27.1

### Patch Changes

- @getmunin/db@4.27.1
- @getmunin/types@4.27.1

## 4.27.0

### Patch Changes

- 97bfdb8: Drop the misleading `openai` label from embedding-provider output.

  The HTTP embedding provider is OpenAI-protocol compatible but routinely
  points at Scaleway, Ollama, vLLM, etc. — calling its errors and telemetry
  name `openai:…` made production failures look like OpenAI outages when
  they were really upstream IAM/permission errors at the configured base URL.
  - Error on non-2xx response is now `embedding provider request failed: <status> <body> (<name> via <baseUrl>)` instead of `openai embeddings failed: …`. The model name and endpoint are included so the failure is self-diagnosing.
  - `EmbeddingProvider.name` no longer prefixes `openai:`; it's just `<model>` or `<model>@<dimensions>`. Anything consuming this for telemetry/audit will see the bare model identifier.

- 2605e0f: **Security (critical)**: prevent OAuth bearer tokens from acting as control-plane credentials.

  Before this patch, an OAuth access token with any non-empty scope set — even one
  containing only `openid` — resolved to a `user` actor whose `ControlPlaneGuard`
  branch (`actor.type === 'user' → return true`) admitted it without checking the
  token's audience or scopes. Combined with `deriveAudiencesFromScopes` defaulting
  to the `admin` audience for any scope-bearing token, every issued OAuth token
  was effectively a full org-admin key for the dashboard's `/v1/*` REST surface
  (conversations, inbox, activity, curator jobs, CRM, CMS, …).

  Three changes:
  - `deriveAudiencesFromScopes` no longer falls back to `admin` when no `mcp:*`
    scope is present. `admin` requires `mcp:admin`, `self_service` requires
    `mcp:self_service`.
  - `ControlPlaneGuard` rejects `user` actors whose credential carries an MCP
    resource `audience` (i.e. was issued via OAuth). Session-cookie users — whose
    credentials never set `audience` — still pass.
  - `AuthGuard` enforces audience binding on every route, not just `/mcp`. A
    bearer minted for the MCP resource cannot be presented to `/v1/*`.

- 24905e6: **Security**: enable RLS on `org_members`.

  `org_members` was the last org-scoped table without a tenant-isolation policy.
  The composite `(org_id, user_id)` primary key meant correct controllers couldn't
  return cross-org rows by accident, but the database stopped catching mistakes —
  any future controller that forgot the WHERE clause would leak membership info
  across tenants. The meta-test in `rls.test.ts` was suppressed with an
  exemption.

  This patch:
  - Adds a `tenant_isolation` policy on `org_members` mirroring the other
    org-scoped tables (`org_id = app_org_id() OR app_bypass_rls()`).
  - Wraps the three structurally cross-org reads (OAuth credential resolver,
    JWT credential resolver, session credential resolver, signup) in a
    `bypass_rls` transaction — they filter by `user_id` and run before
    `TenancyInterceptor` sets `app.org_id`, so they could not satisfy a strict
    policy. Introduces a shared `readMembershipsForUser` helper in
    `@getmunin/core` so the three sites stay consistent.
  - Drops the `org_members` exemption from the "every org_id table has RLS"
    meta-test.

  Migrations are idempotent and re-apply `rls.sql` on each run, so existing
  deployments pick up the policy on next migrate.

- Updated dependencies [24905e6]
  - @getmunin/db@4.27.0
  - @getmunin/types@4.27.0

## 4.26.0

### Patch Changes

- @getmunin/db@4.26.0
- @getmunin/types@4.26.0

## 4.25.0

### Patch Changes

- Updated dependencies [7ddf932]
  - @getmunin/db@4.25.0
  - @getmunin/types@4.25.0

## 4.24.3

### Patch Changes

- @getmunin/db@4.24.3
- @getmunin/types@4.24.3

## 4.24.2

### Patch Changes

- @getmunin/db@4.24.2
- @getmunin/types@4.24.2

## 4.24.1

### Patch Changes

- Updated dependencies [f96c899]
  - @getmunin/db@4.24.1
  - @getmunin/types@4.24.1

## 4.24.0

### Minor Changes

- ef55e18: Make the embedding vector dimension a deploy-time parameter.

  `OpenAIEmbeddingProvider` now accepts an optional `dimensions` field that is sent in the request body (honored by `text-embedding-3-*` and Scaleway's `qwen3-embedding-8b`) and enforced on the response — Matryoshka-truncated and L2-renormalized if the upstream returns a larger vector. The factory reads `OPENAI_EMBEDDING_DIMENSIONS` and cross-validates against `MUNIN_EMBEDDING_DIMENSIONS` so a mismatched deploy fails at boot rather than corrupting the index.

  `packages/db/src/schema.ts` reads `MUNIN_EMBEDDING_DIMENSIONS` (default 1536, range 32..4000). The embedding column is `vector(dim)` when `dim <= 2000` and `halfvec(dim)` above that, so deployments wanting near-native Qwen3 quality can pick `halfvec(4000)` and still index with HNSW. OSS defaults are unchanged — leaving the env var unset keeps the existing `vector(1536)` schema and 1536-dim provider.

  OSS migrations stay pinned to `vector(1536)`; bumping the dimension requires a fresh database or a deployment-specific ALTER. Self-hosters on the default see no behavior change.

### Patch Changes

- Updated dependencies [ef55e18]
  - @getmunin/db@4.24.0
  - @getmunin/types@4.24.0

## 4.23.5

### Patch Changes

- @getmunin/db@4.23.5
- @getmunin/types@4.23.5

## 4.23.4

### Patch Changes

- 6dfabd2: Introduce `@getmunin/emails`: a shared React Email package that owns every transactional template Munin sends.
  - New templates (en + nb where applicable, all returning `{ subject, html, text }`):
    `renderResetPasswordEmail`, `renderVerifyEmail`, `renderDeleteAccountEmail`,
    `renderOrgInviteEmail`, `renderChannelTestEmail`, `renderPartnerClaimEmail`.
  - Org invite + channel-test now ship HTML alongside plaintext, matching the design system (serif heading, mono eyebrow, accent CTA, fallback URL block, footer attribution).
  - Org invite is now localized (en + nb) — was English-only. The "inviter name" prefix is rendered when the controller can resolve the inviting user.
  - `apps/backend/src/auth/email-templates.ts` deleted; OSS auth flow now calls into `@getmunin/emails`.
  - `MUNIN_EMAIL_LOGO_URL` env (optional) overrides the raven asset URL — useful for self-hosters that don't want the request to leave their network.
  - Self-host setting: BetterAuth's `sendResetPassword` and `sendVerificationEmail` hooks now produce HTML mail in addition to text.
  - OSS dashboard gains `(auth)/forgot-password` and `(auth)/reset-password` pages (ported from cloud) plus a `(auth)/verify-email` landing page; "Forgot your password?" link added under the login password field. `auth.forgotPassword`, `auth.resetPassword`, and `auth.verifyEmail` i18n keys added to `dashboard-pages/src/messages/{en,nb}.json`.
  - @getmunin/db@4.23.4
  - @getmunin/types@4.23.4

## 4.23.3

### Patch Changes

- 57d7901: Fix `jwtIssuer()` for split MCP/auth host topologies — verify JWTs against `NEXT_PUBLIC_AUTH_URL`, not the MCP origin.

  `oauth-jwt.ts`'s `jwtIssuer()` derived the expected `iss` claim from `NEXT_PUBLIC_MCP_URL`. After PR #238 split `NEXT_PUBLIC_AUTH_URL` from `NEXT_PUBLIC_MCP_URL`, cloud's `mcp.getmunin.com` no longer matched the actual issuer (`https://api.getmunin.com`, set by `betterAuth({ baseURL: NEXT_PUBLIC_AUTH_URL, ... }).plugins[jwt({ issuer })]`). `jwtVerify(..., { issuer: jwtIssuer() })` rejected every valid Claude-issued token, so the OAuth dance completed cleanly but the first `/mcp` request 401'd. End-user symptom: "Authorization with the MCP server failed" reappearing after consent.

  `jwtIssuer()` now reads `NEXT_PUBLIC_AUTH_URL` (trim trailing slash) when set, falling back to the MCP origin only for OSS single-host deployments where AS and MCP share an origin.
  - @getmunin/db@4.23.3
  - @getmunin/types@4.23.3

## 4.23.2

### Patch Changes

- f0e5389: Security: close widget→admin escalation, SSRF in website-import, upload signing weaknesses, and control-plane authorization gaps.
  - Public `mn_widget_*` keys now resolve as a new `widget_agent` actor (not `admin_agent`), with audience forced to `self_service` and scopes narrowed to `conv:widget:write`. New `ControlPlaneGuard` rejects widget/end-user/partner actors and scoped admin keys (must have `*`) on `/v1/*` admin routes, so embedded widget keys can no longer mint, list, or revoke admin API keys, configure channels, or enqueue curator jobs.
  - Website-import enqueue and the underlying crawler validate URLs against private/loopback/link-local/cloud-metadata ranges. A new `safeFetch` helper enforces an undici dispatcher that re-validates the resolved IP at connect time (DNS-rebinding-safe) and walks redirects manually.
  - Local-storage upload signing switched from plain SHA-256 to HMAC-SHA256; `LocalFsStorage` throws on startup if `MUNIN_STORAGE_LOCAL_SECRET` is missing under `NODE_ENV=production`. Static asset serving sets `X-Content-Type-Options: nosniff`.
  - S3 uploads switched from presigned PUT to presigned POST with a `content-length-range` policy condition pinned to the declared size, so an oversized body is rejected by S3 itself. `cms_complete_asset_upload` HEADs the object and rejects (deleting the storage object) on size mismatch. `AssetStorage.presignedUpload` now returns `{ uploadUrl, uploadMethod, uploadFields, … }`; `AssetStorage.statBytes` is now required on the interface.

- Updated dependencies [f0e5389]
  - @getmunin/types@4.23.2
  - @getmunin/db@4.23.2

## 4.23.1

### Patch Changes

- @getmunin/db@4.23.1
- @getmunin/types@4.23.1

## 4.23.0

### Patch Changes

- @getmunin/db@4.23.0
- @getmunin/types@4.23.0

## 4.22.0

### Patch Changes

- @getmunin/db@4.22.0
- @getmunin/types@4.22.0

## 4.21.0

### Patch Changes

- @getmunin/db@4.21.0
- @getmunin/types@4.21.0

## 4.20.0

### Patch Changes

- Updated dependencies [cedba8d]
  - @getmunin/db@4.20.0
  - @getmunin/types@4.20.0

## 4.19.4

### Patch Changes

- @getmunin/db@4.19.4
- @getmunin/types@4.19.4

## 4.19.3

### Patch Changes

- @getmunin/db@4.19.3
- @getmunin/types@4.19.3

## 4.19.2

### Patch Changes

- @getmunin/db@4.19.2
- @getmunin/types@4.19.2

## 4.19.1

### Patch Changes

- @getmunin/db@4.19.1
- @getmunin/types@4.19.1

## 4.19.0

### Patch Changes

- @getmunin/db@4.19.0
- @getmunin/types@4.19.0

## 4.18.0

### Patch Changes

- @getmunin/db@4.18.0
- @getmunin/types@4.18.0

## 4.17.0

### Patch Changes

- @getmunin/db@4.17.0
- @getmunin/types@4.17.0

## 4.16.0

### Patch Changes

- @getmunin/db@4.16.0
- @getmunin/types@4.16.0

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
  - @getmunin/types@4.15.0

## 4.14.0

### Minor Changes

- 1fe1031: Make public-facing URLs configurable instead of hardcoding `api.munin.eu` / `docs.getmunin.com`.
  - `packages/docs-pages/src/page.tsx` and `_components/rest-endpoint.tsx`: the example `curl` URL is built from `process.env.NEXT_PUBLIC_API_URL` (defaulting to `http://localhost:3001`), matching the existing pattern in `guides/chat-widget/page.tsx`.
  - `packages/backend-core/scripts/generate-openapi.ts`: the OpenAPI spec's `servers[0]` is built from `MUNIN_OPENAPI_SERVER_URL` / `MUNIN_OPENAPI_SERVER_DESCRIPTION` (defaulting to `http://localhost:3001` / `local dev`). Cloud deploys set these at build time to render docs against the right host.
  - `packages/dashboard-pages/src/data/mcp-setups.ts`: `buildMcpSetups` takes an optional second `docsHost` argument; `MCP_SETUPS` keeps using the cloud-prod default. `get-started.tsx` reads `process.env.NEXT_PUBLIC_DOCS_URL` so dev points at `docs.dev.getmunin.com` and prod at `docs.getmunin.com`.

  Brand-attribution links (`getmunin.com` in the chat-widget "Powered by" footer, the web-crawler User-Agent) stay hardcoded — they identify Munin itself, not the deployment.

### Patch Changes

- @getmunin/db@4.14.0
- @getmunin/types@4.14.0

## 4.13.0

### Minor Changes

- 7977f92: Rename the env var `MUNIN_PUBLIC_URL` → `MUNIN_MCP_URL`.

  The old name didn't say what surface it pointed at; the new name is symmetric with `MUNIN_API_URL` and `MUNIN_WEB_URL` and reflects that the value is the canonical MCP resource URL (used by the JWT issuer, OAuth audience, bootstrap rewriter `→ /mcp`, RFC 9728 metadata, and the SMS/outreach webhook bases that piggyback on the backend's external host).

  **Breaking** — `process.env.MUNIN_PUBLIC_URL` is no longer read. Set `MUNIN_MCP_URL` instead. No backwards-compat alias (no production users yet). Internal constants `PUBLIC_URL_FALLBACK` and `DEFAULT_PUBLIC_URL` renamed to `MCP_URL_FALLBACK` / `DEFAULT_MCP_URL` for consistency.

  Cloud consumers should bump `@getmunin/*` and rename the env in their deployment config.

### Patch Changes

- @getmunin/db@4.13.0
- @getmunin/types@4.13.0

## 4.12.0

### Patch Changes

- @getmunin/db@4.12.0
- @getmunin/types@4.12.0

## 4.11.0

### Patch Changes

- @getmunin/db@4.11.0
- @getmunin/types@4.11.0

## 4.10.0

### Patch Changes

- @getmunin/db@4.10.0
- @getmunin/types@4.10.0

## 4.9.0

### Minor Changes

- 2ca3b4a: AgentHostRunner: realtime + chat MCP + curator workers now run fully in-process. Closes the prod 401-reconnect loop on stale admin API keys.

  **Why.** Prior to this change, the AgentHostRunner subscribed to realtime events over WebSocket (`/api/v1/realtime`) and made chat-side MCP calls over HTTP, both authenticated with a per-org admin API key. When that key drifted (e.g. an org was deleted but its `agent_configs.admin_api_key` row stuck around), the WebSocket 401'd every 30 seconds forever — observed in prod for `org_fgf0a6f1fwu6nfa6aq3xwf` at attempt 411+ before this fix. PR #211 had already moved the prompts/skills loader path in-process, but realtime + chat + curator stayed HTTP and kept burning.

  **What changed.**
  - New `RealtimeEventBus` provider in `@getmunin/backend-core/realtime`. Wraps `DbListenerService` so the same Postgres `NOTIFY munin_events` stream the WS gateway already consumes fans out to in-process subscribers with `{ orgId, endUserId? }` filtering identical to the gateway's. Adds an in-memory `publishConversationTyping` / `subscribeAgentTyping` channel for the runner-emitted typing signal (no DB write — typing is ephemeral). The gateway also subscribes to this and pushes to widget WS clients on the matching conversation channel.
  - New `openEndUserAgentMcpClient(...)` in `@getmunin/backend-core/agent/in-process-context.ts`. Mirrors the existing admin in-process opener but synthesizes an `end_user_agent` actor with `audience='self_service'`, the user's default org membership, and proper `applyTenancyGUCs(actor)` per call — so RLS still enforces end-user scoping even though the auth guard is bypassed.
  - New `buildEndUserAgentActor({ orgId, endUserId, scopes?, audiences? })` in `@getmunin/core`, sibling of `buildAdminAgentActor`.
  - `runner.service.ts`: `createRealtimeClient({ baseUrl, adminApiKey, … })` → `this.eventBus.subscribe({ orgId }, handlers)`. `openMcp: ({ delegatedToken }) => openHttpMcpClient(HTTP)` → `openMcp: ({ endUserId }) => openEndUserAgentMcpClient(IN-PROCESS)`. `realtime.sendConversationTyping(...)` → `eventBus.publishConversationTyping(orgId, ...)`. Curator workers and `runWebImportJob` now receive an in-process `AgentMcpClient` (built from `openAdminAgentMcpClient`) instead of opening their own HTTP MCP.
  - `conversation-handler.ts`: dropped `getDelegatedToken`, `tokenCache`, and the `TOKEN_REFRESH_MARGIN_MS` constant. The chat handler passes `endUserId` directly to `deps.openMcp` — no token mint, no REST round-trip per message. `mintDelegatedToken` REST endpoint stays for external callers (widget).
  - `runSkillPass`: signature dropped `baseUrl`/`adminApiKey`/`clientName`, added `mcp: McpToolHandle` + `skills: SkillReader`. No HTTP MCP connect.
  - `runWebImportJob`: signature dropped `baseUrl`/`adminApiKey`, added `mcp: McpToolHandle`. No HTTP MCP connect.

  **Naming sweep alongside.** The pre-existing public exports were asymmetric (`openAgentMcpClient` paired with the new `openDelegatedMcpClient`, plus a misleadingly-named `openMcpClient` for the HTTP transport). Renamed for clarity:
  - `openAgentMcpClient` → `openAdminAgentMcpClient`
  - `openDelegatedMcpClient` → `openEndUserAgentMcpClient`
  - `openMcpClient` (HTTP) → `openHttpMcpClient`

  Pairs now match `ActorType` and the transport is explicit. No external consumers yet, so safe.

  **What still requires the admin API key.** The REST control plane (`createMuninRestClient`) still goes over HTTP, since lifting Nest controllers in-process is a much larger refactor with low value for low-traffic config reads. The runner still bails if no admin key is configured — but the realtime/MCP/curator paths no longer depend on it.

  **Closes** the prod incident on stale admin keys for both the realtime intake and the per-message chat MCP path.

- f9a8e0f: OAuth bearer-token verification overhaul + MCP tool/skill title prefixes.

  **JWT access tokens.** Better Auth issues a signed JWT (not an opaque token) whenever the token request carries a `resource` indicator and the JWT plugin is enabled — and JWTs are **never** written to `oauth_access_token`; only the refresh token is. `CredentialResolver.resolveBearerToken` now detects the JWT shape, verifies it locally against the JWKS stored in the `jwks` table (per-`kid` in-memory cache), checks the issuer + audience, and builds an `ActorIdentity` from the `sub`, `scope`, and the user's default org membership. claude.ai web's MCP connector now resolves on the first `/mcp` call instead of 401-ing.

  **Audience tolerance.** External MCP clients normalize the resource indicator inconsistently — claude.ai sends `https://<host>/` even when our metadata advertises `https://<host>/mcp`. JWT audience is now matched against the canonical URL plus its trailing-slash, bare-origin, and origin-with-slash variants, so the same backend works for clients that drop the path or fiddle with the slash. The same variant set is applied to Better Auth's `validAudiences` config (`apps/backend/src/auth/auth.config.ts`) so the `/auth/oauth2/token` exchange accepts the same shapes.

  **Opaque-token hash fallback retained.** For installs that disable the JWT plugin (`disableJwtPlugin: true`), the opaque-token path still looks up `oauth_access_token.token` by `SHA-256(token)` (base64url), matching Better Auth's default `storeTokens: "hashed"`. Previously we compared the raw bearer against the column, which always missed.

  **MCP tool/skill titles get module prefixes.** Every `@McpTool({ title })` and every `skill://*` frontmatter title now starts with the module label (`KB:`, `Conv:`, `CRM:`, `CMS:`, `Outreach:`, `Web:`, `Playbook:`). In claude.ai's alphabetical tool picker, all KB tools cluster together, all CRM tools cluster together, etc. Duplicate module words were stripped from the body when the prefix made them redundant ("Read CRM segment" → "CRM: Read segment"). Internal tool _names_ (`kb_*`, `crm_*`, …) and skill URIs are unchanged — only the user-facing display titles moved.

  **Internal refactor.** Split JWT-only logic (JWKS load, key cache, audience variants, JWT verification) out of `credentials.ts` into a sibling `oauth-jwt.ts`. The `CredentialResolver` class stays the public entry point. Exports `oauthMcpResourceAudience` and `deriveAudiencesFromScopes` so the JWT path can reuse them.

  **Side-quests in the same PR.** OSS + cloud sign-in/sign-up pages resume the OAuth authorize flow after auth (so the MCP connector dance survives a fresh signup). The OAuth consent page reads `resp.url` (Better Auth's actual response field) in addition to `resp.redirect_uri`. AgentHostRunner resolves the singleton repository's literal id to a real `org_id` before opening its admin MCP client, so per-org RLS-bound writes don't hit a `kb_spaces_org_id_orgs_id_fk` FK violation.

### Patch Changes

- 8c1c3c9: Fix: `COMPANY_PROFILE_SPACE_SLUG` now matches where the web-import handler actually writes the scraped Company profile doc.

  Two constants pointed at different KB space slugs:
  - `web-import.handler.ts` wrote the "Company profile" doc into space `website-import`.
  - `prompts/index.ts` (`COMPANY_PROFILE_SPACE_SLUG`) looked for it in space `imported-from-website`.

  Same doc slug (`company-profile`), different space. Result: the PromptResolver's cache lookup never resolved the profile, `prompts.companyContext()` always returned `''`, and the `[Company context]\n…` block was never appended to the chat widget agent's system prompt. End-users asking "what does <company> do?" got generic answers because the scraped profile never reached the agent — even though the doc existed in the KB the whole time.

  Aligned `COMPANY_PROFILE_SPACE_SLUG` to `'website-import'` (the value the web-import handler actually uses). No data migration needed.
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

- @getmunin/db@4.8.0
- @getmunin/types@4.8.0

## 4.7.1

### Patch Changes

- @getmunin/db@4.7.1
- @getmunin/types@4.7.1

## 4.7.0

### Patch Changes

- 5108510: `MUNIN_PUBLIC_URL` is now the **canonical MCP resource URL** verbatim — no implicit `/mcp` appending. Adds an optional `MUNIN_API_URL` for a canonical REST URL.

  **Backend (`@getmunin/backend-core`)**
  - `mcpResourceUrl()` returns `MUNIN_PUBLIC_URL` exactly. `authorizationServerUrl()` (and `readPublicBaseUrl()`) return its origin.
  - New `publicUrlRewriteMiddleware` maps the canonical external URLs onto the internal Nest mount points — `/mcp` for MCP, `/api/v1` for REST. So a deploy can advertise `https://mcp.example.com` (no path) and `https://api.example.com/v1` while every controller stays mounted at its original internal path. Pass-through when the env vars name the same internal path (OSS default).
  - Adds `MCP_INTERNAL_PATH` (`'/mcp'`) and re-exports the old `MCP_RESOURCE_PATH` for back-compat.

  **Default change** — OSS default `MUNIN_PUBLIC_URL` is now `http://localhost:3001/mcp` (path included). Existing self-hosters who set `MUNIN_PUBLIC_URL=http://localhost:3001` (no path) will see their OAuth resource URL change from `…/mcp` to bare host — every active token will need refreshing. To keep the old behavior verbatim, set `MUNIN_PUBLIC_URL=http://localhost:3001/mcp`.

  **Dashboard (`@getmunin/dashboard-pages`)**
  - `GetStarted` fetches the canonical MCP URL from `/.well-known/oauth-protected-resource` and renders it in the Claude / ChatGPT / Gemini config snippets. OSS self-host now shows `http://localhost:3001/mcp` (or whatever the local backend advertises); cloud shows `mcp.getmunin.com`.
  - `mcp-setups.ts` ships a `buildMcpSetups(host)` helper alongside the static fallback.
  - @getmunin/db@4.7.0
  - @getmunin/types@4.7.0

## 4.6.1

### Patch Changes

- @getmunin/db@4.6.1
- @getmunin/types@4.6.1

## 4.6.0

### Patch Changes

- Updated dependencies [b770bce]
  - @getmunin/db@4.6.0
  - @getmunin/types@4.6.0

## 4.5.1

### Patch Changes

- @getmunin/db@4.5.1
- @getmunin/types@4.5.1

## 4.5.0

### Patch Changes

- @getmunin/db@4.5.0
- @getmunin/types@4.5.0

## 4.4.1

### Patch Changes

- @getmunin/db@4.4.1
- @getmunin/types@4.4.1

## 4.4.0

### Patch Changes

- @getmunin/db@4.4.0
- @getmunin/types@4.4.0

## 4.3.0

### Patch Changes

- @getmunin/db@4.3.0
- @getmunin/types@4.3.0

## 4.2.0

### Patch Changes

- @getmunin/db@4.2.0
- @getmunin/types@4.2.0

## 4.1.1

### Patch Changes

- @getmunin/db@4.1.1
- @getmunin/types@4.1.1

## 4.1.0

### Patch Changes

- de1a7a6: Load prompt-cache entries serially instead of via `Promise.all`. The previous burst could saturate the in-process MCP transport on cold start (especially when KB seeding is still in flight in the same session) and the parallel reads would all hit the MCP client's 60s timeout in a single instant. Serial load drains one request at a time and adds negligible wall-clock cost (sub-second for a handful of KB doc reads).
  - @getmunin/db@4.1.0
  - @getmunin/types@4.1.0

## 4.0.0

### Patch Changes

- @getmunin/db@4.0.0
- @getmunin/types@4.0.0

## 3.9.1

### Patch Changes

- @getmunin/db@3.9.1
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
  - @getmunin/db@3.9.0
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
  - @getmunin/db@3.8.0
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
  - @getmunin/db@3.7.0
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
  - @getmunin/db@3.6.0
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
  - @getmunin/db@3.5.0
  - @getmunin/types@3.5.0

## 3.4.1

### Patch Changes

- @getmunin/db@3.4.1
- @getmunin/types@3.4.1

## 3.4.0

### Patch Changes

- @getmunin/db@3.4.0
- @getmunin/types@3.4.0

## 3.2.1

### Patch Changes

- c5e93e1: Add a `development` package-export condition pointing at `./src/index.ts` (and `./src/schema.ts` for `@getmunin/db`). Loaders that resolve with `--conditions=development` (e.g. the OSS backend's new `node --import @swc-node/register/esm-register --watch --conditions=development src/main.ts` dev script) see the TypeScript source directly; the existing `types` → `dist/*.d.ts` and `default` → `dist/*.js` resolution paths are unchanged, so production runtime, typecheck, and downstream consumers that don't opt into the condition keep their current behavior.
- Updated dependencies [c5e93e1]
  - @getmunin/db@3.2.1
  - @getmunin/types@3.2.1

## 3.2.0

### Patch Changes

- @getmunin/db@3.2.0
- @getmunin/types@3.2.0

## 3.1.0

### Patch Changes

- @getmunin/db@3.1.0
- @getmunin/types@3.1.0

## 3.0.0

### Major Changes

- e5a5450: Migrate from the deprecated `oidcProvider` (in-tree better-auth plugin) to the published `@better-auth/oauth-provider`. The OAuth schema changes from 3 tables to 4 (`oauth_client`, `oauth_access_token`, `oauth_refresh_token`, `oauth_consent`) plus a `jwks` table for the JWT plugin. RFC 8707 resource indicators are now native via `validAudiences`, JWT access tokens replace opaque tokens for resource-bound flows, and the consent page contract switches from `consent_code` to a signed `oauth_query`. The dashboard consent page is fully localized (en + nb).

  Breaking: any deployment with rows in the old `oauth_applications` / `oauth_access_tokens` / `oauth_consents` tables will lose them — Munin OAuth has not been deployed anywhere yet, so this is a no-op in practice.

### Patch Changes

- Updated dependencies [e5a5450]
  - @getmunin/db@3.0.0
  - @getmunin/types@3.0.0

## 2.5.1

### Patch Changes

- @getmunin/db@2.5.1
- @getmunin/types@2.5.1

## 2.5.0

### Patch Changes

- @getmunin/db@2.5.0
- @getmunin/types@2.5.0

## 2.4.0

### Minor Changes

- 009846d: feat(oauth): RFC 8707 resource indicators (Phase 3)

  OAuth-issued access tokens are now bound to a resource URL (`<MUNIN_PUBLIC_URL>/mcp`). The `AuthGuard` enforces audience match: a token whose `audience` doesn't equal the request's resource is rejected with 401.

  `@getmunin/core`: `ResolvedCredential` gains an `audience` field. `CredentialResolver.resolveBearerToken()` populates it for OAuth-issued tokens (`oauth_access_tokens` lookups) and leaves it undefined for API keys + delegated tokens (which bypass audience binding because the issuer is the resource server).

  `@getmunin/backend-core`: `OAuthResourceController` advertises `resource_indicators_supported: true` in the protected-resource metadata. `AuthGuard.canActivate()` rejects credentials whose `audience` doesn't match `mcpResourceUrl()` for `/mcp/*` requests, with the same `WWW-Authenticate` header semantics from Phase 1.

  Single-resource simplification for v1: every OAuth token is bound to the MCP resource URL, computed from `MUNIN_PUBLIC_URL`. When a second resource ships, the binding becomes per-token (set at issuance from the `resource` parameter in the authorize / token request).

### Patch Changes

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
  - @getmunin/types@2.3.0

## 2.2.0

### Patch Changes

- @getmunin/db@2.2.0
- @getmunin/types@2.2.0

## 2.1.0

### Patch Changes

- @getmunin/db@2.1.0
- @getmunin/types@2.1.0

## 2.0.0

### Patch Changes

- @getmunin/db@2.0.0
- @getmunin/types@2.0.0

## 1.0.0

### Patch Changes

- @getmunin/db@1.0.0
- @getmunin/types@1.0.0

## 0.25.0

### Patch Changes

- @getmunin/db@0.25.0
- @getmunin/types@0.25.0

## 0.24.1

### Patch Changes

- @getmunin/db@0.24.1
- @getmunin/types@0.24.1

## 0.24.0

### Patch Changes

- @getmunin/db@0.24.0
- @getmunin/types@0.24.0

## 0.23.3

### Patch Changes

- @getmunin/db@0.23.3
- @getmunin/types@0.23.3

## 0.23.2

### Patch Changes

- @getmunin/db@0.23.2
- @getmunin/types@0.23.2

## 0.23.1

### Patch Changes

- @getmunin/db@0.23.1
- @getmunin/types@0.23.1

## 0.23.0

### Patch Changes

- Updated dependencies [88b1bc3]
  - @getmunin/db@0.23.0
  - @getmunin/types@0.23.0

## 0.22.0

### Minor Changes

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

### Patch Changes

- Updated dependencies [355856a]
- Updated dependencies [ebda56e]
  - @getmunin/db@0.22.0
  - @getmunin/types@0.22.0

## 0.21.0

### Patch Changes

- @getmunin/db@0.21.0
- @getmunin/types@0.21.0

## 0.20.0

### Patch Changes

- @getmunin/db@0.20.0
- @getmunin/types@0.20.0

## 0.19.0

### Patch Changes

- Updated dependencies [f57a86b]
  - @getmunin/db@0.19.0
  - @getmunin/types@0.19.0

## 0.18.0

### Patch Changes

- @getmunin/db@0.18.0
- @getmunin/types@0.18.0

## 0.17.0

### Minor Changes

- db26079: Adds a self-service-agent availability indicator to the dashboard. The realtime gateway now tracks live subscribers whose audiences include `self_service` (excluding end-user widgets) per org. New endpoint `GET /api/overview/agent-status` returns `{ selfServiceAgentSubscriberCount, lastInboundEndUserMessageAt, lastAgentMessageAt }`. Overview page renders a card showing connected/not-connected, and surfaces a warning state when there's no agent connected and end-user messages are unanswered. Solves the OSS bootstrapping confusion where a self-hoster's chat widget delivers messages into the void with no UI signal that nothing is listening on the agent side.

  Adds an `audiences` jsonb column on `api_keys` (default `['admin']`) and the credential resolver now reads it instead of hardcoding the audience set. This lets a key be minted with `audiences: ['admin', 'self_service']` so its realtime subscriptions are recognised as self-service-agent connections. Backwards compatible — existing rows default to admin-only.

### Patch Changes

- Updated dependencies [db26079]
  - @getmunin/db@0.17.0
  - @getmunin/types@0.17.0

## 0.16.1

### Patch Changes

- Updated dependencies [cd2ba29]
  - @getmunin/db@0.16.1
  - @getmunin/types@0.16.1

## 0.16.0

### Patch Changes

- @getmunin/db@0.16.0
- @getmunin/types@0.16.0

## 0.15.0

### Patch Changes

- Updated dependencies [b7b7644]
  - @getmunin/db@0.15.0
  - @getmunin/types@0.15.0

## 0.14.0

### Patch Changes

- @getmunin/db@0.14.0
- @getmunin/types@0.14.0

## 0.13.0

### Patch Changes

- @getmunin/db@0.13.0
- @getmunin/types@0.13.0

## 0.12.0

### Patch Changes

- @getmunin/db@0.12.0
- @getmunin/types@0.12.0

## 0.11.0

### Patch Changes

- @getmunin/db@0.11.0
- @getmunin/types@0.11.0

## 0.10.0

### Patch Changes

- @getmunin/db@0.10.0
- @getmunin/types@0.10.0

## 0.9.1

### Patch Changes

- @getmunin/db@0.9.1
- @getmunin/types@0.9.1

## 0.9.0

### Patch Changes

- @getmunin/db@0.9.0
- @getmunin/types@0.9.0

## 0.8.0

### Patch Changes

- @getmunin/db@0.8.0
- @getmunin/types@0.8.0

## 0.7.0

### Patch Changes

- @getmunin/db@0.7.0
- @getmunin/types@0.7.0

## 0.6.0

### Patch Changes

- Updated dependencies [1aaaa24]
  - @getmunin/db@0.6.0
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
  - @getmunin/types@0.5.0

## 0.4.0

### Patch Changes

- @getmunin/db@0.4.0
- @getmunin/types@0.4.0

## 0.3.1

### Patch Changes

- fe8fd21: TenancyInterceptor: bypass RLS for `actor.type === 'partner'`.

  Partner actors (in a downstream package) operate across multiple orgs they
  provisioned. Their controllers filter manually by `partner_id`. OSS
  never produces `'partner'` actors, so this branch is dead code there.

- Updated dependencies [fe8fd21]
  - @getmunin/db@0.3.1
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
  - @getmunin/db@0.3.0
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
  - @getmunin/db@0.2.0
  - @getmunin/types@0.2.0
