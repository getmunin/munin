# @getmunin/db

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
  - @getmunin/types@3.5.0

## 3.4.1

### Patch Changes

- @getmunin/types@3.4.1

## 3.4.0

### Patch Changes

- @getmunin/types@3.4.0

## 3.2.1

### Patch Changes

- c5e93e1: Add a `development` package-export condition pointing at `./src/index.ts` (and `./src/schema.ts` for `@getmunin/db`). Loaders that resolve with `--conditions=development` (e.g. the OSS backend's new `node --import @swc-node/register/esm-register --watch --conditions=development src/main.ts` dev script) see the TypeScript source directly; the existing `types` → `dist/*.d.ts` and `default` → `dist/*.js` resolution paths are unchanged, so production runtime, typecheck, and downstream consumers that don't opt into the condition keep their current behavior.
- Updated dependencies [c5e93e1]
  - @getmunin/types@3.2.1

## 3.2.0

### Patch Changes

- @getmunin/types@3.2.0

## 3.1.0

### Patch Changes

- @getmunin/types@3.1.0

## 3.0.0

### Major Changes

- e5a5450: Migrate from the deprecated `oidcProvider` (in-tree better-auth plugin) to the published `@better-auth/oauth-provider`. The OAuth schema changes from 3 tables to 4 (`oauth_client`, `oauth_access_token`, `oauth_refresh_token`, `oauth_consent`) plus a `jwks` table for the JWT plugin. RFC 8707 resource indicators are now native via `validAudiences`, JWT access tokens replace opaque tokens for resource-bound flows, and the consent page contract switches from `consent_code` to a signed `oauth_query`. The dashboard consent page is fully localized (en + nb).

  Breaking: any deployment with rows in the old `oauth_applications` / `oauth_access_tokens` / `oauth_consents` tables will lose them — Munin OAuth has not been deployed anywhere yet, so this is a no-op in practice.

### Patch Changes

- @getmunin/types@3.0.0

## 2.5.1

### Patch Changes

- @getmunin/types@2.5.1

## 2.5.0

### Patch Changes

- @getmunin/types@2.5.0

## 2.4.0

### Patch Changes

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

- @getmunin/types@2.3.0

## 2.2.0

### Patch Changes

- @getmunin/types@2.2.0

## 2.1.0

### Patch Changes

- @getmunin/types@2.1.0

## 2.0.0

### Patch Changes

- @getmunin/types@2.0.0

## 1.0.0

### Patch Changes

- @getmunin/types@1.0.0

## 0.25.0

### Patch Changes

- @getmunin/types@0.25.0

## 0.24.1

### Patch Changes

- @getmunin/types@0.24.1

## 0.24.0

### Patch Changes

- @getmunin/types@0.24.0

## 0.23.3

### Patch Changes

- @getmunin/types@0.23.3

## 0.23.2

### Patch Changes

- @getmunin/types@0.23.2

## 0.23.1

### Patch Changes

- @getmunin/types@0.23.1

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

- @getmunin/types@0.22.0

## 0.21.0

### Patch Changes

- @getmunin/types@0.21.0

## 0.20.0

### Patch Changes

- @getmunin/types@0.20.0

## 0.19.0

### Minor Changes

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

- @getmunin/types@0.19.0

## 0.18.0

### Patch Changes

- @getmunin/types@0.18.0

## 0.17.0

### Minor Changes

- db26079: Adds a self-service-agent availability indicator to the dashboard. The realtime gateway now tracks live subscribers whose audiences include `self_service` (excluding end-user widgets) per org. New endpoint `GET /api/overview/agent-status` returns `{ selfServiceAgentSubscriberCount, lastInboundEndUserMessageAt, lastAgentMessageAt }`. Overview page renders a card showing connected/not-connected, and surfaces a warning state when there's no agent connected and end-user messages are unanswered. Solves the OSS bootstrapping confusion where a self-hoster's chat widget delivers messages into the void with no UI signal that nothing is listening on the agent side.

  Adds an `audiences` jsonb column on `api_keys` (default `['admin']`) and the credential resolver now reads it instead of hardcoding the audience set. This lets a key be minted with `audiences: ['admin', 'self_service']` so its realtime subscriptions are recognised as self-service-agent connections. Backwards compatible — existing rows default to admin-only.

### Patch Changes

- @getmunin/types@0.17.0

## 0.16.1

### Patch Changes

- cd2ba29: Fixes a bug where a second end-user starting a conversation in an org that already has another end-user's conversation would 500 with `conv_conversations_display_uq` collision. `conv_next_display_id(p_org_id)` was running under the caller's RLS context — when called from a delegated end-user token, it only saw that end-user's own conversations and computed `MAX(display_id) + 1` from the wrong baseline, picking values already taken by _other_ end-users' rows. The application-layer retry couldn't recover because Postgres aborts the whole transaction after the first INSERT conflict. Marks the function `SECURITY DEFINER` (with a fixed `search_path`) so the per-org sequence is computed against all conversations in the org, regardless of caller tenancy. Added a regression test (`a second end-user can start a conversation after the first`) covering the exact pattern that triggered the bug.
  - @getmunin/types@0.16.1

## 0.16.0

### Patch Changes

- @getmunin/types@0.16.0

## 0.15.0

### Minor Changes

- b7b7644: CRM merge proposals: new `crm_merge_proposals` table (migration `0007`) plus four admin MCP tools — `crm_propose_merge_candidate`, `crm_list_merge_proposals`, `crm_apply_merge_proposal`, `crm_dismiss_merge_proposal`. New `skill://crm/hygiene` walks an admin agent through filing structured proposals; `crm_apply_merge_proposal` atomically copies the recommended patch onto the keeper, archives the duplicate (`dedup-archived-YYYY-MM` tag + `customFields.mergedInto` + `doNotContact`), and marks the proposal applied. Pending proposals are unique per `(orgId, contactA, contactB)` pair so re-running the curator is idempotent. `OverviewBacklog` now exposes `crmMergeProposalsPending` for the dashboard backlog card.

### Patch Changes

- @getmunin/types@0.15.0

## 0.14.0

### Patch Changes

- @getmunin/types@0.14.0

## 0.13.0

### Patch Changes

- @getmunin/types@0.13.0

## 0.12.0

### Patch Changes

- @getmunin/types@0.12.0

## 0.11.0

### Patch Changes

- @getmunin/types@0.11.0

## 0.10.0

### Patch Changes

- @getmunin/types@0.10.0

## 0.9.1

### Patch Changes

- @getmunin/types@0.9.1

## 0.9.0

### Patch Changes

- @getmunin/types@0.9.0

## 0.8.0

### Patch Changes

- @getmunin/types@0.8.0

## 0.7.0

### Patch Changes

- @getmunin/types@0.7.0

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

- @getmunin/types@0.5.0

## 0.4.0

### Patch Changes

- @getmunin/types@0.4.0

## 0.3.1

### Patch Changes

- fe8fd21: TenancyInterceptor: bypass RLS for `actor.type === 'partner'`.

  Partner actors (in a downstream package) operate across multiple orgs they
  provisioned. Their controllers filter manually by `partner_id`. OSS
  never produces `'partner'` actors, so this branch is dead code there.

- Updated dependencies [fe8fd21]
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
  - @getmunin/types@0.2.0
