# @getmunin/backend-core

## 4.56.1

### Patch Changes

- @getmunin/core@4.56.1
- @getmunin/db@4.56.1
- @getmunin/types@4.56.1
- @getmunin/mcp-toolkit@4.56.1
- @getmunin/agent-runtime@4.56.1
- @getmunin/emails@4.56.1

## 4.56.0

### Minor Changes

- 2d69094: Recover chat replies when the in-memory NOTIFY misses a live runner. A widget/chat reply was driven purely by an in-process `conversation.message.received` event reaching a subscribed runner; if no runner was resident when the NOTIFY fired (cold start, restart, scale-to-zero, dropped listener), the reply was silently lost because nothing durable recorded that one was owed.

  The runner now also drives replies from a durable recovery set: `GET /v1/conversations/awaiting-reply` returns open, auto-mode, unassigned, non-voice conversations whose latest non-internal message is from the visitor. The agent host sweeps this on every (re)spawn — the same on-boot drain that lets the curator queue survive scale-to-zero — and on each reconcile tick, re-driving anything that slipped through. Already-answered and staff-handled threads are excluded, and the existing `shouldRespond` + conversation-claim + `sinceMessageId` guards keep a redundant trigger a no-op, so no duplicate replies.

### Patch Changes

- Updated dependencies [2d69094]
- Updated dependencies [373d29e]
- Updated dependencies [ccbc3a4]
  - @getmunin/agent-runtime@4.56.0
  - @getmunin/emails@4.56.0
  - @getmunin/core@4.56.0
  - @getmunin/db@4.56.0
  - @getmunin/types@4.56.0
  - @getmunin/mcp-toolkit@4.56.0

## 4.55.0

### Patch Changes

- @getmunin/core@4.55.0
- @getmunin/db@4.55.0
- @getmunin/types@4.55.0
- @getmunin/mcp-toolkit@4.55.0
- @getmunin/agent-runtime@4.55.0
- @getmunin/emails@4.55.0

## 4.54.0

### Patch Changes

- @getmunin/core@4.54.0
- @getmunin/db@4.54.0
- @getmunin/types@4.54.0
- @getmunin/mcp-toolkit@4.54.0
- @getmunin/agent-runtime@4.54.0
- @getmunin/emails@4.54.0

## 4.53.0

### Minor Changes

- c3a62e1: Add host extensibility hooks for the agent runner and provider configuration:
  - Rate-limit counters can be incremented by an arbitrary amount (`record(bucket, amount)`); add monthly `ai_tokens` and per-minute `ai_generates` buckets.
  - The usage summary (`/v1/usage/summary`) reports monthly AI token usage, surfaced as a tile on the usage and overview pages.
  - Agent passes can report a `quota_exceeded` skip outcome.
  - The agent host accepts an optional provider factory, credential resolver, and pre-generate gate via `runnerOptions`. The gate is consulted for both live chat and scheduled background work (distinguished by a `trigger` argument), so a host can supply its own provider implementation and meter or limit usage per org without forking the runner.
  - The provider picker accepts host-supplied presets — including a credential-less "managed" preset that renders host content and clears the org key on selection — plus a default selection. The AI settings and usage pages accept an optional content slot.

- 95f2983: Prioritize interactive onboarding work over background curator jobs. Curator jobs now carry a `priority` (default `0`), and the claim path orders by `priority DESC, next_attempt_at ASC` so a user-initiated website import (`task://web/scrape-website`, priority `100`) is claimed ahead of a backlog of older scheduled `skill://` sweeps instead of waiting behind them. Priority is derived centrally via `priorityFor(uri)` and can be overridden per-enqueue; a partial index keeps the claim path index-served.
- 82fef68: Redesign the onboarding "Lift-off" summary's website-import section into three real states — importing, failed, and succeeded — driven by live crawl progress.

  The web crawler now emits incremental progress (`{ total, done, recentPaths }`) as it reads pages; the runner persists it to a new nullable `curator_jobs.progress` column (throttled, best-effort), and the curator-job DTO surfaces it via `GET /v1/curator/jobs/:id`. The summary screen polls that to show a live `done / total` counter, a progress bar, and the paths being read while importing; the imported page count and duration on success; and the failure reason plus an inline **Retry import** on failure. A new internal `POST /v1/curator/jobs/:id/progress` endpoint backs the out-of-process runner path.

  Also align the full-screen loading screens with the page background: `AuthLoading` (and the root route loader) now paint `bg-bone` so the loader no longer flashes the lighter paper surface before the bone-backed page resolves.

### Patch Changes

- Updated dependencies [c3a62e1]
- Updated dependencies [95f2983]
- Updated dependencies [82fef68]
  - @getmunin/agent-runtime@4.53.0
  - @getmunin/types@4.53.0
  - @getmunin/db@4.53.0
  - @getmunin/core@4.53.0
  - @getmunin/mcp-toolkit@4.53.0
  - @getmunin/emails@4.53.0

## 4.52.1

### Patch Changes

- @getmunin/core@4.52.1
- @getmunin/db@4.52.1
- @getmunin/types@4.52.1
- @getmunin/mcp-toolkit@4.52.1
- @getmunin/agent-runtime@4.52.1
- @getmunin/emails@4.52.1

## 4.52.0

### Minor Changes

- e0a87c0: Replace the one-way data export with bidirectional per-module import/export.

  Removes the dashboard "Data export" page and `GET /v1/export`. Adds symmetric
  `*_export` / `*_import` MCP tools and `/v1/<module>/export|import` REST endpoints
  for KB, CRM, CMS, Conversations, Outreach, and Analytics so an agent can move an org's data
  between a self-hosted server and the cloud in either direction. Imports upsert by
  natural key where one exists and return an `idMap` for foreign-key remapping;
  embeddings are regenerated on import; secrets are redacted and re-entered on the
  target; CMS asset bytes are copied to the target's storage. Adds
  `skill://playbooks/data-migration`.

### Patch Changes

- 72869c4: Fix Threll in-browser (webrtc) voice calls dropping their transcript, recording/analysis, and mid-call tools. Widget voice/start now passes `{ conversationId, endUserId }` as web-call metadata, which Threll echoes back on every `call.*` webhook, so transcript/tool/ended events resolve to the conversation the visitor is viewing. The adapter also skips conversation creation for `webrtc` `call.worker_request` hooks (which fire before voice/start has linked the call and carry no correlation data — they'd otherwise mint a phantom conversation on the voice channel) and falls back to an org-wide `threllCallId` lookup so resolution still works for calls placed before the metadata round-trip is available.
- Updated dependencies [e0a87c0]
  - @getmunin/core@4.52.0
  - @getmunin/agent-runtime@4.52.0
  - @getmunin/mcp-toolkit@4.52.0
  - @getmunin/db@4.52.0
  - @getmunin/types@4.52.0
  - @getmunin/emails@4.52.0

## 4.51.4

### Patch Changes

- @getmunin/core@4.51.4
- @getmunin/db@4.51.4
- @getmunin/types@4.51.4
- @getmunin/mcp-toolkit@4.51.4
- @getmunin/agent-runtime@4.51.4
- @getmunin/emails@4.51.4

## 4.51.3

### Patch Changes

- 139d00e: feat(channels): pick voice options from a dropdown, discover them over MCP, and dedup the Threll webhook

  Setting up a voice channel no longer makes you hand-type opaque ids. For Threll you now enter just the API key and press Continue — the account is resolved from the key (via `GET /v1/accounts/current`, since a key maps 1:1 to an account) and the dialog fetches that account's workers into a dropdown; nothing is persisted until you pick a worker and confirm, so cancelling leaves no channel and no webhook subscription behind. Vapi follows the same two-step shape: enter the API key (and optional public key / phone number id), press Continue, then pick the assistant from a dropdown — no more hand-typed assistant id. Edit dialogs load the same dropdowns from the channel's stored credentials.

  The Threll account ID is no longer required input anywhere (MCP `conv_configure_channel` / control-plane / dashboard) — it's derived from the key when omitted (still accepted as an optional override, and re-derived if the API key is rotated on edit). It's still persisted and shown as a chip on the channel row.

  Option discovery is exposed generically so agents get parity with the dashboard: a new `conv_list_channel_options` MCP tool returns a vendor's selectable options (Threll `workers`, Vapi `assistants`) as `{ value, label, hint }` groups — pass `vendor` + credentials before the channel exists, or `channelId` for an existing one. Adding discovery for a new vendor is just a `listOptions` method on its `ChannelAdminProvider`. The control plane exposes the same via `POST /v1/conversations/channels/options` and `POST /v1/conversations/channels/:id/options`.

  Threll webhook auto-setup now lists the account's existing subscriptions and reuses a matching one's signing secret instead of blindly creating another. The post-setup "webhook URL" screen is gone — Munin registers the webhook with Threll automatically.

  Vapi now auto-configures its webhook too: on create, Munin points the chosen assistant's `server` at the channel's webhook URL (with the shared-secret header) — but only when that server is unset or already a Munin URL, so it never clobbers an assistant you've wired elsewhere (in which case it falls back to the manual connection screen). The prior server config is stashed and restored when the channel is archived, via a new best-effort `onArchive` provider hook.

  When auto-setup would collide with an existing webhook, Munin now asks instead of failing. Threll rejects a second account-wide `*` subscription, and Vapi's server URL may already point elsewhere — in both cases setup now returns a `409 webhook_conflict` and the dashboard shows a "Replace existing webhook?" confirm. Confirming retries with `replaceWebhook: true` (Threll deletes the conflicting subscription and registers its own; Vapi overwrites the assistant's server URL); cancelling goes back with nothing changed. The flag is exposed on `conv_configure_channel` too, so agents can resolve the conflict the same way.

  Internal: the Threll and Vapi HTTP clients now route every call through one `request` helper that centralizes auth headers, timeouts, and status→error mapping; the dashboard `ApiError` now surfaces the response `code` so callers can branch on `webhook_conflict`.

- 0cc9260: fix(widget): probe voice availability without minting a provider session

  Opening a widget conversation used to call `POST /v1/widget/voice/start` purely to decide whether to show the call button. For Threll-backed voice channels that has a side effect — it creates a web call upfront (and overwrites `threllCallId`), so every conversation open burned a Threll session that was never connected to, then a second one was minted when the visitor actually started the call.

  The availability check now has its own cheap endpoint, `GET /v1/widget/voice/available`, which runs the same validation and voice-channel routing as `voice/start` but stops at a vendor config presence check — it never creates a Threll web call or fetches a Vapi assistant. The widget's open-time probe calls it instead of `voice/start`; `voice/start` now fires only when the visitor actually starts a call.

- Updated dependencies [5018e2b]
- Updated dependencies [139d00e]
  - @getmunin/core@4.51.3
  - @getmunin/types@4.51.3
  - @getmunin/agent-runtime@4.51.3
  - @getmunin/mcp-toolkit@4.51.3
  - @getmunin/db@4.51.3
  - @getmunin/emails@4.51.3

## 4.51.2

### Patch Changes

- 657b2bf: fix(realtime): fan out typing indicators across backend replicas

  Typing indicators (the widget "writing" bubble) were delivered only within a single Node process, so with multiple backend replicas they were lost in production: the AI agent runner (a per-org singleton) and a human operator's dashboard connection usually live on a different replica than the one holding the visitor's WebSocket.

  Typing now travels over a Postgres `NOTIFY agent_typing` channel — the same cross-replica backplane already used for messages. The originating replica still delivers locally (preserving sender-exclusion and the auto-clear timer); a per-instance id on the payload prevents the origin from double-delivering its own echo, while every other replica fans the event out to its own connected clients. Covers all three directions: agent → visitor, human operator → visitor, and visitor → operator.
  - @getmunin/core@4.51.2
  - @getmunin/db@4.51.2
  - @getmunin/types@4.51.2
  - @getmunin/mcp-toolkit@4.51.2
  - @getmunin/agent-runtime@4.51.2
  - @getmunin/emails@4.51.2

## 4.51.1

### Patch Changes

- @getmunin/core@4.51.1
- @getmunin/db@4.51.1
- @getmunin/types@4.51.1
- @getmunin/mcp-toolkit@4.51.1
- @getmunin/agent-runtime@4.51.1
- @getmunin/emails@4.51.1

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
  - @getmunin/core@4.51.0
  - @getmunin/db@4.51.0
  - @getmunin/types@4.51.0
  - @getmunin/mcp-toolkit@4.51.0
  - @getmunin/emails@4.51.0

## 4.50.1

### Patch Changes

- d612e6a: Patch security-vulnerable dependencies. Bump nodemailer to ^8.0.9 (CRLF header injection, OAuth2 TLS certificate validation) and ws to ^8.21.0 (memory-exhaustion DoS), and force patched transitive versions of hono, form-data, multer, @opentelemetry/core, and @babel/core via pnpm overrides.
- Updated dependencies [d612e6a]
  - @getmunin/core@4.50.1
  - @getmunin/agent-runtime@4.50.1
  - @getmunin/mcp-toolkit@4.50.1
  - @getmunin/db@4.50.1
  - @getmunin/types@4.50.1
  - @getmunin/emails@4.50.1

## 4.50.0

### Minor Changes

- 3dafe87: Add the `kb_import_website` MCP tool so admin agents can initiate a knowledge-base website scrape directly over `/mcp`. Previously the `task://web/scrape-website` job could only be enqueued via the `/v1/curator/jobs` control-plane endpoint (driven from the dashboard's website-import card). The new tool wraps that enqueue: it takes a homepage URL (bare domains accepted), validates it is publicly reachable, and returns the curator job id. Re-importing a URL with a scrape still pending returns the in-flight job instead of starting a second one. A companion `kb_import_website_status` tool lets the agent poll that job id for progress (pending / done / failed) and the imported-document summary.

  The company-profile synthesis is now optional. The web-import handler reads a `synthesizeCompanyProfile` flag from the job's `sourceEventPayload` (defaulting to `true` when absent, so the dashboard onboarding flow is unchanged), and `kb_import_website` exposes it as a parameter. Set `synthesizeCompanyProfile: false` when importing third-party or topic pages so the import doesn't overwrite the company-profile document (slug `company-profile`) — which seeds the chat widget — with unrelated content.

- 3f034de: Auto-provision the Threll webhook subscription when creating a Threll voice channel.

  Munin now uses the Threll API key to register the webhook subscription with Threll (`POST /accounts/{accountId}/webhook-subscriptions`, `eventType: "*"`) and stores the signing secret Threll returns — the admin no longer generates a secret and pastes it into Threll. Provisioning happens atomically during channel create: the channel id is minted up front and the Threll call runs before the row is inserted, so if provisioning fails nothing is persisted and the dashboard shows a retry-only error. The webhook URL is built from the canonical server-side API base (`readApiBaseUrl()` / `MUNIN_API_URL`). The webhook signing secret is now Threll-owned and immutable, so the manual webhook-secret field is removed from the Threll create and edit dialogs. `ConfigureThrellBody` and the Threll MCP configure tool no longer accept `webhookSecret` on create. The Vapi flow is unchanged.

### Patch Changes

- Updated dependencies [3f034de]
  - @getmunin/types@4.50.0
  - @getmunin/core@4.50.0
  - @getmunin/db@4.50.0
  - @getmunin/mcp-toolkit@4.50.0
  - @getmunin/agent-runtime@4.50.0
  - @getmunin/emails@4.50.0

## 4.49.0

### Minor Changes

- 2b8fd7d: Auto-feed the tenant's API base URL (and org id) to MCP agents so coding-agent platforms (Lovable, Bolt, v0, …) stop asking for it. The resolved API origin is now stated in the MCP server instructions, and `{{API_URL}}` / `{{ORG_ID}}` placeholders in skill bodies are substituted at `skills_read` / `resources/read` time from the authenticated session. The frontend-integration playbook now tells agents to use the provided value instead of asking the operator.

### Patch Changes

- 38f4775: Fix CMS draft review 404: the admin `GET /v1/cms/drafts/:id` route was shadowed by the public delivery wildcard `GET /v1/cms/:orgId/:collectionSlug`. Both are 4-segment routes that match `/v1/cms/drafts/<id>`, and the public controller was registered first (first-match-wins), so draft reads resolved to `resolveOrg("drafts")` and 404'd before reaching the auth-guarded handler. `CmsDraftsController` is now registered before `CmsDeliveryController`.
- f13f5c5: Flush MCP responses only after the request's tenant transaction commits.

  `TenancyInterceptor` wraps each authenticated request in a transaction, but the MCP controller's `transport.handleRequest` writes the JSON-RPC response to the socket from inside that transaction — so the response (and any returned data, e.g. a freshly minted tracker key) reached the client before the write committed. A client that immediately used the result against another endpoint could read-after-write through a separate DB connection and miss the not-yet-committed row.

  The MCP POST handler now buffers its (stateless, JSON) response and flushes it via a new `RequestContext.afterCommit` hook that `TenancyInterceptor` runs once the transaction has committed. GET (SSE streaming) is unaffected. This removes a read-after-write race that surfaced as a flaky analytics tracker integration test.

- Updated dependencies [2b8fd7d]
- Updated dependencies [f13f5c5]
  - @getmunin/mcp-toolkit@4.49.0
  - @getmunin/core@4.49.0
  - @getmunin/agent-runtime@4.49.0
  - @getmunin/db@4.49.0
  - @getmunin/types@4.49.0
  - @getmunin/emails@4.49.0

## 4.48.0

### Minor Changes

- dc70c67: Automatically triage new inbound conversations with a topic and a title.
  - New `skill://conv/set-topic-and-title` curator skill (fast tier, `conv_` tools): reads a freshly-created conversation, tags it with the best-fitting topic (creating one only when confident none fit), and gives it a short title when it has no subject yet.
  - New `conv_set_subject` MCP tool (admin, `conv:write`) so the skill can title conversations that arrive without a subject (chat, SMS, voice). Email subjects are left untouched.
  - The job is enqueued on the first inbound end-user message across every channel: email (new thread), generic webhook channels, the chat widget, and `conv_*`/control-plane conversation creation. A per-conversation dedupe key keeps it idempotent.

### Patch Changes

- Updated dependencies [dc70c67]
- Updated dependencies [2954d34]
  - @getmunin/types@4.48.0
  - @getmunin/mcp-toolkit@4.48.0
  - @getmunin/core@4.48.0
  - @getmunin/db@4.48.0
  - @getmunin/agent-runtime@4.48.0
  - @getmunin/emails@4.48.0

## 4.47.0

### Minor Changes

- 4b889cf: Rename MCP tools for naming consistency. The dominant convention is `<module>_<verb>_<object>`; these tools deviated and have been renamed:
  - `crm_propose_merge_candidate` → `crm_propose_merge` (the other merge tools all say "proposal", not "candidate")
  - conv channel admin (verb/object order): `conv_channel_configure` → `conv_configure_channel`, `conv_channel_test` → `conv_test_channel`, `conv_channel_send_test` → `conv_send_channel_test`
  - conv email: `conv_email_setup_channel` → `conv_setup_email_channel`, `conv_email_test_channel` → `conv_test_email_channel`, `conv_email_send_test` → `conv_send_email_test`
  - voice ("call", not voice/phone split): `conv_voice_call` → `conv_call_channel`, `conv_voice_call_contact` → `conv_call_contact`
  - end-user self-service (drop awkward possessive/suffix): `crm_log_activity_self` → `crm_log_my_activity`, `conv_request_handover_in_my_conversation` → `conv_request_human`, `conv_request_phone_call_for_my_conversation` → `conv_request_callback`
  - analytics report tools (add the verb the rest of the surface uses): `analytics_top_subjects` → `analytics_list_top_subjects`, `analytics_top_countries` → `analytics_list_top_countries`, `analytics_traffic_by_source` → `analytics_get_traffic_by_source`, `analytics_referrer_hosts` → `analytics_list_referrer_hosts`, `analytics_views_over_time` → `analytics_get_views_over_time`, `analytics_subject_engagement` → `analytics_get_subject_engagement`, `analytics_contact_journey` → `analytics_get_contact_journey`, `analytics_zero_result_searches` → `analytics_list_zero_result_searches`

  Breaking for MCP clients pinned to the old tool names.

- 448953f: Rename REST control-plane routes for naming consistency, following the same
  `<module>/<resource>` + spelled-out-verb conventions used across the rest of the `/v1` surface:
  - `v1/cms-drafts/*` → `v1/cms/drafts/*` (nest under the module like `crm/segments`, `kb/spaces`)
  - `v1/curation/jobs/*` → `v1/curator/jobs/*` (match the module name; frees "curation" to mean only the KB-nested qualifier)
  - `v1/curator/jobs/:id/ack` → `:id/acknowledge` (match `system/alerts/:id/acknowledge`; no more clipped verb)
  - `v1/admin/audit-logs` → `v1/audit-logs` (drop the lone `admin/` tier — every other admin resource sits directly under `v1/`)
  - feedback "reject" → "dismiss" to match the proposal-queue convention (`dismiss` everywhere else): REST `v1/feedback/:id/reject` → `:id/dismiss`, **and** the MCP tool `feedback_reject` → `feedback_dismiss`.

  The two controllers that both mounted `v1/usage` are merged into a single `UsageController`
  (routes unchanged — non-breaking).

  Breaking for REST clients pinned to the old paths and MCP clients pinned to `feedback_reject`.
  No deprecation aliases.

### Patch Changes

- Updated dependencies [4b889cf]
- Updated dependencies [448953f]
  - @getmunin/agent-runtime@4.47.0
  - @getmunin/core@4.47.0
  - @getmunin/mcp-toolkit@4.47.0
  - @getmunin/db@4.47.0
  - @getmunin/types@4.47.0
  - @getmunin/emails@4.47.0

## 4.46.0

### Minor Changes

- bfb850e: Replace per-vendor voice/SMS channel admin MCP tools with a generic, registry-driven surface that scales as vendors are added.
  - New `ChannelAdminProvider` contract: each configurable voice/SMS vendor registers one provider (config schema + capabilities + configure/test/call/sendTest), dispatched by `ChannelAdminService`.
  - Generic MCP tools replace the per-vendor ones: `conv_list_channel_vendors` (discovery — lists each vendor's config fields), `conv_channel_configure`, `conv_channel_test`, `conv_voice_call`, `conv_channel_send_test`. Removed `conv_{vapi,threll}_configure/test_channel/call_initiate` and `conv_{twilio,messagebird}_sms_configure/test_channel/send_test` (and `conv_voice_call_initiate`).
  - Generic `/v1/conversations/channels` control-plane endpoints (`GET /vendors`, `POST /`, `POST /:id/{test,call,send-test}`); the existing per-vendor endpoints are retained for the dashboard.
  - Adding a voice/SMS vendor now means registering one provider — no new tools, endpoints, or types. Email and the chat widget keep their bespoke tools.

- 1892d75: Add a Threll voice channel (`type: voice`, `vendor: threll`), mirroring the Vapi integration.
  - `conv_threll_configure` / `conv_threll_test_channel` / `conv_threll_call_initiate` MCP tools and `/v1/conversations/channels/threll*` control-plane endpoints.
  - Webhook adapter handling Threll's `call.worker_request` (returns dynamic instructions + self-service tools + correlation metadata), `call.tool_call` (dispatches MCP tools, returns the result), `call.transcript`, `call.status_update`, and `call.ended`. Inbound deliveries are authenticated via the `X-Threll-Signature` HMAC-SHA256.
  - Conversations are correlated by Threll `callId` (`metadata.threllCallId`), with a matching unique index.
  - In-browser widget voice now works for Threll via Threll's web-call endpoint. The widget-voice bundle gains a generic `WebRtcVoiceSession` (vendor-agnostic peer connection / media / state) driven by a pluggable `SignalingChannel`, with a `threll` signaling adapter — so any SDK-less vendor can be added by registering one adapter. `WidgetVoiceService` is now vendor-aware (Vapi SDK descriptor vs. Threll WebRTC descriptor).

### Patch Changes

- @getmunin/core@4.46.0
- @getmunin/db@4.46.0
- @getmunin/types@4.46.0
- @getmunin/mcp-toolkit@4.46.0
- @getmunin/agent-runtime@4.46.0
- @getmunin/emails@4.46.0

## 4.45.1

### Patch Changes

- @getmunin/core@4.45.1
- @getmunin/db@4.45.1
- @getmunin/types@4.45.1
- @getmunin/mcp-toolkit@4.45.1
- @getmunin/agent-runtime@4.45.1
- @getmunin/emails@4.45.1

## 4.45.0

### Minor Changes

- c1b4b58: Add `MUNIN_AUTH_COOKIE_PREFIX` (and a `cookiePrefix` option on `createMuninAuthCore`) to namespace BetterAuth session cookies per environment. Set a distinct prefix on deployments that share a registrable domain (e.g. apex prod + dev subdomain) so the prod apex-domain cookie no longer shadows the dev session cookie under the same name and breaks sign-in. The auth guard, realtime gateway, and invitation-accept cookie parsers all derive their accepted cookie names from the same prefix.

### Patch Changes

- @getmunin/core@4.45.0
- @getmunin/db@4.45.0
- @getmunin/types@4.45.0
- @getmunin/mcp-toolkit@4.45.0
- @getmunin/agent-runtime@4.45.0
- @getmunin/emails@4.45.0

## 4.44.1

### Patch Changes

- ea18794: Make every MCP tool declare exactly one of `readOnlyHint: true` / `destructiveHint: true`, as required by Anthropic's MCP directory submission policy.

  Anthropic's review process expects each tool to be unambiguously read-only or destructive so Claude can auto-permission reads while still prompting for writes. Most tools already carried the hints, but ~100 writes only had `destructiveHint: false` (the default) and a handful of writes in `system-alerts` and `feedback` had no hints at all. This sweep flips every write to `destructiveHint: true` and adds explicit hints to `system_alerts_acknowledge`, `system_alerts_resolve`, `feedback_create`, `feedback_approve`, and `feedback_vote`.

  Adds a registry-level integration test (`tools-smoke`) that boots the full Nest app and asserts every admin tool sets exactly one of the two hints, plus a name-length check against Anthropic's 64-character directory limit, so regressions fail CI instead of slipping through review.

  No behavior change for callers — the `/v1/public/mcp-tools` controller already derived a richer `danger` flag from these hints, so consumers will now see `danger: 'destructive'` where they previously saw `danger: 'writes'` for create/update operations.
  - @getmunin/core@4.44.1
  - @getmunin/db@4.44.1
  - @getmunin/types@4.44.1
  - @getmunin/mcp-toolkit@4.44.1
  - @getmunin/agent-runtime@4.44.1
  - @getmunin/emails@4.44.1

## 4.44.0

### Minor Changes

- 10ae30e: Refuse to mint or update widget channels and analytics trackers with an empty origin allowlist when the corresponding `MUNIN_*_REQUIRE_ALLOWLIST` env is on.

  Previously the env flag was only consulted at request time deep in `enforceOriginAllowlist`, so an admin (or agent) could mint a key with an empty allowlist, see the dashboard render it as "any origin", and only discover at the first browser request that every origin gets a 403. The dashboard's "any origin" pill was particularly misleading on backends with the flag on — it meant "blocks everything" but read as "permissive".

  `conv_widget_create_channel`, `conv_widget_update_channel`, `analytics_create_tracker`, and `analytics_update_tracker` now reject empty `originAllowlist` / `allowedOrigins` with `BadRequestException('origin_allowlist_required: …')` when the env flag is on. Update tools only check when the caller is actively changing the list (passing `undefined` to leave it as-is still works, so existing channels aren't retroactively broken — they're just blocked at the request edge as before until someone explicitly fixes them).

- 10ae30e: Pin playbooks to the top of the MCP "Frequently relevant" skills list, and point scaffolding tools at the frontend-integration playbook.

  Coding-agent platforms (Lovable, Bolt, v0, Replit, Cursor) routinely scaffold a frontend against Munin without reading `skill://playbooks/frontend-integration`, then re-discover the same gotchas (CMS CORS, embed paths, host probing). The skill exists and is registered, but two things hid it: (1) the MCP server-instructions `Frequently relevant` block picked the first 6 admin skills alphabetically by URI, which is all `analytics/*` and `cms/*` — playbooks sit at position 28+; (2) agents that skip `resources/list` and read only tool descriptions never see a pointer.
  - `mcp.skill-registry.service.ts` now pins all `skill://playbooks/*` first, then fills the remainder alphabetically, and bumps the cap from 6 to 8 so non-playbook skills still appear.
  - `conv_widget_create_channel`, `analytics_create_tracker`, and `cms_list_collections` descriptions now reference `skill://playbooks/frontend-integration` so agents that skip resource discovery still get nudged.

- 70d50ed: Add tracker key rotation for analytics trackers.

  Settings → Channels has long exposed a "Rotate key" action that revokes the active `mn_widget_*` key and mints a fresh one. Settings → Analytics trackers had no equivalent — only the identity-verification secret could be rotated, leaving operators stuck with `analytics_revoke_tracker` + `analytics_create_tracker` (which loses the tracker's name and config) if a `mn_track_*` key leaked.

  Adds the missing symmetric action:
  - New `analytics_rotate_tracker_key` MCP tool that revokes the tracker's active `mn_track_*` keys and mints a fresh one.
  - New `POST /v1/analytics/trackers/:id/rotate-key` endpoint.
  - Dashboard now shows "Rotate tracker key" above "Rotate identity secret" on each tracker row, with a one-time copy dialog matching the channels flow.

### Patch Changes

- @getmunin/core@4.44.0
- @getmunin/db@4.44.0
- @getmunin/types@4.44.0
- @getmunin/mcp-toolkit@4.44.0
- @getmunin/agent-runtime@4.44.0
- @getmunin/emails@4.44.0

## 4.43.2

### Patch Changes

- @getmunin/core@4.43.2
- @getmunin/db@4.43.2
- @getmunin/types@4.43.2
- @getmunin/mcp-toolkit@4.43.2
- @getmunin/agent-runtime@4.43.2
- @getmunin/emails@4.43.2

## 4.43.1

### Patch Changes

- @getmunin/core@4.43.1
- @getmunin/db@4.43.1
- @getmunin/types@4.43.1
- @getmunin/mcp-toolkit@4.43.1
- @getmunin/agent-runtime@4.43.1
- @getmunin/emails@4.43.1

## 4.43.0

### Minor Changes

- 3858d3e: Link analytics tracking to CRM contacts and chat conversations through a shared `end_users` identity.

  Until now the analytics tracker, the chat widget, and the CRM lived in three separate identity silos: `analytics_view_events` carried only an opaque `visitor_id`, while the widget and CRM both spoke `end_users.id`. A visitor's page-view history stayed orphaned even when they later identified themselves in chat or signed in.

  This change introduces an `analytics_visitor_identities` bridge table mapping `(org_id, visitor_id) → end_user_id`, and a denormalised `end_user_id` column on both event tables that the analytics service stamps at ingest time. Two write paths populate the bridge:
  - **Widget**: `findOrCreateEndUser` in `widget-ingest.service.ts` now upserts the bridge whenever a chat session carries a `visitorId`. The chat widget and the analytics tracker now share the same `localStorage` key (`mn.vid`), so a visitor who first opens the widget retroactively links their already-stored tracker visitor id.
  - **Tracker**: new `POST /v1/a/identify` endpoint plus a `window.mn.identify(externalId, userHash)` method on the tracker bundle. Identity is verified by HMAC against a per-tracker secret; mint one via `analytics_create_tracker` (returned once) or rotate with the new `analytics_rotate_tracker_identity_secret` tool. Tampered hashes are rejected silently.

  Query tools now accept an optional `endUserId` / `contactId` filter (`analytics_views_over_time`, `analytics_subject_engagement`, `analytics_top_subjects`), and a new `analytics_contact_journey` tool returns the chronological page-view + search timeline for a known visitor. Past anonymous rows stay orphaned — there is no retroactive backfill.

  The dashboard gains a **Settings → Analytics trackers** page that lists trackers, mints new ones (with the public key + identity secret revealed once), shows whether identity verification is configured, and lets admins rotate the identity secret or revoke the tracker without dropping to MCP tools.

  The tracker bundle gains a script-tag identity path (`data-external-id` + `data-user-hash`), matching the chat widget's embed shape. The runtime `window.mn.identify()` call remains as the SPA escape hatch.

  The chat widget gets a matching runtime identity path: `window.munin.identify(externalId, userHash)` posts to a new `POST /v1/widget/identify` endpoint. When an anonymous chat session identifies mid-flight, the backend migrates the conversation: the verified `end_users` row replaces the `anon:…` one, the contact's `metadata.externalId` is updated, and the analytics bridge is rewritten — so the same browser's prior page-views attach to the now-known visitor without losing the chat history.

- d3c5d6f: Three new skill markdown surfaces aimed at coding agents wiring a fresh frontend (Lovable, Bolt, Replit, v0, Cursor, Claude Code) to a Munin tenant:
  - **`skill://playbooks/frontend-integration`** — end-to-end playbook covering the chat widget embed, analytics tracker embed, and live CMS delivery in one pass. Codifies the failures every coding agent currently hits cold: wrong API host (`munin.app` vs `api.getmunin.com`), legacy `/embed/widget.js` path, missing `data-munin-host` / `data-widget-key` / `data-channel-id` attributes, `originAllowlist` mis-set for preview origins, and the `Access to fetch … blocked by CORS policy` on `/v1/cms/*` that only resolves via server-side proxying. Resolves the host via `NEXT_PUBLIC_API_URL` / `VITE_API_URL` / etc. with per-framework table; explicit about empty-allowlist semantics under `MUNIN_WIDGET_REQUIRE_ALLOWLIST` / `MUNIN_TRACKER_REQUIRE_ALLOWLIST` (open-by-default in OSS dev, fail-closed in prod when set).
  - **`skill://webhooks/subscribe-to-events`** — first markdown skill for the webhooks module. Walks through event-type selection, signed receiver implementation (HMAC-SHA256 verification with constant-time compare, raw-body capture per framework), idempotency via `x-munin-delivery-id`, 15s ack budget, and `webhooks_list_deliveries` for audit. Common patterns include forwarding `conversation.message.sent` into a widget UI over your own SSE/WebSocket, rebuilding a static site on `cms.entry.published`, and Slack-on-`crm.deal.stage_changed`.
  - **`skill://cms/design-collection`** — the missing prequel to `migrate-content` and `publish-entry`. Catalogues all 14 field types with editor/storage shapes, walks through localization decisions, field-order-as-render-order, the two-pass setup for circular references, and the lossy semantics of `cms_update_collection` (drop = data orphaned but preserved in jsonb; rename = catastrophic without manual migration). Includes archetype sketches for blog, author, product, FAQ, and landing-page section collections.

  Docs renderer (`@getmunin/docs-pages`):
  - Enable `remark-gfm` so skill markdown tables and other GitHub-flavored syntax render correctly. Previously pipe-tables in `track-website-traffic.md` and the new skills collapsed into single paragraphs.
  - New `renderSkillContent` helper substitutes `{{API_URL}}` in skill markdown with `NEXT_PUBLIC_API_URL` (falls back to `http://localhost:3001` for OSS dev). Lets prose show the live host while preserving `${API_URL}` inside real JS template literals in code samples.

### Patch Changes

- Updated dependencies [3858d3e]
  - @getmunin/db@4.43.0
  - @getmunin/types@4.43.0
  - @getmunin/core@4.43.0
  - @getmunin/mcp-toolkit@4.43.0
  - @getmunin/agent-runtime@4.43.0
  - @getmunin/emails@4.43.0

## 4.42.0

### Minor Changes

- 15d6ed4: Three new admin MCP tools for the analytics surface, covering the breakdowns that previously required raw SQL against `analytics_view_events`:
  - `analytics_traffic_by_source` — views + visitors grouped by `utm_source` / `utm_medium` / `utm_campaign`. The all-NULL row is the direct/organic bucket; compare against named-campaign rows to gauge campaign lift.
  - `analytics_referrer_hosts` — views + visitors grouped by the host portion of `referrer`, with an optional `excludeHost` argument so internal navigations don't drown out external referrals. Direct/`rel=noreferrer` traffic rolls into a single `host: null` bucket.
  - `analytics_views_over_time` — daily view + unique-visitor counts over a recent window, zero-filled per UTC day so days with no traffic appear as `views: 0`. Pin to a single page via `subjectId`. The single best input for "did this launch / campaign / outage move the needle?".

  Each tool mirrors the existing `analytics_top_*` shape (sinceDays / limit / optional subjectType + source filters) and is gated by `analytics:read`. The skill at `skill://analytics/track-website-traffic` now demonstrates all three under "Query the data", and the `mn.track(...)` custom-event section has concrete patterns (funnel steps, SPA route changes with dwell, scroll milestones) instead of a single example.

### Patch Changes

- Updated dependencies [205e1eb]
  - @getmunin/db@4.42.0
  - @getmunin/core@4.42.0
  - @getmunin/agent-runtime@4.42.0
  - @getmunin/mcp-toolkit@4.42.0
  - @getmunin/types@4.42.0
  - @getmunin/emails@4.42.0

## 4.41.1

### Patch Changes

- 360b7d4: Fix tracker beacons being silently dropped when the payload contains JSON `null` for optional fields.

  The `BeaconBodySchema` in `analytics-tracker.controller.ts` declared every optional field as `z.string().optional()` (or the numeric equivalent), which Zod treats as `string | undefined` — JSON `null` fails validation. The controller then `return`s on `safeParse → !success` without logging, so the event is silently dropped.

  The deployed `@getmunin/analytics-tracker` bundle sends `null` (not `undefined`) for at least:
  - `referrer` — on direct navigation (`document.referrer === ''` → bundle normalizes to `null`)
  - `visitorId` — when `localStorage` throws or returns `null` (private windows, embedded WebViews, locked-down enterprise browsers)

  So real traffic from refreshes, bookmarks, direct URL bar entries, and a chunk of mobile/private-mode visits has been disappearing since the schema was tightened in #362.

  Fix: make every optional field `.nullable().optional()`. The downstream `recordView` already accepts `null | undefined` interchangeably (uses `??`), so no service-side changes needed. Integration test now sends an all-null payload and asserts the row lands.

- e9ec27d: `AnalyticsTrackerController` now logs a `warn` line when a pixel query or beacon body fails Zod validation. Previously both ingest paths silently returned (pixel → 200 GIF, beacon → 204) on validation failure, which hid schema-vs-bundle mismatches: clients saw "success" while no row landed. The fix in #406 was discovered exactly this way — having backend logs surface these from the start would have caught it weeks earlier. Log messages are `pixel.validation_failed: <reason>` and `beacon.validation_failed: <reason>`.
  - @getmunin/core@4.41.1
  - @getmunin/db@4.41.1
  - @getmunin/types@4.41.1
  - @getmunin/mcp-toolkit@4.41.1
  - @getmunin/agent-runtime@4.41.1
  - @getmunin/emails@4.41.1

## 4.41.0

### Minor Changes

- 145dbd9: Add optional server-side country resolution on `analytics_view_events`.
  - New nullable `country` column (ISO 3166-1 alpha-2) on `analytics_view_events`. Backfill is not done — historical rows stay NULL.
  - New `GeoIpService` (in `@getmunin/backend-core`) wraps a local MaxMind-format `.mmdb` reader via the `maxmind` npm package. The reader memory-maps the file at boot, so per-request lookups are O(µs) and involve no network calls.
  - The `AnalyticsTrackerController` resolves `req.ip` to a country at both the pixel (`GET /v1/a/t/:key.gif`) and beacon (`POST /v1/a/t`) ingest paths. The IP is consumed only here and never persisted — only the 2-char country lands on the row.
  - New MCP tool `analytics_top_countries` for the visitors-by-country query.
  - Zero-config by default: without `MUNIN_GEOIP_DB_PATH` set, `GeoIpService` logs `geoip.disabled` at boot and returns null for every lookup, so ingest still works and the column simply stays NULL. With the env var pointing at a valid `.mmdb`, country starts populating immediately.

  No dependency on a hosted geo API — the lookup happens entirely in-process. Both MaxMind GeoLite2-Country and DB-IP Country Lite are compatible file formats.

### Patch Changes

- Updated dependencies [145dbd9]
  - @getmunin/db@4.41.0
  - @getmunin/core@4.41.0
  - @getmunin/agent-runtime@4.41.0
  - @getmunin/mcp-toolkit@4.41.0
  - @getmunin/types@4.41.0
  - @getmunin/emails@4.41.0

## 4.40.4

### Patch Changes

- 335d67f: Fix `analytics_subject_engagement` and `analytics_zero_result_searches` crashing with `r.last_view_at.toISOString is not a function` (and the analogous `last_seen_at` error) when the query returns any row.

  Both tools use raw SQL via `ctx.db.execute(sql\`…\`)` to compute aggregate timestamps (`MAX(created_at)`). That path bypasses Drizzle's column type-mapping, so postgres-js returns the value as an ISO string rather than a `Date`. The tools then called `.toISOString()`on the string and threw.`analytics_subject_engagement`was unusable on real data;`analytics_zero_result_searches` was latent (only happened when at least one zero-result search had been recorded).

  Fix is two-line per tool: coerce with `new Date(...)` before serialising. The widened TS type (`Date | string`) reflects what the driver actually returns. Integration test covers the read-side path now so this doesn't regress.

- ed2161a: Add `skill://analytics/track-cms-views` — a dedicated playbook for the `_tracking` block that every CMS delivery response already ships. Explains how the pre-signed pixel/beacon tokens work, when to use the pixel vs. beacon embed, how to query `analytics_top_subjects` / `analytics_subject_engagement` with `subjectType='cms_entry'`, what to do (and not do) about pepper rotation, and how the flow differs from the website tracker. Also fixes the dead "Related" link in `skill://analytics/track-website-traffic` that previously pointed at `skill://cms/publish-entry` and reframes the website-vs-CMS distinction for headless deployments.
  - @getmunin/core@4.40.4
  - @getmunin/db@4.40.4
  - @getmunin/types@4.40.4
  - @getmunin/mcp-toolkit@4.40.4
  - @getmunin/agent-runtime@4.40.4
  - @getmunin/emails@4.40.4

## 4.40.3

### Patch Changes

- 1fe3019: Add `skill://analytics/track-cms-views` — a dedicated playbook for the `_tracking` block that every CMS delivery response already ships. Explains how the pre-signed pixel/beacon tokens work, when to use the pixel vs. beacon embed, how to query `analytics_top_subjects` / `analytics_subject_engagement` with `subjectType='cms_entry'`, what to do (and not do) about pepper rotation, and how the flow differs from the website tracker. Also fixes the dead "Related" link in `skill://analytics/track-website-traffic` that previously pointed at `skill://cms/publish-entry` and reframes the website-vs-CMS distinction for headless deployments.
- 1fe3019: Fix the analytics tracker beacon failing with `ERR_FAILED` / `Access-Control-Allow-Credentials` errors in production browsers.

  `navigator.sendBeacon` always sends with `credentials: 'include'` (no opt-out), and the previous bundle wrapped its JSON body in a `Blob` with type `application/json`. Since `application/json` is not in the CORS-safelisted Content-Type set, the browser issued a CORS preflight. The beacon endpoint sits under `/v1/a/*`, which `bootstrap-app.ts` treats as a public-CORS path — those echo the request `Origin` but deliberately omit `Access-Control-Allow-Credentials: true` (per CORS spec: wildcard-style origin handling is incompatible with credentials). The preflight therefore failed, and the actual POST never happened. The pixel route (`GET /v1/a/t/:key.gif`) was unaffected because GETs without custom headers don't preflight.

  Coupled fix:
  - **Bundle (`apps/analytics-tracker/src/tracker.ts`)**: emit the body as `text/plain;charset=UTF-8`. That's CORS-safelisted, so `navigator.sendBeacon` (and the `fetch` no-cors fallback) send the request without a preflight, while cookies still come along — the server doesn't read them anyway.
  - **Server (`packages/backend-core/src/bootstrap-app.ts`)**: widen the JSON body parser to also accept `text/plain` bodies. The parser still does `JSON.parse`, so the controller's `@Body() rawBody: unknown` keeps the same shape and the existing Zod schema does the rest. No other endpoints rely on receiving raw `text/plain` today, so the wider type list is a safe extension.

  Integration test updated to use `text/plain;charset=UTF-8` so it exercises the production code path; the `beaconDenied` test still uses `application/json` to keep that path covered.
  - @getmunin/core@4.40.3
  - @getmunin/db@4.40.3
  - @getmunin/types@4.40.3
  - @getmunin/mcp-toolkit@4.40.3
  - @getmunin/agent-runtime@4.40.3
  - @getmunin/emails@4.40.3

## 4.40.2

### Patch Changes

- @getmunin/core@4.40.2
- @getmunin/db@4.40.2
- @getmunin/types@4.40.2
- @getmunin/mcp-toolkit@4.40.2
- @getmunin/agent-runtime@4.40.2
- @getmunin/emails@4.40.2

## 4.40.1

### Patch Changes

- 706d8c9: CodeQL cleanup: drop the `Math.random` session-id fallback in the chat widget (modern browsers always have `crypto.randomUUID`/`getRandomValues`), tighten the HTML-stripping regexes used by the web crawler and widget email fallback so nested/whitespaced `</script>` tags don't slip through, and rejection-sample in `makeId` to remove the modulo bias on the cryptographic random source.
- 09c75ea: `GET /v1/oauth/clients/:id` now returns `icon_url` as an absolute URL (e.g. `https://api.example.com/v1/oauth/clients/<id>/icon`) instead of a same-origin relative path. The consent page renders the icon via an `<img>` tag on the _web_ origin, so when the API and web are on different origins (any deployment where backend ≠ web, including the standard cloud `api.getmunin.com` / `app.getmunin.com` split), the browser was requesting the icon from the wrong origin and falling back to the placeholder square. The base URL is taken from `authorizationServerUrl()` — the same env (`NEXT_PUBLIC_AUTH_URL` / `NEXT_PUBLIC_MCP_URL`) that drives every other public OAuth URL — so single-process OSS deployments where backend and web share an origin still render correctly.
- Updated dependencies [706d8c9]
  - @getmunin/agent-runtime@4.40.1
  - @getmunin/db@4.40.1
  - @getmunin/core@4.40.1
  - @getmunin/mcp-toolkit@4.40.1
  - @getmunin/types@4.40.1
  - @getmunin/emails@4.40.1

## 4.40.0

### Minor Changes

- f8e82f2: OAuth consent page redesigned end-to-end. Three concrete changes:
  1. **Backend — enriched client lookup.** `GET /v1/oauth/clients/:id` now returns `{ client_id, name, uri, icon_url, redirect_uri_host, created_at }`. `name` falls back to a host-derived label when the client's DCR didn't include `client_name` (well-known hosts like `claude.ai`/`chatgpt.com`/`cursor.sh` get a branded label; anything else falls back to the bare host). `redirect_uri_host` is the host portion of the first registered redirect URI — the full URI stays off the wire.
  2. **Backend — favicon proxy.** New `GET /v1/oauth/clients/:id/icon` route. Server-side fetches `oauth_client.icon` if present, otherwise `https://<redirect_uri_host>/favicon.ico` using `safeFetch` (SSRF-guarded). Validates MIME (`image/*` only), caps response size, falls back to a generic SVG on any failure. Served from our origin with a 24h browser cache — keeps the user's IP off third-party hosts pre-authorization.
  3. **Frontend — SSR refactor + new layout.** The page is now an async server component (`apps/web/.../consent/page.tsx`) that fetches the enriched client info before render. The fixed CORS bug along the way: cookies are no longer sent on the lookup (closes the `Access-Control-Allow-Credentials` failure path that was leaving the page stuck on the raw `client_id`). New three-state machine (`new` / `granted` / `denied`) with intermediate result panes — instead of redirecting immediately on Authorize/Deny, the page shows a brief "Access granted/denied · Returning to claude.ai…" panel with spinner, then redirects. Layout matches the editorial design: serif headline that shifts copy per state, identity card with app icon, trust-timeline strip, grouped per-module permissions with `Read`/`Write` pills, reassurance block, and an actions footer.

  Also adds an `anonymous: true` opt-out on the `api()` helper for callers of `@PublicController` endpoints that shouldn't send the BetterAuth session cookie.

  i18n strings in `en.json` and `nb.json` updated to match the new copy; the keys are different from before (`title`, `lede`, `scopesLabel`, etc. reshaped — see the keys under `dashboard.oauthConsent`).

- 67c91c3: Add `resource_name` and `resource_logo_uri` to the OAuth Protected Resource Metadata at `/.well-known/oauth-protected-resource`. Lets MCP clients (Claude.ai connector cards, etc.) display "Munin" plus an icon instead of a generic globe when the resource endpoint serves JSON-only responses.
- 014b431: Add `analytics:read` and `analytics:write` to `SUPPORTED_SCOPES`. The analytics MCP tools (`analytics_create_tracker`, `analytics_list_trackers`, `analytics_top_subjects`, etc.) have been declaring those scopes in their `@McpTool` decorators since the module landed, but the OAuth supported-scopes registry never picked them up. That meant OAuth tokens could never carry the analytics scopes, so every external call (e.g. from a ChatGPT connector) hit _"Missing required scope: analytics:read"_ at the dispatch guard — even though the tools showed up in `tools/list`. Internal `buildAdminAgentActor` callers were unaffected because they use the `*` wildcard.

  `SELF_SERVICE_SCOPES` (delegated end-user tokens) is intentionally not changed — analytics is admin surface, in the same bucket as `cms:write` / `outreach:write` / etc. that end-user tokens never see.

### Patch Changes

- 547a97b: Drop the legacy `oauth_clients` (plural) table and its dormant FK column `tokens.oauth_client_id`.

  `oauth_clients` predates the BetterAuth OAuth provider plugin we adopted in migration 0017/0018. Since then the real OAuth client model has lived in `oauth_client` (singular) — that's the table the consent page reads from, the table DCR writes into, and the table FK'd by `oauth_access_token` / `oauth_refresh_token` / `oauth_consent`. The legacy `oauth_clients` was kept around because `tokens.oauth_client_id` had an FK pointing at it, but nothing has ever written either side: BetterAuth uses its own table, and `tokens.oauth_client_id` has only ever held NULL.

  Both `oauth_clients` and `tokens.oauth_client_id` were verified empty in dev and prod before the drop. The new migration `0037_drop_legacy_oauth_clients.sql` drops the FK, the column, the index, and the table; `src/sql/rls.sql` loses the matching RLS block; `schema.ts` loses the `oauthClients` export and the `oauthClientId` field on `tokens`.

  No application-level changes — nothing referenced the dropped column or table.

- e166c78: Align three MCP tool titles with their function names, so the display label tracks the operation the tool actually performs:
  - `cms_upload_asset_from_base64`: _"Upload small asset inline (base64)"_ → _"Upload asset from base64"_. Matches the `from_url` / `from_base64` taxonomy and stops the title from making a separate size claim from what the description already documents.
  - `outreach_propose_initial`: _"Propose an initial draft"_ → _"Propose initial"_. Drops the wording the function name doesn't carry.
  - `outreach_propose_reply`: _"Propose an reply draft"_ → _"Propose reply"_. Same cleanup; also fixes the _"an reply"_ grammar slip.

  No tool name / arguments / behavior changes.

- 8e4dee8: `tools/list` now intersects the caller's scopes with each tool's required `scopes`, in addition to the existing audience filter. Previously the list returned every audience-matched tool regardless of whether the caller actually held the scopes needed to invoke it — so a connector advertising `analytics:read` would happily list `analytics_*` tools to an OAuth caller whose token didn't carry that scope, and the model would only discover the mismatch by wasting a turn on a `"Missing required scope: ..."` error.

  After this change, `listTools` (and therefore the MCP `tools/list` response) only returns tools where every scope in `tool.meta.scopes` is held by the actor — including the existing `*` wildcard short-circuit, so internal `buildAdminAgentActor` callers are unaffected. Tools with `scopes: []` (like the feedback module) remain visible to everyone in the audience.

  `callTool` is unchanged — defense-in-depth scope check at dispatch time still fires if a caller invokes a hidden tool by name.

- Updated dependencies [547a97b]
- Updated dependencies [8e4dee8]
  - @getmunin/db@4.40.0
  - @getmunin/mcp-toolkit@4.40.0
  - @getmunin/core@4.40.0
  - @getmunin/agent-runtime@4.40.0
  - @getmunin/types@4.40.0
  - @getmunin/emails@4.40.0

## 4.39.0

### Minor Changes

- 1b757bc: CMS: drop `cms_upload_asset_from_file` (the `openai/fileParams`-based upload tool) and bring back the inline base64 path under a clearer name. The from-file tool didn't survive contact with ChatGPT's Apps SDK runtime — the `openai/fileParams` substitution only fires for files the user explicitly attached to the conversation, never for image-gen outputs that live in the sandbox's `/mnt/data`. ChatGPT's host clamps every such call client-side, so they never reach the server.

  The replacement is `cms_upload_asset_from_base64` (renamed from the previously-removed `cms_upload_asset_bytes`), with a tightened 100 KB decoded-size cap (down from 2 MB). The framing in the tool description is explicit about the use case: generated-in-conversation assets that need to land in the CMS without leaving the chat — compress to WebP/JPEG well under 100 KB first, then pass the bytes inline. Anything bigger should go through `cms_upload_asset_from_url`.

  Also reworded `cms_request_asset_upload`'s description to call out that it requires a client capable of issuing raw HTTP PUT/POST itself, with a forward pointer to the inline-base64 and from-URL tools for runtimes that don't have that primitive. This is a generic constraint, not a ChatGPT-specific carve-out.

  Service-side: the `uploadAssetFromFile` method is gone (had no other callers). `uploadAssetBytes` is renamed to `uploadAssetFromBase64` to match the new tool surface; the control-plane CMS drafts controller and the service tests are updated accordingly.

### Patch Changes

- @getmunin/core@4.39.0
- @getmunin/db@4.39.0
- @getmunin/types@4.39.0
- @getmunin/mcp-toolkit@4.39.0
- @getmunin/agent-runtime@4.39.0
- @getmunin/emails@4.39.0

## 4.38.0

### Minor Changes

- 0110a7e: MCP dispatch now records redacted `args` on every audit row — including the `denied`, `invalid_input`, `rate_limited`, and thrown-handler paths that previously dropped the args. The success path is unchanged. The `invalid_input` row also now carries the Zod error message in its `error` column instead of just the literal string `"invalid_input"`. Caller-controlled args on `unknown_tool` are still dropped (no schema available to redact against).

  A new optional `captureException` hook on `createMcpServer` / `openInProcessMcpClient` receives any error thrown by a tool handler, along with the tool name, actor identity (type / id / orgId), and redacted args. `mcp-toolkit` remains observability-vendor agnostic.

  `@getmunin/backend-core` exposes the wiring: a new `ErrorReporterModule` registers a `NoopErrorReporter` against the `ERROR_REPORTER` injection token. `McpController` injects it and forwards thrown handler errors. Hosts that want Sentry (or any other reporter) replace the provider for `ERROR_REPORTER` with their own `ErrorReporter` subclass — `apps/backend` does this with a `SentryErrorReporter` that uses `Sentry.withScope` to attach the tool / actor / args context.

  The `cms_upload_asset_from_url` / `cms_upload_asset_from_file` error path now walks the `Error.cause` chain when an outbound fetch fails, so the surfaced message includes the underlying error code (e.g. `ENOTFOUND`, `ECONNRESET`, `CERT_HAS_EXPIRED`) instead of undici's opaque `"fetch failed"`. The unwrapping helper lives in `@getmunin/core` as `describeError(err, maxDepth?)` so other callers of `safeFetch` (and anywhere else cause-chain visibility matters) can reuse it.

  `describeError` also replaces three sites that previously surfaced only `err.message`: the webhook delivery worker (`webhook_deliveries.error` — visible to customers via `webhooks_list_deliveries`), `@getmunin/agent-host`'s models fetcher, and `@getmunin/agent-runtime`'s web crawler. Each of those had its own local `describe(err)` helper that did the inferior version.

### Patch Changes

- Updated dependencies [0110a7e]
  - @getmunin/mcp-toolkit@4.38.0
  - @getmunin/core@4.38.0
  - @getmunin/agent-runtime@4.38.0
  - @getmunin/db@4.38.0
  - @getmunin/types@4.38.0
  - @getmunin/emails@4.38.0

## 4.37.0

### Minor Changes

- bb39ece: Replace `cms_upload_asset_bytes` with `cms_upload_asset_from_file`, a ChatGPT-native upload path.

  The base64-bytes tool didn't work for any realistic image from ChatGPT workspace agents — JSON-encoded base64 blew past the tool-call token budget around 2–3 MB. The new tool declares `_meta["openai/fileParams"]: ["file"]` so ChatGPT hands the server a short-lived signed download URL for a file already in the conversation; the backend fetches it through the existing `safeFetch` + SSRF + 50 MB cap path. Accepts `image/*`, `video/*`, `audio/*`, and `application/pdf`; SVG rejected.

  The `uploadAssetBytes` service method is kept (the dashboard's `/v1/cms/drafts/:id/assets` REST endpoint still uses it); only the MCP tool was removed.

  Also: `@McpTool` now accepts an optional `_meta` bag that flows through to `tools/list` entries, so any module can attach OpenAI Apps-SDK metadata (or future MCP extensions) without changing the toolkit.

- 8e88ac1: Export `RateLimitService`, `RateLimitExceededError`, and the `Bucket` type
  from the public surface so downstream backends (notably the cloud
  `QuotasService` override) can record into `rate_limit_counters` directly.

### Patch Changes

- Updated dependencies [bb39ece]
  - @getmunin/mcp-toolkit@4.37.0
  - @getmunin/core@4.37.0
  - @getmunin/db@4.37.0
  - @getmunin/types@4.37.0
  - @getmunin/agent-runtime@4.37.0
  - @getmunin/emails@4.37.0

## 4.36.0

### Minor Changes

- 15796b9: Move MCP burst protection from `rate_limit_counters` to an in-memory token bucket per replica. `McpBurstGuard` enforces `MUNIN_MCP_BURST_PER_MIN` (default 60) per `(org_id || ip)` within a rolling minute window, throwing 429 on overflow. `RateLimitService.consume()` no longer bumps a `mcp_calls_minute` bucket; that bucket and its check are removed, along with `OrgLimits.perMinute` and the per-minute view in `usage()`. The daily cap is unchanged.

  Trade-off: multi-replica fleets no longer enforce a fleet-global per-minute cap — each pod independently allows up to `MUNIN_MCP_BURST_PER_MIN`. Adequate for runaway-agent protection (abusers don't load-balance themselves) and eliminates ~1440 rows/day/org of accumulating minute-bucket data.

  Breaking shape change: `/v1/usage` no longer returns a `minute` field. Dashboard and any consumer scripts that read it need to drop that key.

- de1b520: Strip SaaS-flavored code from `@getmunin/backend-core`'s quotas surface. The OSS module is now an abstract `QuotasService` (`assertCanAdd`, `recordCall`) plus a `DefaultQuotasService` that no-ops both. All tier numbers, the `MUNIN_QUOTAS_ENABLED` switch, the `FREE_TIER_QUOTAS` map, the `TABLE_FOR` row-count helpers, and the `cap` / `count` abstract methods are gone — those belong to whoever runs the SaaS, not to the OSS library.

  Concretely:
  - `QuotaCallKind` type removed (was `'mcp_tool' | 'api_request'` — cloud billing vocabulary). `recordCall(kind, key?)` now takes `kind: string`.
  - `cap()` and `count()` removed from the abstract — only `CloudQuotasService` used them, and it still has them as concrete methods on the subclass.
  - `DefaultQuotasService.assertCanAdd` is a no-op (previously executed row counts when `MUNIN_QUOTAS_ENABLED=true`).
  - `MUNIN_QUOTAS_ENABLED` env var no longer read; removed from `.env.example`.

  Coordinated cloud change: `@munin-cloud/quotas` must replace `import type { QuotaCallKind } from '@getmunin/backend-core'` with its existing local `CallKind` union from `@munin-cloud/plans` (or just `string`), and delete the now-pointless `_CallKindMatchesBackend` compile-time assertion. The existing `CloudQuotasService` row-count and tier logic continues to apply unchanged — it's just no longer a partial duplicate of code that was shipping in OSS.

### Patch Changes

- c3feb08: Move the `/v1/usage/summary` apiCalls tile off `audit_log` onto a dedicated `api_calls_day` bucket in `rate_limit_counters`. The `AuditInterceptor` now calls `RateLimitService.record('api_calls_day')` for any non-MCP HTTP request from a non-user actor (mirrors the previous query's filters: skips `HEAD`/`OPTIONS`, `/mcp*`, dashboard browser sessions, and the same chatty polling GETs that audit already skips). The tile is now independent of `audit_log` retention, so month-over-month no longer degrades as old audit rows are pruned. No backfill — existing apiCalls history stays in `audit_log` until it ages out; the tile will show partial data for ~1 month after deploy and recover naturally.
- 584420d: Refactor `RateLimitService` to a bucket-registry shape: granularity is intrinsic to the bucket (`mcp_calls_minute` → minute window, `mcp_calls_day` → day window), and a new `record(bucket)` primitive performs the upsert and returns the post-bump count without checking limits. `consume()` is unchanged externally but is now a thin recipe over `record` + an inline threshold check — splitting "bump a counter" from "enforce a quota" so future buckets (e.g. metrics-only counters) don't have to choose between borrowing `consume()` and reimplementing the upsert. No behavior change: bucket strings, table layout, error shape, and `usage()` output are identical.
- c10c12e: Unify call-quota and rate-limit storage on a single table (`rate_limit_counters`) and fix a dead-code interceptor bug. `CallQuotaInterceptor` was registered as a global `APP_INTERCEPTOR`, which placed it outside the `TenancyInterceptor`'s context store — its `getCurrentContext()` check always threw and the underlying `QuotasService.recordCall` was never invoked in production. The cloud `api_request` quota was therefore not enforced at all.

  The `'api_request'` bump now lives in `AuditInterceptor` (which runs inside tenancy), so cloud's `recordCall` impl actually fires. The bucket registry in `RateLimitService` gains a `'month'` granularity and two month buckets (`api_calls_month`, `mcp_calls_month`) so the cloud `QuotasService` override can switch to `rate_limit_counters` and the OSS `org_call_counters` table can be retired in the matching cloud PR. `CallQuotaInterceptor` and the related export are removed; cloud must drop its `APP_INTERCEPTOR` registration in the coordinated cloud release.
  - @getmunin/core@4.36.0
  - @getmunin/db@4.36.0
  - @getmunin/types@4.36.0
  - @getmunin/mcp-toolkit@4.36.0
  - @getmunin/agent-runtime@4.36.0
  - @getmunin/emails@4.36.0

## 4.35.0

### Minor Changes

- 73320e2: Add a drop-in tracker script for arbitrary web pages — same ergonomics as the chat widget. `analytics_create_tracker` mints a public `mn_track_*` API key, then a single `<script async src=".../v1/a/tracker.js" data-key="mn_track_…">` tag auto-fires page views, tracks dwell on `pagehide`, and exposes `window.mn.track(subjectId, attrs)` for SPA route changes. Events land in `analytics_view_events` with `source='tracker'`. Tracker keys are write-only and org-scoped — safe to embed in browsers.

  Also adds three admin read tools: `analytics_top_subjects` (most-viewed pages/entries), `analytics_subject_engagement` (views/dwell/depth for one subject), `analytics_zero_result_searches` (queries readers asked that returned nothing — the best "what to write next" signal). The `cms/review-stale-entries` skill now consults `analytics_subject_engagement` to judge refresh-vs-archive instead of relying on inbound references alone; a new `skill://analytics/track-website-traffic` walks operators through the full setup.

### Patch Changes

- b502fe6: Validate analytics ingest payloads with Zod at the controller boundary. The pixel `@Query` params (`/v1/a/t/:key.gif`) and both beacon bodies (`/v1/a/t`, `/v1/a/v`) now run through `safeParse` schemas and reject any non-string field early instead of relying on hand-rolled `typeof` guards downstream. Closes the CodeQL "Type confusion through parameter tampering" alert raised on PR #360 and applies the same hardening to the matching beacon route. Matches the existing repo convention (see `api-keys.controller.ts`); no behavior change for valid clients.
- Updated dependencies [73320e2]
  - @getmunin/core@4.35.0
  - @getmunin/db@4.35.0
  - @getmunin/agent-runtime@4.35.0
  - @getmunin/mcp-toolkit@4.35.0
  - @getmunin/types@4.35.0
  - @getmunin/emails@4.35.0

## 4.34.0

### Minor Changes

- 290472e: Add an `analytics` module that records page-view and search events for any consumer surface. Two ingress paths: a 1×1 GIF pixel at `GET /v1/a/v/:token.gif` and a JSON beacon at `POST /v1/a/v`. Both anonymous, throttled, bot-UA filtered, and gated by an HMAC-signed view token bound to `(orgId, subjectType, subjectId)` so callers can't spoof arbitrary subjects. Events land in two new polymorphic tables (`analytics_view_events`, `analytics_search_events`) keyed by `subject_type` (`'cms_entry'` today, `'landing'`/`'dashboard_route'`/… later) — no per-consumer schema churn.

  CMS delivery wires in as the first consumer: every entry and list item from `/v1/cms/{orgId}/...` now ships with a `_tracking: { pixelUrl, beaconUrl }` block (suppressible via `?tracking=0`), and the public `/search` endpoint logs every query plus its `result_count` for "what to write next" analysis (zero-result queries are indexed for fast lookup).

  Also: the email open pixel and the new CMS tracking URLs both now build off `MUNIN_API_URL` via a new `readApiBaseUrl()` helper, fixing a latent bug where pixels were minted against the MCP host on split-host deployments (`api.*` vs `mcp.*` subdomains). The unused `readPublicBaseUrl()` shim is removed, and `MUNIN_API_URL` is documented in `.env.example` under the Backend section.

### Patch Changes

- Updated dependencies [290472e]
- Updated dependencies [8d25fee]
  - @getmunin/core@4.34.0
  - @getmunin/db@4.34.0
  - @getmunin/agent-runtime@4.34.0
  - @getmunin/mcp-toolkit@4.34.0
  - @getmunin/types@4.34.0
  - @getmunin/emails@4.34.0

## 4.33.0

### Minor Changes

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

### Patch Changes

- Updated dependencies [9042f0e]
  - @getmunin/core@4.33.0
  - @getmunin/agent-runtime@4.33.0
  - @getmunin/mcp-toolkit@4.33.0
  - @getmunin/db@4.33.0
  - @getmunin/types@4.33.0
  - @getmunin/emails@4.33.0

## 4.32.0

### Minor Changes

- bd8cd79: Surface CMS draft entries in the dashboard approval queue. Adds `CmsService.listDraftEntries` + `archiveEntry`, a new `/v1/cms/drafts/*` control endpoint family for approve/schedule/dismiss/patch, and a dedicated CMS drawer with metadata grid, cover-image preview, inline body editor, and a schedule popover. The shared `QueueDrawer` is also split into per-kind files (`queue-drawers/{kb,crm,outreach,feedback,cms}.tsx`) backed by a small dispatcher so adding the next kind is a new file rather than another branch.
- 03d62af: Webhook management is now available to AI agents via MCP. Adds seven `webhooks_*` tools (`list`, `create`, `update`, `delete`, `rotate_secret`, `list_deliveries`, `list_event_types`) backed by a new `WebhooksService` that the existing REST controller at `/v1/webhooks` also delegates to. The controller gains `POST :id/rotate-secret`, `GET :id/deliveries`, and `GET event-types` endpoints. Tools follow the system-alerts convention (`audiences: ['admin']`, `scopes: []`) — no new OAuth scopes were introduced.

  Adds `cms_upload_asset_from_url`: server-side fetches an HTTPS asset and stores it as a CMS asset in one call. Bypasses the presigned-PUT + base64 round-trips that some agent sandboxes (e.g. ChatGPT/Claude workspaces) cannot complete. Guarded by `safeFetch` (SSRF, redirect cap, 15s timeout), a 50 MB streamed size cap (Content-Length is not trusted), and a MIME allowlist (`image/*`, `video/*`, `audio/*`, `application/pdf`; SVG remains rejected). The original URL is recorded in `metadata.sourceUrl`.

  Consolidates webhook event-type strings in `@getmunin/types`: new exports `CMS_EVENT_TYPES`, `CRM_EVENT_TYPES`, `KB_EVENT_TYPES`, `CONVERSATION_EVENT_TYPES`, `OUTREACH_EVENT_TYPES`, `SYSTEM_EVENT_TYPES`, `EVENT_TYPES_BY_MODULE`, `KNOWN_EVENT_TYPES`, and `isKnownEventType`. The dispatcher's `emit({ type })` still accepts arbitrary strings; the catalog is the source of truth for `webhooks_list_event_types` and is available for typed consumers going forward.

  Realtime gateway now sends `{ type: 'read_ack', conversationId, messageIds }` to the originating socket after a `read` frame's `conv_message_reads` INSERT commits. All existing WebSocket consumers (chat-widget, dashboard, agent-runtime) silently ignore unknown frame types, so this is additive. The widget integration test for `conv_message_reads` waits for the ack instead of `setTimeout(200)`, eliminating a CI flake.

### Patch Changes

- Updated dependencies [f6cb178]
- Updated dependencies [211f215]
- Updated dependencies [03d62af]
  - @getmunin/core@4.32.0
  - @getmunin/types@4.32.0
  - @getmunin/agent-runtime@4.32.0
  - @getmunin/mcp-toolkit@4.32.0
  - @getmunin/db@4.32.0
  - @getmunin/emails@4.32.0

## 4.31.0

### Minor Changes

- 8b270d4: Trim audit-log write volume and add retention. The `AuditInterceptor` now skips chatty polling GETs (`/agent-health`, `/agent-config`, `/widget/messages`, `/widget/conversations`, `/inbox`, `/usage/summary`, `/system/alerts` — under both `/v1` and `/api/v1`); non-GET requests on the same paths are still audited. The in-process agent runner no longer records `runner:claimCuratorJobs` ticks. A new `AuditRetentionService` prunes `audit_log` rows daily; window is configurable via `MUNIN_AUDIT_RETENTION_DAYS` (default `30`, set to `off` or `0` to disable) and `MUNIN_AUDIT_RETENTION_CRON` (default `0 3 * * *`).

### Patch Changes

- @getmunin/core@4.31.0
- @getmunin/db@4.31.0
- @getmunin/types@4.31.0
- @getmunin/mcp-toolkit@4.31.0
- @getmunin/agent-runtime@4.31.0
- @getmunin/emails@4.31.0

## 4.30.0

### Patch Changes

- @getmunin/core@4.30.0
- @getmunin/db@4.30.0
- @getmunin/types@4.30.0
- @getmunin/mcp-toolkit@4.30.0
- @getmunin/agent-runtime@4.30.0
- @getmunin/emails@4.30.0

## 4.29.2

### Patch Changes

- @getmunin/core@4.29.2
- @getmunin/db@4.29.2
- @getmunin/types@4.29.2
- @getmunin/mcp-toolkit@4.29.2
- @getmunin/agent-runtime@4.29.2

## 4.29.1

### Patch Changes

- 84b988d: KB and CMS vector search now cast the query embedding to match the deployed column type. The hard-coded `::vector` cast in `kb.search.ts` and `cms.search.ts` bypassed the HNSW index when the column was switched to `halfvec` (required for embeddings above 2000 dimensions, since pgvector's `vector` type caps HNSW indexing at 2000). Queries fell back to sequential scans of every chunk in the org. A new `embeddingColumnType()` helper in `@getmunin/core` reads `MUNIN_EMBEDDING_COLUMN_TYPE` (defaulting to `vector`), and the search SQL uses it via `sql.raw` to keep the index in play. Set `MUNIN_EMBEDDING_COLUMN_TYPE=halfvec` on deployments where the column was migrated to `halfvec`.
- 84b988d: `TenancyInterceptor` and `AuditInterceptor` are now idempotent across nested invocations. Previously, if either was registered both globally (via `APP_INTERCEPTOR`) and per-controller (via `@UseInterceptors`) — as can happen when a downstream backend composes the OSS module — every authenticated request would open a second `db.transaction` and write a duplicate audit row. The second transaction acquired a separate pool connection that sat in `BEGIN` for the lifetime of the request, capping useful concurrency well below the configured pool size. The guards short-circuit on a second pass: `TenancyInterceptor` skips when `RequestContextStore.getStore()` is already populated; `AuditInterceptor` skips when the request was already audited.
- Updated dependencies [84b988d]
  - @getmunin/core@4.29.1
  - @getmunin/agent-runtime@4.29.1
  - @getmunin/mcp-toolkit@4.29.1
  - @getmunin/db@4.29.1
  - @getmunin/types@4.29.1

## 4.29.0

### Minor Changes

- bc0d601: Introduces `org_alerts`, a first-class operational alerts surface (new `system_alerts_*` MCP tools, `GET /v1/system/alerts`, `org_alert.opened|resolved|acknowledged` realtime events). LLM-provider and channel-inbound failure paths now write to alerts instead of dedicated `last_error` columns on `agent_health` / `conv_inbound_state`, which are dropped. The dashboard banner reads from the alerts feed and renders per-source CTAs.

  Auto-deactivates an inbound poll channel after 5 consecutive failures: `conv_channels.active` flips to `false` (so the worker stops hammering broken credentials), the existing alert metadata records `deactivatedAt` + `attemptCount`, and the channels settings page renders an `ACTIVATE` button. `POST /v1/conversations/channels/:id/activate` re-enables the channel and resolves the alert.

  Also fixes an `imapflow` crash loop in the email adapter: a late TLS socket error after `tick()` returned was emitted with no listener attached, terminating the Node process. The adapter now attaches an `error` listener at construction and tears down the client on `connect()` failure.

### Patch Changes

- Updated dependencies [bc0d601]
  - @getmunin/db@4.29.0
  - @getmunin/core@4.29.0
  - @getmunin/agent-runtime@4.29.0
  - @getmunin/mcp-toolkit@4.29.0
  - @getmunin/types@4.29.0

## 4.28.0

### Minor Changes

- 7436b8c: Add `cms_upload_asset_bytes` MCP tool: agentic clients can now upload small assets (≤2 MB after base64 decode) in a single call, without the `cms_request_asset_upload` → out-of-band S3 PUT → `cms_complete_asset_upload` round-trip. The new tool decodes server-side, writes the bytes through the storage abstraction, and persists the row already marked `uploaded: true`. SVG is rejected on the same grounds as the request/complete path. For larger files the existing two-step flow remains the right shape.

  To support this, `S3CompatibleStorage` now implements `writeDirect` using a SigV4 `PUT` with full-payload `x-amz-content-sha256` hashing (compatible with strict S3 implementations). The Nest JSON body limit moves from the Express default (~100 kB) to 4 MB to accommodate base64-inflated payloads.

### Patch Changes

- 4e09934: `POST /v1/conversations/channels/email` now returns a `400` with the underlying reason when an SMTP or IMAP host fails the SSRF guard, instead of an opaque `500`. The dashboard's generic error renderer surfaces the message verbatim, so a typo like `imag.gmail.com` now reads as `SMTP: dns lookup failed for imag.gmail.com: getaddrinfo ENOTFOUND imag.gmail.com` rather than "Munin couldn't reach the server".

  Only `SsrfBlockedError`s thrown during the inbound/outbound host validation are remapped; all other failures stay as-is.

- Updated dependencies [7436b8c]
- Updated dependencies [47e5b30]
- Updated dependencies [025b064]
  - @getmunin/core@4.28.0
  - @getmunin/emails@4.23.6
  - @getmunin/agent-runtime@4.28.0
  - @getmunin/mcp-toolkit@4.28.0
  - @getmunin/db@4.28.0
  - @getmunin/types@4.28.0

## 4.27.1

### Patch Changes

- @getmunin/core@4.27.1
- @getmunin/db@4.27.1
- @getmunin/types@4.27.1
- @getmunin/mcp-toolkit@4.27.1
- @getmunin/agent-runtime@4.27.1

## 4.27.0

### Minor Changes

- ee1098c: `cms_update_entry` and `crm_update_contact` now do partial updates on their jsonb payloads. Previously you had to send every field on `cms_update_entry.data` (or every key on `crm_update_contact.patch.customFields`) even if you only wanted to change one — and for CMS the validator then re-ran against the full payload, so omitted required fields blew up the call.

  Both tools now shallow-merge the incoming patch into the existing payload: keys you send replace the corresponding keys, keys you omit are preserved, and `key: null` clears a single key. CMS still re-validates the merged result against the collection schema, regenerates search_text + embedding, and rewires references.

  No behavior change for callers that were already sending the full payload. The "wipe everything" case (set the whole bag to a new object) is rare in practice — if you need it, send the new payload plus explicit `null`s for the keys you want gone.

- 6c585ba: Localize the AI-down greet and handover fallback messages to the visitor's widget locale across all 13 widget-supported locales (en, nb, da, sv, fi, is, de, fr, es, it, pt, nl, pl). Previously a Norwegian visitor whose widget was in `nb` still saw English fallback copy when the LLM provider was unreachable.

  The chat widget now sends its picked locale on every conv-create / message-ingest request. The backend stashes it in `end_users.metadata.locale` (no schema migration — the column was already jsonb). `ConversationDetail.endUserLocale` exposes the value to the agent runtime, which looks up the localized string from a new `fallback-messages` module. Unknown locales and other channels (email, SMS, voice) fall back to English at lookup time.

  Greet copy mirrors the widget's existing `defaultGreeting` tone per locale (e.g. `nb: "Hei. Hva kan vi hjelpe deg med?"`); handover copy is a fresh translation matching each locale's existing widget tone.

### Patch Changes

- 489b65c: **Security**: encrypt social-provider tokens at rest (`accounts.accessToken`,
  `refreshToken`, `idToken`).

  Audit of finding #5 (sensitive auth material plaintext at rest):

  | Column                                      | Status                                                                                                            |
  | ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
  | `accounts.password`                         | ✅ Already hashed (scrypt) by BetterAuth.                                                                         |
  | `accounts.accessToken/refreshToken/idToken` | ❌ **Plaintext by default.** Fixed.                                                                               |
  | `jwks.privateKey`                           | ✅ Encrypted (BetterAuth's jwt plugin wraps with `symmetricEncrypt` unless `disablePrivateKeyEncryption` is set). |
  | `oauthClient.clientSecret`                  | ✅ Hashed (SHA-256) by `@better-auth/oauth-provider`'s `storeClientSecret` (default `'hashed'`).                  |
  | `oauthRefreshToken.token`                   | ✅ Hashed (SHA-256) by `storeToken`.                                                                              |
  | `oauthAccessToken.token`                    | ✅ Hashed (SHA-256). Matches our `credentials.ts` lookup hash.                                                    |

  Only `accounts.*Token` columns were actually plaintext. Set
  `account.encryptOAuthTokens: true` in the BetterAuth factory — provider tokens
  are now `symmetricEncrypt`-wrapped with the existing `secret`. Decryption
  happens transparently on read.

  The remaining columns the auditor flagged were already protected at the
  application layer despite their `text` shape in the Drizzle schema.

  **Existing rows**: any social-provider tokens already in `accounts` from
  previous logins remain plaintext until that row is rewritten. BetterAuth's
  `decryptOAuthToken` helper detects "looks-encrypted" tokens and only attempts
  decryption when the format matches, so existing plaintext tokens keep working
  on read. New tokens (refresh on next sign-in) land encrypted.

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

- 524a812: **Security**: harden chat-widget rate limiting and origin enforcement.
  - **Throttler key**: drop caller-controlled `sessionId` from the tracker key.
    The widget previously bucketed by `ip|channelId|sessionId`, so an embed
    that rotated session IDs through the same IP could open unbounded
    conversations. The key is now `apiKeyId|channelId|ip` — independent of
    session and indexed by the resolved widget credential.
  - **Trusted IP**: the guard now reads `req.ip` (which honours Express's
    `trust proxy` setting) instead of parsing `x-forwarded-for` directly. New
    `MUNIN_TRUST_PROXY` env (forwarded to `app.set('trust proxy', …)`) lets
    deployments behind a load balancer / CDN trust their proxy hop and have
    `req.ip` reflect the real client. Left unset, Express trusts no proxy
    and `req.ip` is the socket address — so an unproxied app no longer
    honours a spoofed XFF.
  - **Origin allowlist (opt-in strict mode)**: `enforceOriginAllowlist` keeps
    the dev-friendly default (empty allowlist allows any origin) but now
    rejects when `MUNIN_WIDGET_REQUIRE_ALLOWLIST=1` is set. Production
    deployments should set it.

- Updated dependencies [97bfdb8]
- Updated dependencies [2605e0f]
- Updated dependencies [24905e6]
- Updated dependencies [6c585ba]
- Updated dependencies [b46a41c]
  - @getmunin/core@4.27.0
  - @getmunin/db@4.27.0
  - @getmunin/agent-runtime@4.27.0
  - @getmunin/mcp-toolkit@4.27.0
  - @getmunin/types@4.27.0

## 4.26.0

### Patch Changes

- @getmunin/core@4.26.0
- @getmunin/db@4.26.0
- @getmunin/types@4.26.0
- @getmunin/mcp-toolkit@4.26.0
- @getmunin/agent-runtime@4.26.0

## 4.25.0

### Minor Changes

- 33b6613: feat(cms): expand asset fields inline on read paths. The public delivery API (`/v1/cms/:org/:collection[/:slug]`), admin `cms_get_entry` / `cms_list_entries`, and `cms_search` previously returned bare asset ids (e.g. `"cma_xyz"`) for `type: 'asset'` and `array<asset>` fields, leaving external renderers no way to derive a URL. Reads now replace those ids with `{ id, publicUrl, altText, mime, sizeBytes }` via a single batched, org-scoped `cms_assets` lookup per response. Pending (`uploaded=false`) and unknown ids surface as `null` so renderers can treat them as missing rather than render a broken id. Write paths (`cms_create_entry` / `cms_update_entry` / publish / restore) intentionally stay raw so agent round-trips remain clean.

  Also: new CMS uploads are now keyed under `cms/{orgId}/...` instead of `{orgId}/...` so bucket policies can scope `s3:GetObject` to `cms/*` and the same bucket can later hold non-public objects without exposing them. Existing rows keep working — `publicUrl` is stored absolute, so old keys are unaffected.

### Patch Changes

- 7ddf932: **Security**: address four audit findings.
  - **High**: gate every sensitive control-plane endpoint on owner/admin role (webhooks, conversation channels, agent-config, org/assistant PATCH, etc.). Previously any signed-in member could rotate widget keys, change LLM provider credentials, or create event-exfiltrating webhooks.
  - **High**: agent provider URLs (`providerBaseUrl`) now route through `safeFetch` (blocks private/loopback/link-local hosts) and reject `http://` unless `MUNIN_SSRF_ALLOW_PRIVATE` is set. Closes the SSRF + credential-exfil path that let a misconfigured base URL leak the provider API key.
  - **High**: add RLS policy on `conv_widget_email_fallbacks` (the ledger had `org_id` but no policy). Plus a meta-test in `rls.test.ts` that fails when any `org_id`-bearing table is missing RLS.
  - **Medium**: expand role-coverage integration tests to cover the newly-gated endpoints (webhooks, conv channels, org/assistant PATCH).

  **Ergonomics**: introduce `@RequireRole(...)` / `@RequireActorType(...)` decorators + a single `RoleGuard` to replace inline `assertOwnerOrAdmin(...)` calls scattered across ~13 controllers. Conditional / body-dependent checks (`members:patch`) stay inline.

- Updated dependencies [7ddf932]
  - @getmunin/agent-runtime@4.25.0
  - @getmunin/db@4.25.0
  - @getmunin/core@4.25.0
  - @getmunin/mcp-toolkit@4.25.0
  - @getmunin/types@4.25.0

## 4.24.3

### Patch Changes

- 622745a: fix(mcp): allow OAuth-authorized callers (`actor.type === 'user'`) to reach admin tools. The audience-derivation gate added in #289 required `actor.type === 'admin_agent'`, which excluded the OAuth bearer-token flow used by claude.ai-style MCP connectors and collapsed every admin tool to `self_service`. Replace the actor-type equality check with an allowlist (`'admin_agent'` + `'user'`) so the defense-in-depth against `widget_agent` / `end_user_agent` / `partner` / `system` actors with a forged admin audience stays in place while OAuth users get the admin surface their granted scopes already entitle them to.
  - @getmunin/core@4.24.3
  - @getmunin/db@4.24.3
  - @getmunin/types@4.24.3
  - @getmunin/mcp-toolkit@4.24.3
  - @getmunin/agent-runtime@4.24.3

## 4.24.2

### Patch Changes

- b8da5b6: Fix accidentally protected public endpoints in cloud builds. Cloud
  registers AuthGuard globally via `APP_GUARD`, so any controller without
  `@AllowAnonymous()` gets a 401 — that left `/v1/cms/...` delivery,
  provider webhooks (`POST /v1/conversations/channels/:id/webhook`),
  health probes (`/healthz`, `/readyz`, `/version`), and signed-URL
  uploads (`/static/assets/upload`) accidentally auth-gated.

  Adds a `@PublicController(path, { throttle? })` helper that bundles
  `@Controller` + `@AllowAnonymous` (and optionally `ThrottlerGuard`)
  so the "public" intent is a single greppable declaration.
  - @getmunin/core@4.24.2
  - @getmunin/db@4.24.2
  - @getmunin/types@4.24.2
  - @getmunin/mcp-toolkit@4.24.2
  - @getmunin/agent-runtime@4.24.2

## 4.24.1

### Patch Changes

- Updated dependencies [f96c899]
  - @getmunin/db@4.24.1
  - @getmunin/core@4.24.1
  - @getmunin/agent-runtime@4.24.1
  - @getmunin/mcp-toolkit@4.24.1
  - @getmunin/types@4.24.1

## 4.24.0

### Minor Changes

- e095d61: Forward BetterAuth log errors to Sentry.

  `createMuninAuthCore` now accepts a `logger` option (passthrough to BetterAuth). The OSS `apps/backend` wires it up with `sentryForwardingLogger(Sentry.captureException)`, which captures every `level === 'error'` log entry — including the background-task failures BetterAuth catches internally (e.g. SMTP errors during `sendResetPassword`).

  Without this, BetterAuth's `try { … } catch (err) { logger.error('Failed to run background task', err) }` pattern swallowed real failures: the error never reached Sentry's unhandled-exception/rejection hooks, so issues like the recent `551 5.5.3 Domain name must be added` SMTP rejection were invisible to alerting.

  Consumers passing a custom `logger` can either omit the helper or extend it; the option type matches `BetterAuthOptions['logger']` directly.

### Patch Changes

- bbfc677: Integration tests now strictly require `TEST_DATABASE_URL` instead of silently falling back to `DATABASE_URL`. Yesterday's "Failed to decrypt private key" boot loop on dev was caused by `oauth-jwt-resolver.integration.test` running against the dev database (because `TEST_DATABASE_URL` was unset and the fallback let it use `DATABASE_URL`), writing an unencrypted JWK row directly via Drizzle, and never cleaning it up — so the next `pnpm dev` boot tried to read it through BetterAuth's encrypted-key code path and crashed.

  Two changes close the loop:
  - Every integration + database-touching test in this package (and elsewhere across the workspace) now reads `process.env.TEST_DATABASE_URL` only. When unset, `describe.skip` runs cleanly with a clear "Set TEST_DATABASE_URL" message instead of pointing the test at whatever DB happens to be in `process.env.DATABASE_URL` (typically dev).
  - `oauth-jwt-resolver.integration.test` now `afterAll`-deletes its fixture JWK row by `kid`, so even within the dedicated test database no plaintext key lingers between runs.

  CI already sets `TEST_DATABASE_URL` in `.github/workflows/ci.yml`, so the pipeline is unaffected. For local development, `.env.example` now declares the variable (default: `postgres://munin_app:munin_app@localhost:5432/munin_test`).

- Updated dependencies [ef55e18]
  - @getmunin/core@4.24.0
  - @getmunin/db@4.24.0
  - @getmunin/agent-runtime@4.24.0
  - @getmunin/mcp-toolkit@4.24.0
  - @getmunin/types@4.24.0

## 4.23.5

### Patch Changes

- Updated dependencies [f25821e]
  - @getmunin/emails@4.23.5
  - @getmunin/core@4.23.5
  - @getmunin/db@4.23.5
  - @getmunin/types@4.23.5
  - @getmunin/mcp-toolkit@4.23.5
  - @getmunin/agent-runtime@4.23.5

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

- Updated dependencies [6dfabd2]
  - @getmunin/emails@4.23.4
  - @getmunin/core@4.23.4
  - @getmunin/agent-runtime@4.23.4
  - @getmunin/mcp-toolkit@4.23.4
  - @getmunin/db@4.23.4
  - @getmunin/types@4.23.4

## 4.23.3

### Patch Changes

- Updated dependencies [57d7901]
  - @getmunin/core@4.23.3
  - @getmunin/agent-runtime@4.23.3
  - @getmunin/mcp-toolkit@4.23.3
  - @getmunin/db@4.23.3
  - @getmunin/types@4.23.3

## 4.23.2

### Patch Changes

- 377e87d: Accept the MCP resource URL in OAuth `validAudiences` when it differs from the authorization-server host. On cloud (`api.getmunin.com` + `mcp.getmunin.com`), Claude's token exchange was failing with `invalid_request: requested resource invalid` from `@better-auth/oauth-provider`'s `checkResource` — the token endpoint had `validAudiences = [<AS origin>]` only, so the `resource=https://mcp.getmunin.com` parameter (advertised by `/.well-known/oauth-protected-resource` and required because `resource_indicators_supported: true`) was rejected. Externally this surfaced as "Authorization with the MCP server failed" right after the user clicked Authorize.

  `createMuninAuthCore` now passes both the AS base URL and `mcpResourceUrl()` (from `NEXT_PUBLIC_MCP_URL`) into `computeValidAudiences`, which returns the union of URL-variant sets for both. OSS single-host topologies (where the two URLs share an origin) dedupe to the same audience list as before. No config changes needed in `munin-cloud` — it already sets both env vars; just bump the lockfile and redeploy.

- f0e5389: Security: close widget→admin escalation, SSRF in website-import, upload signing weaknesses, and control-plane authorization gaps.
  - Public `mn_widget_*` keys now resolve as a new `widget_agent` actor (not `admin_agent`), with audience forced to `self_service` and scopes narrowed to `conv:widget:write`. New `ControlPlaneGuard` rejects widget/end-user/partner actors and scoped admin keys (must have `*`) on `/v1/*` admin routes, so embedded widget keys can no longer mint, list, or revoke admin API keys, configure channels, or enqueue curator jobs.
  - Website-import enqueue and the underlying crawler validate URLs against private/loopback/link-local/cloud-metadata ranges. A new `safeFetch` helper enforces an undici dispatcher that re-validates the resolved IP at connect time (DNS-rebinding-safe) and walks redirects manually.
  - Local-storage upload signing switched from plain SHA-256 to HMAC-SHA256; `LocalFsStorage` throws on startup if `MUNIN_STORAGE_LOCAL_SECRET` is missing under `NODE_ENV=production`. Static asset serving sets `X-Content-Type-Options: nosniff`.
  - S3 uploads switched from presigned PUT to presigned POST with a `content-length-range` policy condition pinned to the declared size, so an oversized body is rejected by S3 itself. `cms_complete_asset_upload` HEADs the object and rejects (deleting the storage object) on size mismatch. `AssetStorage.presignedUpload` now returns `{ uploadUrl, uploadMethod, uploadFields, … }`; `AssetStorage.statBytes` is now required on the interface.

- Updated dependencies [f0e5389]
  - @getmunin/core@4.23.2
  - @getmunin/agent-runtime@4.23.2
  - @getmunin/types@4.23.2
  - @getmunin/mcp-toolkit@4.23.2
  - @getmunin/db@4.23.2

## 4.23.1

### Patch Changes

- 1f1a139: Export the tier-aware quota primitives so cloud builds can override the service.

  Adds `QUOTAS_SERVICE` (DI token), `QuotasService` (abstract base), `DefaultQuotasService` (default impl), `QuotaExceededError`, the `QuotaResource` and `QuotaCallKind` types, and `CallQuotaInterceptor` to the public surface of `@getmunin/backend-core`. The implementations shipped in 4.23.0; only the index barrel changes here.
  - @getmunin/core@4.23.1
  - @getmunin/db@4.23.1
  - @getmunin/types@4.23.1
  - @getmunin/mcp-toolkit@4.23.1
  - @getmunin/agent-runtime@4.23.1

## 4.23.0

### Minor Changes

- 2dd56ef: Make row-count quotas opt-in via `MUNIN_QUOTAS_ENABLED`.

  OSS self-hosters on their own hardware were being capped at the cloud free-tier ceilings (10K KB docs, 100 KB spaces, 50 CMS collections, 10K CMS entries, 1K CMS assets) because `QuotasService.assertCanAdd` ran unconditionally. The defaults make sense for a tiered SaaS but not for someone running Munin on their own box.

  `assertCanAdd` now no-ops unless `MUNIN_QUOTAS_ENABLED=true`. Set it in cloud deployments to keep the existing behavior; leave it unset (or `false`) on self-hosted instances. The per-org `orgs.settings.quotas.<resource>` override path is unchanged.

- 31f5346: Lay groundwork for tier-aware quotas: split `QuotasService` into an abstract base + DI token + `DefaultQuotasService` so cloud can swap in a tier-aware implementation.
  - New injection token `QUOTAS_SERVICE`; consumers (`KbService`, `CmsService`, `CrmService`) now inject via the token.
  - `crm_contacts` joins the row-count quota set (`QuotaResource`, `FREE_TIER_QUOTAS`, `TABLE_FOR`) and `CrmService.createContact` gates on it. Still off by default — `MUNIN_QUOTAS_ENABLED=true` to enable.
  - New `recordCall(kind, key?)` method on `QuotasService` for call-count metering (MCP tool invocations, REST requests). Default impl is a no-op; cloud will override to do tier-aware soft/hard caps with windowed counters.
  - Seams: MCP dispatch wires `recordCall('mcp_tool', toolName)` through the existing `rateLimit` hook on the controller; a globally-registered `CallQuotaInterceptor` calls `recordCall('api_request', "<verb> <route>")` for `/v1` traffic.

  OSS behavior unchanged: `recordCall` is a no-op everywhere on the default impl, and `assertCanAdd` still respects the `MUNIN_QUOTAS_ENABLED` gate.

### Patch Changes

- @getmunin/core@4.23.0
- @getmunin/db@4.23.0
- @getmunin/types@4.23.0
- @getmunin/mcp-toolkit@4.23.0
- @getmunin/agent-runtime@4.23.0

## 4.22.0

### Minor Changes

- 6b4276d: Extend the feedback MCP surface with global roadmap search and voting.
  - `feedback_search` queries the public Munin roadmap (`GET /v1/public/feedback`) so agents can find an existing item to vote on before filing a duplicate. Supports `q`, `appScope`, `status`, `sort` (`votes`|`recent`), and `limit` (≤100).
  - `feedback_vote` casts the instance's vote on a published item via the HMAC-signed `POST /v1/public/feedback/:id/vote` endpoint. Idempotent on `(feedbackId, instanceId)`; surfaces 404 (item missing or not public) and 429 (per-instance quota) as typed errors.
  - `FeedbackForwarder` keeps a single HTTP entry point for submit/search/vote; reuses the existing `munin-feedback-intake-v1` HMAC derivation so both directions share one key and constant.
  - OSS landing page gains a "Read the docs →" link under the Get started / Sign in buttons (en + nb).

### Patch Changes

- @getmunin/core@4.22.0
- @getmunin/db@4.22.0
- @getmunin/types@4.22.0
- @getmunin/mcp-toolkit@4.22.0
- @getmunin/agent-runtime@4.22.0

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
