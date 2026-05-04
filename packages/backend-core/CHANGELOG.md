# @getmunin/backend-core

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
