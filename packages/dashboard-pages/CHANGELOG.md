# @getmunin/dashboard-pages

## 3.2.0

### Minor Changes

- 9d84e3c: Drop the unused `displayName` field from chat-widget channels. The field was required at create time but was never read by the chat-widget itself — only echoed in the dashboard's channel list. Removed from the MCP tool inputs (`conv_widget_create_channel`, `conv_widget_update_channel`), the `WidgetChannelConfig` zod schema, the REST body schemas in `ConvChannelsController`, the dashboard's "Add chat widget" form and channel-row display, and the widget-onboarding / bulk-channel-setup skill docs. Existing rows keep `displayName` in their `conv_channels.config` jsonb but it gets silently stripped on next parse — no migration required.

  Also fixes a NestJS route-ordering bug where `ConversationsController @Get(':id')` shadowed `ConvChannelsController @Get()`, causing `/api/v1/conversations/channels` to return `conv_not_found: conversation channels` instead of the channel list. `ConvChannelsController` is now registered before `ConversationsController` in `ControlModule`.

### Patch Changes

- @getmunin/ui@3.2.0

## 3.1.0

### Minor Changes

- 23a22f8: Add shared auth-shell components for the redesigned auth pages: `AuthShell`, `AuthEpigraph`, `AuthHeading`, `AuthSubheading`, `AuthFootnote`, `AuthDivider`, `AuthField`, `AuthLabel`, `AuthInput`, `AuthSubmit`, `AuthOAuthButton`, `AuthFieldHint`, `ErrorAlert`, `AuthInviteCard`, plus the `OSS_AUTH_FOOTER` / `CLOUD_AUTH_FOOTER` constants and `AuthState` type. Also adds `--munin-auth-navy`, `--munin-alert-bad-*`, and `--munin-invite-{good,bad}-*` design tokens to `@getmunin/ui` and exposes them as Tailwind utilities (`bg-auth-navy`, `bg-alert-bad`, `bg-invite-good`, etc.).

### Patch Changes

- Updated dependencies [23a22f8]
  - @getmunin/ui@3.1.0

## 3.0.0

### Major Changes

- e5a5450: Migrate from the deprecated `oidcProvider` (in-tree better-auth plugin) to the published `@better-auth/oauth-provider`. The OAuth schema changes from 3 tables to 4 (`oauth_client`, `oauth_access_token`, `oauth_refresh_token`, `oauth_consent`) plus a `jwks` table for the JWT plugin. RFC 8707 resource indicators are now native via `validAudiences`, JWT access tokens replace opaque tokens for resource-bound flows, and the consent page contract switches from `consent_code` to a signed `oauth_query`. The dashboard consent page is fully localized (en + nb).

  Breaking: any deployment with rows in the old `oauth_applications` / `oauth_access_tokens` / `oauth_consents` tables will lose them — Munin OAuth has not been deployed anywhere yet, so this is a no-op in practice.

### Patch Changes

- @getmunin/ui@3.0.0

## 2.5.1

### Patch Changes

- @getmunin/ui@2.5.1

## 2.5.0

### Minor Changes

- e962f04: feat(oauth): branded consent UI at /dashboard/oauth/consent (Phase 4)

  Custom consent page for the OAuth 2.1 authorization flow. Replaces Better-Auth's default `getConsentHTML` fallback with a Munin-styled card showing the client name, requested scopes, and Allow/Deny actions. Submission posts to `/auth/oauth2/consent` with `accept: true|false` and the `consent_code` from the query string; on success the user is redirected back to the OAuth client.

  The page is added to `useDashboardGate`'s exempt list so a user can authorize an external app even before completing the built-in-AI setup wizard.

  A wrapper at `apps/web/app/dashboard/oauth/consent/page.tsx` re-exports the component; cloud picks it up automatically when it bumps the package.

### Patch Changes

- @getmunin/ui@2.5.0

## 2.4.0

### Patch Changes

- @getmunin/ui@2.4.0

## 2.3.0

### Patch Changes

- @getmunin/ui@2.3.0

## 2.2.0

### Patch Changes

- @getmunin/ui@2.2.0

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

- @getmunin/ui@2.1.0

## 2.0.0

### Major Changes

- d4f7a27: refactor!: route alignment + ai-agent → builtin-ai rename + setup gate

  Frontend route alignment, the second pass after the API rename. Three things in one diff:

  **1. Rename `/dashboard/settings/ai-agent` → `/dashboard/settings/builtin-ai`** in OSS and updates the wizard's hardcoded internal link. The package export `AgentSettingsPage` is renamed to `BuiltinAiSettingsPage` to match the URL.

  **2. New gate hooks** for use in dashboard layouts and the setup page:
  - `useDashboardGate()` — returns `{ ready, role }`. When the active org's built-in AI is not configured (`providerApiKeySet === false`) and the user is owner/admin, redirects to `/setup`. Members are allowed through (they see the dashboard's per-page empty states). `/dashboard/account` is exempt — escape hatch if onboarding goes sideways.
  - `useSetupGate()` — returns `{ ready }`. Inverse: redirects to `/dashboard` when configuration is already complete.
  - `useAgentConfigStatus()` — small primitive used by both gate hooks.

  **3. OSS app wired up.** `apps/web/app/dashboard/layout.tsx` now uses `useDashboardGate`; `apps/web/app/setup/page.tsx` now uses `useSetupGate`.

  Companion frontend changes ship in `munin-cloud` once a release of this package is published.

### Patch Changes

- @getmunin/ui@2.0.0

## 1.0.0

### Patch Changes

- @getmunin/ui@1.0.0

## 0.25.0

### Patch Changes

- @getmunin/ui@0.25.0

## 0.24.1

### Patch Changes

- @getmunin/ui@0.24.1

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

- @getmunin/ui@0.24.0

## 0.23.3

### Patch Changes

- @getmunin/ui@0.23.3

## 0.23.2

### Patch Changes

- @getmunin/ui@0.23.2

## 0.23.1

### Patch Changes

- 4ff9c11: Remove dashboard outreach campaigns config page. Campaign CRUD now lives only via the admin MCP tools (`outreach_create_campaign`, `outreach_update_campaign`, `outreach_list_campaigns`, `outreach_get_campaign`) — agent-native setup, dashboard-native review. Drops the `/dashboard/settings/outreach` route, the `OutreachCampaignsPage` export, and the `/api/outreach/campaigns` REST controller. The Review tab (`OutreachDraftsTab`) and `/api/outreach/proposals` are unaffected.
  - @getmunin/ui@0.23.1

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

- @getmunin/ui@0.23.0

## 0.22.0

### Minor Changes

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

- @getmunin/ui@0.22.0

## 0.21.0

### Minor Changes

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

- Updated dependencies [914477f]
  - @getmunin/ui@0.21.0

## 0.20.0

### Patch Changes

- @getmunin/ui@0.20.0

## 0.19.0

### Patch Changes

- @getmunin/ui@0.19.0

## 0.18.0

### Patch Changes

- @getmunin/ui@0.18.0

## 0.17.0

### Minor Changes

- db26079: Adds a self-service-agent availability indicator to the dashboard. The realtime gateway now tracks live subscribers whose audiences include `self_service` (excluding end-user widgets) per org. New endpoint `GET /api/overview/agent-status` returns `{ selfServiceAgentSubscriberCount, lastInboundEndUserMessageAt, lastAgentMessageAt }`. Overview page renders a card showing connected/not-connected, and surfaces a warning state when there's no agent connected and end-user messages are unanswered. Solves the OSS bootstrapping confusion where a self-hoster's chat widget delivers messages into the void with no UI signal that nothing is listening on the agent side.

  Adds an `audiences` jsonb column on `api_keys` (default `['admin']`) and the credential resolver now reads it instead of hardcoding the audience set. This lets a key be minted with `audiences: ['admin', 'self_service']` so its realtime subscriptions are recognised as self-service-agent connections. Backwards compatible — existing rows default to admin-only.

### Patch Changes

- @getmunin/ui@0.17.0

## 0.16.1

### Patch Changes

- @getmunin/ui@0.16.1

## 0.16.0

### Minor Changes

- 109e723: Adds a CRM merge proposals review page to the dashboard. New REST controller exposes `GET /api/crm/merge-proposals`, `GET /api/crm/merge-proposals/:id`, `POST /api/crm/merge-proposals/:id/apply`, `POST /api/crm/merge-proposals/:id/dismiss` so the dashboard can list pending proposals and resolve them with one click. The page subscribes to the new `crm.merge_proposal.*` realtime events so the queue updates without polling, and falls back to a 60s poll. The "Needs attention" backlog tile gets a CRM merge counter that links to the page; nav adds a top-level "CRM merges" entry. en + nb i18n strings included.

### Patch Changes

- @getmunin/ui@0.16.0

## 0.15.0

### Patch Changes

- @getmunin/ui@0.15.0

## 0.14.0

### Patch Changes

- @getmunin/ui@0.14.0

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

- @getmunin/ui@0.13.0

## 0.12.0

### Patch Changes

- @getmunin/ui@0.12.0

## 0.11.0

### Patch Changes

- @getmunin/ui@0.11.0

## 0.10.0

### Patch Changes

- @getmunin/ui@0.10.0

## 0.9.1

### Patch Changes

- @getmunin/ui@0.9.1

## 0.9.0

### Minor Changes

- 19466a0: Localize all dashboard pages and UI components with [next-intl](https://next-intl.dev). Ships English (`en`) and Norwegian Bokmål (`nb`) message catalogs that consumers extend in their own `messages/{locale}.json`.

  **Breaking-ish (pre-1.0 minor):**
  - `next-intl` is now a required peer dependency of `@getmunin/dashboard-pages`. Consumers must wrap their app in `<NextIntlClientProvider>` and configure `next-intl/plugin` in `next.config.mjs`.
  - `GoogleButton.label` (in `@getmunin/ui`) is now required. Pass a translated label rather than relying on the previous English default.

  **What's translated:** all `dashboard-pages` exports (`AgentsPage`, `ApiKeysPage`, `TeamPage`, `AuditLogPage`, `UsagePage`, `EndUsersPage`, `ExportPage`, `DashboardPage`, `AcceptInvitePage`, `OrgSwitcher`) plus error messages mapped from stable backend codes (e.g. `SIGNUP_DOMAIN_NOT_ALLOWED`, `SIGNUP_INVITE_ONLY`).

  **Backend changes (`@getmunin/backend`):** `auth.config.ts` now emits two distinct codes (`SIGNUP_DOMAIN_NOT_ALLOWED` and `SIGNUP_INVITE_ONLY`) instead of a single `SIGNUP_NOT_ALLOWED`. Email templates (password reset, verification) move into `email-templates.ts` keyed by locale, with a default driven by `MUNIN_DEFAULT_LOCALE` (`en` | `nb`).

### Patch Changes

- Updated dependencies [19466a0]
  - @getmunin/ui@0.9.0

## 0.8.0

### Patch Changes

- @getmunin/ui@0.8.0

## 0.7.0

### Patch Changes

- @getmunin/ui@0.7.0

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

- @getmunin/ui@0.6.0

## 0.5.0

### Patch Changes

- @getmunin/ui@0.5.0

## 0.4.0

### Patch Changes

- @getmunin/ui@0.4.0

## 0.3.1

### Patch Changes

- fe8fd21: TenancyInterceptor: bypass RLS for `actor.type === 'partner'`.

  Partner actors (in a downstream package) operate across multiple orgs they
  provisioned. Their controllers filter manually by `partner_id`. OSS
  never produces `'partner'` actors, so this branch is dead code there.

- Updated dependencies [fe8fd21]
  - @getmunin/ui@0.3.1

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
  - @getmunin/ui@0.3.0

## 0.2.0

### Minor Changes

- f3abef4: Add cross-org switcher endpoint + UI.
  - New `GET /api/orgs/me/memberships` — list every org the caller is a member of (id, name, slug, role, isDefault).
  - New `PATCH /api/orgs/me/memberships/active` — flip `is_default` so the next session-cookie request resolves to the chosen org.
  - New `<OrgSwitcher />` component in `@getmunin/dashboard-pages` that wraps both endpoints. Cloud's dashboard layout renders it in the header.

  OSS (single-tenant) installs see exactly one membership and don't render a switcher.

### Patch Changes

- Updated dependencies [f3abef4]
  - @getmunin/ui@0.2.0
