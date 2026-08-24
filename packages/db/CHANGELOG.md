# @getmunin/db

## 5.11.0

### Minor Changes

- 2169915: Custom MCP connector: connect any proprietary system as a live tool source for the support agent.

  Orgs can now point Munin at an MCP server they host themselves (`vendor: "custom-mcp"`, new `mcp` connector domain). While the in-house agent handles a conversation, the remote server's tools are composed alongside the built-in ones under an `ext_<connection>_` namespace, so the agent can answer from the org's own system of record — subscriptions, memberships, internal CRM data — without Munin persisting any of it.

  The trust model externalizes the discipline the built-in self-service tools already follow: remote tools take no identity parameters. Munin sends a short-lived ES256-signed identity assertion (`X-Munin-Identity` JWT) on every call, verifiable against a new public per-org JWKS endpoint (`/v1/public/connectors/:orgId/jwks`, keys minted lazily into the new `connector_signing_keys` table).

  The assertion deliberately carries no `verified` boolean. It reports `email_provenance` / `phone_provenance` — `authenticated` (identity-verified widget session or delegated token), `channel_asserted` (an email `From:`, SMS sender or caller ID, all spoofable), or `self_reported` (typed by an anonymous visitor) — and the receiving server decides what each level may disclose. Provenance is computed from the channel the current turn arrived on, not from the end-user record, so an identity that was authenticated once in the widget is still reported as `channel_asserted` when someone later emails claiming to be that person. Unknown channels fall back to `channel_asserted` rather than over-claiming.

  Because the connected server is a _customer-facing_ tool source rather than a toolbox for admin agents, a connection exposes nothing by default: only tool names listed in the connection's `allowedTools` reach a conversation, a call to a withheld tool is refused even if the model guesses the name, and a server with an empty allow-list stays connected and silent. `connectors_test_connection` reports what the server offers versus what is actually exposed, warns about exposed tools the server has not marked read-only, and flags allow-listed names the server does not provide.

  Remote listings are capped at 20 tools, descriptions are sanitized and truncated before reaching the model, results stay fenced as untrusted data, all outbound traffic goes through the SSRF-guarded fetch (new `safeFetchCompat` in `@getmunin/core`), and a down or slow server degrades to "agent runs without those tools" — never a failed conversation.

  Setup follows the existing connector flow (credential link for the bearer token, `connectors_test_connection` probes the server and lists its tools), the dashboard Integrations page gets a Custom MCP card, and `skill://connectors/connect-custom-mcp-server` documents the server contract with a reference implementation to hand to the customer's developers.

  `skill://connectors/connect-external-system` also gains the same caveat for the built-in commerce and bookings connectors, whose self-service tools have always trusted an inbound email `From:` header or SMS sender the same way: fine for order status, not sufficient on its own for anything whose disclosure to the wrong person causes real harm.

  `SectionHead` in `@getmunin/ui` gains an optional `subtitle` slot, and the Integrations page's private copy of that component is deleted in favour of it — the copy had drifted to a smaller heading than every other settings page used.

  The docs site gains an Integrations guide category and a "Connect your own system" guide covering the customer-facing warning, the allow-list flow and the provenance levels — the first guide-level documentation for connectors of any kind.

### Patch Changes

- 9991922: Add Google Search Console to the `seo` domain, behind the same `seo_*` tools.

  This is the payoff for drawing `SeoAdapter` before there was a second vendor: `GoogleSearchConsoleAdapter` implements the same contract, registers into the same domain, and every `seo_*` tool works against it with **no tool-layer change at all**. It authorizes through the connector trunk's OAuth capability, so there is no Google-specific auth code either — an org supplies its own OAuth client id and secret, then approves the Google account by redirect.

  **Where the two engines genuinely differ, the interface admits it rather than faking it.**

  `submitUrls` is optional on `SeoAdapter`, and Google doesn't implement it: Search Console has no URL-submission endpoint (its Indexing API covers only job postings and broadcast events). So `seo_submit_urls` refuses on a Google connection with a message naming the vendor, instead of silently no-op'ing or pretending to queue something. Field coverage differs the same way — Bing reports `httpStatus`, `discoveredAt` and `inboundAnchorCount`; Google reports `detail`, its coverage state, which is the single most useful string it has ("Submitted and indexed", "Crawled - currently not indexed"). `detail` is new on `SeoUrlStatus` and null for Bing. A null field means the engine doesn't expose it, not that the value is zero, and the skill and tool descriptions now say so.

  **Both engines aggregate identically despite reporting differently.** Google honours an exact date range where Bing returns whole weeks, but the adapter still requests `['date', <dimension>]` and folds rows the same way — impressions and clicks summed per key, `avgPosition` weighted by impressions, `ctr` recomputed after aggregation rather than averaged from per-row values. That keeps the returned `window` honestly derived from the rows present in both adapters, so an agent reading one result cannot tell which engine produced it except by the fields that are null.

  Two Google specifics worth recording. The authorize URL sets `access_type=offline` **and** `prompt=consent`, because without forced consent a repeat authorization returns no refresh token and the connection would appear to succeed and then fail on first refresh. And `invalid_grant` on refresh maps to `OAuthGrantRevokedError` while every other token failure stays a vendor error — that distinction is what lets the trunk mark a connection `expired` for a genuinely dead grant without doing so on a transient Google 500.

  Property paths are URL-encoded, so both `https://example.com/` and `sc-domain:example.com` properties work.

  `webmasters.readonly` is a sensitive scope. An org's own OAuth client works unverified against accounts it owns, which is the self-hosting and single-tenant case; distributing one client to customers requires Google app verification (CASA assessment, privacy policy, demo video).

  **Unrelated fix, surfaced by this work:** `runMigrations` now takes a Postgres advisory lock for the duration. Concurrent callers were racing `CREATE EXTENSION IF NOT EXISTS`, which fails with `tuple concurrently updated`. It only bites on a cold database — several integration test files calling `runMigrations` at once — so it never reproduced on a warm local DB and would have shown up as a flaky CI failure in a file unrelated to whatever change added the extra racer. Adding two integration test files here was enough to trigger it.

- 8ebf92a: Publishing several locales of one article now posts one Slack line with a thread, not four headlines side by side.

  A four-locale batch published four near-identical announcements into the content channel, and nothing in them said they were the same article. `cms.entry.*` payloads now carry `translationGroupId` — the id every locale variant of an article already shares, which webhook subscribers can use to revalidate a whole language switcher — and the bridge worker threads on it: the locale that publishes first gets the channel message, the rest of its group post as replies under it, and Slack's own reply count does the summarising.

  Grouping is per UTC day, following the outreach-campaign parent already in `slack_notification_links` (new `subject_type` `cms_translation_group`, no buttons, never resolved). A locale published the next day starts a fresh channel message rather than reviving yesterday's thread, and an entry with no siblings posts exactly as before. No migration — the existing table carries it.
  - @getmunin/types@5.11.0

## 5.10.0

### Minor Changes

- 3136f2b: A curation candidate can now propose a new version of a document that already exists, instead of only a new document beside it.

  `kb_propose_curation_revision` files a proposed body against an existing `documentId`; `kb_publish_curation_revision` applies it as a new version of that document, so `kb_list_versions` and `kb_restore_version` roll a bad revision back. It takes two versions — the candidate text that was reviewed and the document text it was diffed against — and refuses if either moved, writing nothing. `kb_publish_curation_candidate` refuses a revision candidate rather than quietly publishing a duplicate.

  This is what a corrected fact should produce. A human editing an agent draft usually contradicts a document the draft was built from, and the old flow could only file a new FAQ beside the stale one, leaving the wrong text in place for the agent to retrieve again.

  Revisions share one review queue with new-document candidates: `kb_list_curation_candidates` carries `revisesDocumentId` plus the revised document's current title and version, and each surface branches per row — the dashboard drawer and the MCP Apps panel render a diff against the current text (new `BodyDiff`, backed by a dependency-free line differ in `@getmunin/types`), the control plane gains `POST /v1/kb/curation/candidates/:id/publish-revision`, and Slack shows the card without a publish button, since its approval value carries only one version. The panel's "loading" state for a candidate body was also unreachable — it reported a load failure while the fetch was still in flight.

  Curation decisions are now keyed by conversation **and** source message (`kb_curation_decisions.source_message_id`). One conversation can legitimately surface several corrections across turns; the old conversation-wide key closed it to curation after the first. Decisions recorded before this keep the whole-conversation lock, so nothing already dismissed reopens. Related: `kb_propose_curation_candidate` accepted `sourceMessageIds` and silently dropped it — the first entry is now persisted.

  `skill://kb/review-content` delta mode now prefers a revision over a new document and says how much to change; `kb_get_document`, `kb_list_curation_decisions` and `kb_propose_curation_revision` are added to the skill's runner allow-list. The skill's step 0 has always required `kb_list_curation_decisions`, which the runner could not call, so "skip already-decided sources" silently never ran.

- 3136f2b: Outreach keeps the draft as first written when a human edits a proposal, and can feed that edit to KB curation.

  `applyRevision` overwrote `draftBody`, so the original text was gone the moment anyone touched it — the proposal recorded that it had been revised, and by whom, but not from what. `original_draft_body` now captures the pre-revision body on the first revision made by a signed-in person; an agent revising its own draft before human review is not a human edit and does not set it. The outreach review drawer renders the two as a diff.

  The column is named for the original rather than for who wrote it: proposals are normally drafted by the curator agent, but `proposedByActorType` can be `user`, and then it holds a person's text.

  Approving a proposal a human edited can enqueue a delta-mode KB curation pass, gated by a new per-campaign `autoCurateEdits` flag that defaults **off**. Outbound copy is edited mostly for tone, length and personalisation, so this is opt-in per campaign rather than on by default; the pass is told to hold this source to a higher bar and file nothing unless the human corrected a fact about the product or the company. A proposal approved exactly as drafted enqueues nothing, and neither does an edit the human reverted.

  `skill://kb/review-content` delta mode now covers both sources — a conversation draft and an outreach proposal — and `outreach_get_proposal` joins the skill's runner allow-list so the pass can read both bodies in one call.

### Patch Changes

- 12d3b36: Mirror voice conversations into Slack in turn order, and stop Slack serving a stale cached avatar.

  A voice call's Slack thread showed the agent answering questions before they were asked: agent turns were hoisted above the caller turns they replied to, and two consecutive caller lines came out swapped. The stored data was never wrong — `conv_get_conversation` returned the same call in the right order, with `created_at` values already strictly increasing in `metadata.voiceTurnIndex` order.

  The order was lost at delivery time. A Slack thread is append-only, so the order the bridge worker drains `slack_deliveries` in _is_ the order a reader sees, and the drain ordered by `created_at` — the enqueue time, i.e. when the vendor's webhook arrived. Webhook arrival order is not turn order for a voice transcript: an agent turn finalizes as soon as it is spoken, while the caller turn that prompted it is still being finalized by ASR, so the reply is enqueued first. (The apparent grouping of two agent turns into one block is Slack's own collapsing of adjacent same-username posts — correct behavior applied to a wrong order.)

  `slack_deliveries` now carries the mirrored message's own position instead: `order_at` is the message's `created_at` and `order_seq` its `metadata.voiceTurnIndex`, both stamped by the event sink at enqueue time, and the drain's head-of-line gate and `ORDER BY` key on `(order_at, order_seq, created_at, id)`. `voiceTurnIndex` is the authoritative sequence when two turns share a timestamp; leading with `order_at` keeps rows that mirror no message — status changes, assignments, handovers, the voice-call-started note — at the real-time position they happened, rather than pushing every non-turn event to one end of the thread. Existing rows are backfilled from `created_at`, which reproduces the ordering they have today, and non-voice conversations keep ordering by message `created_at`.

  On the ingestion side the `turnIndex` fallback used when a transcript event omits one counted every message in the conversation, so it drifted on any non-transcript row and could hand two concurrent turns the same index — which then produced two identical synthetic timestamps. It now takes `MAX(voiceTurnIndex) + 1` over the turns of that call.

  Separately, a caller identified only by a phone number still rendered the pre-4.66 single-dot avatar in Slack even though the `user-round` icon shipped weeks ago and the endpoint serves it correctly. Slack's image proxy had cached the old bytes against `/v1/slack/avatars/default.png`, which is sent `cache-control: immutable, max-age=31536000` — so it never re-fetched. Avatar URLs are now content-addressed (`default.<8-hex>.png`), so changing an icon changes its URL; the un-hashed paths keep serving so avatars in already-posted threads don't break.

- Updated dependencies [3136f2b]
- Updated dependencies [3136f2b]
- Updated dependencies [b8690cb]
  - @getmunin/types@5.10.0

## 5.9.0

### Minor Changes

- 2e00517: Remove `conv_create_channel`. It took `config` as a free-form object and persisted it verbatim, with no per-type validation, no encryption and no credential slots — so an email channel created through it read as complete in `conv_list_channels` and was unusable: the stored config failed the schema every later read applied, the credential link could not describe its password fields, and the dashboard had nowhere to save them. A plaintext `password` passed in that config was stored unencrypted and echoed back, since config masking only covers `encrypted*` keys.

  Both remaining types already have a tool that provisions them properly, and the type this tool made easiest to reach was the one it broke: `conv_configure_email_channel` validates the transport config, encrypts secrets and returns a credential link; `conv_create_widget_channel` mints the widget key a chat channel cannot work without. Voice and SMS were removed from this tool for the same reason in 4.76.0; nothing remained that it could create correctly. Use those tools instead, or `conv_import` when moving historical channel rows between servers.

  Migration `0073_conv_email_channel_credential_slots` repairs email channels already written that way: it adds the missing `encryptedPassword` slots, deactivates the channel so an existing credential link can complete it, and drops any plaintext `password` key.

### Patch Changes

- 974470b: Make the end-user identity spine addressable over MCP: `identity_resolve`, `identity_get`, and an `endUserId` filter on `conv_list_conversations`.

  `end_users` is the record that actually unifies a person across channels — it is created deterministically the first time someone reaches the org by email, widget chat, or an analytics `identify` call. `crm_contacts` is derived from it and is lossy: the row is written by a curator pass that runs only when a conversation _closes_, and that pass is instructed to decline for mailing lists, auto-replies, bounces, and conversations where nothing identifying was volunteered. Until now the derived record had the full tool surface — create, update, search, lookup, merge proposals, consent, segments, activities — and the durable one had none. An agent could observe an `endUserId` only as an opaque field on a conversation, with no way to go from an email address to the identity it belongs to, which pushed agents toward `analytics_export_config` as an improvised lookup.

  - `identity_resolve` takes an email, phone, external id, or analytics visitor id and returns the matching `endUserId`, which identifier matched, and `crmContactId`. It is strictly read-only: a miss returns a null `endUserId` and leaves no row behind. It is a read-only sibling of `resolveIdentifiedEndUser`, not a call into it — that function is a write path that inserts, adopts provisional identities, and declines contested emails — but it reuses the same match order so the two agree.
  - `identity_get` returns one end user with a cross-channel summary: channel types written on, conversation count and recency, linked analytics visitor ids, view and search event counts, and the ids of the matching CRM and conversation contacts. Orders and bookings are deliberately excluded — those are live reads against a customer's own store or booking vendor, so folding them in would make every identity lookup slow and make it fail whenever a vendor is down.
  - A null `crmContactId` now means something an agent can act on: "known person, CRM pass has not run or declined", as distinct from "unknown person". `skill://identity/look-up-a-person` spells out the difference, because conflating them is the failure mode this surface exists to prevent.
  - Both tools are admin-audience under a new `identity:read` scope. `identity_resolve` accepts an arbitrary email, so it must never gain a self-service twin: the `commerce` and `bookings` self-service tools bind to the caller's email server-side precisely so an end-user agent cannot look up a third party, and an end-user-audience resolve would be the bypass for that whole design.

  The end-user service also moves out of `end-users.controller.ts`, which was querying the database inline, into `IdentityService`, so the `/v1` controller and the MCP tools are both thin wrappers over one service. The `/v1/end-users` request and response shapes are unchanged.

  Separately, `conv_message_reads` ids move from the `cmr_` prefix to `cvr_`. `cmr_` was minted by both `conv_message_reads` and `cms_references`; `cms_*` consistently uses `cm*`, so `cms_references` keeps it and conversation reads move to `cvr_`, matching `cvm_` for `conv_messages`. Existing ids are rewritten in place, which is safe because the table is a leaf with no inbound foreign keys and only the prefix changes. The prefix is minted in two places — the schema default and a raw `INSERT` in the realtime gateway — and both move. The backfill runs inside a `bypass_rls` block: `conv_message_reads` is `FORCE ROW LEVEL SECURITY`, which applies to the table owner too, so without it the update matches no rows on a real deploy while looking green in CI, where migrations connect as a superuser.

  Not included, and deliberately: there is still no way to merge two end users. Ten columns reference `end_users.id` and a merge has to free the loser's unique email and external id and dedupe the `(message_id, end_user_id)` index on message reads. `resolveIdentifiedEndUser` already detects the two-identities-one-human case and names it `email-held-by-another-identity`, declining to steal the address; nothing yet surfaces or resolves that state.
  - @getmunin/types@5.9.0

## 5.8.0

### Patch Changes

- 2c7e3fd: Audit log: show the agent icon in front of the client, and stop calling every browser
  "dashboard".

  `GET /v1/audit-logs` now returns `clientIconUrl` alongside `clientName`, read from the
  OAuth client's registered logo, and the client column renders the same glyph the Agents
  page uses (icon when the client registered one, first-letter fallback otherwise). The
  glyph moved into a shared `ClientGlyph` component so both pages stay in sync.

  `classifyClient` used to label any `Mozilla/*` user agent `dashboard`, which swept up
  every other browser caller — a customer's own web UI, a docs "try it" console, Swagger.
  `dashboard` now requires a session-authenticated actor with no OAuth client (only our
  own dashboard holds a BetterAuth session cookie); every other browser caller classifies
  as the new `browser` kind, filterable from the client dropdown. Audit rows also record
  the calling `origin` (`Origin` header, falling back to the `Referer`'s origin), so a
  `browser` row shows the origin host — `docs.getmunin.com` — instead of a generic label,
  with the full origin and user agent in the cell tooltip. Existing rows keep a null
  origin and read as the bare kind.
  - @getmunin/types@5.8.0

## 5.7.0

### Minor Changes

- 5818e0e: Remove the agent-as-actor identity model.

  The `agents` table has never held a row — nothing in the codebase inserts into it — and neither does anything set `tokens.agent_id`. `claims.agent_id` could only be written by a claimer whose actor id starts with `agt_`, which requires `tokens.agent_id`, so agent-held claims have never existed either. Conversation claims are an operator lock: they are taken only when a human sends a message, and read only to block the AI from replying over a human (`HandoverActiveError`). "The AI is handling this conversation" is modelled by `conv_conversations.agent_mode`, which is untouched.

  Dropped: the `agents` table and its RLS policy, `claims.agent_id`, `tokens.agent_id`, and `ClaimManager` from `@getmunin/core` — a generic entity-claim helper keyed on agent id with no callers in this repo or munin-cloud. `ConversationClaimsService` keeps its full behavior for user claims.

  `ClaimHolderType` narrows from `'user' | 'agent'` to `'user'`, which flows through the `/v1/conversations` claim DTOs, the `conversation.taken_over` and `conversation.released` webhook payloads, and `@getmunin/agent-runtime`'s claim type. The `'agent'` value has never been emitted, so consumers switching on it only lose a dead branch — but it is a type-level break, hence the minor bump.

  The migration refuses to run if any of the above turns out to be false in a real database: it raises rather than dropping when `agents` has rows or either `agent_id` column holds non-null values.

### Patch Changes

- 233842d: Attribute MCP activity to the agent that made it.

  The usage page's "By agent" table was always empty, and the Agents page never showed a last-used time. Both read from identity that was never recorded. OAuth-authorized agents (claude.ai, Claude Code) resolve to `actor_type = 'user'` with `actor_id` set to the authorizing user — deliberately, because their permissions derive from that user's org role — so the by-agent query's `actor_type IN ('admin_agent','end_user_agent')` filter excluded them, and its join against the `agents` table dropped whatever was left: nothing in the codebase ever inserts a row there. Even with the filter widened, `actor_id` could not have separated two connectors authorized by the same person.

  `audit_log` now records `client_id`, the OAuth client the credential was issued to, taken from `oauth_access_token.client_id` for opaque tokens and the `azp` claim for JWTs. The by-agent report groups on it (joined to `oauth_client` for the connector name) and no longer consults the vestigial `agents` table; admin API keys, delegated end-user agents and the in-process agent runtime resolve to their own labels instead of being filtered out. Average latency is now a call-weighted mean rather than an average of per-group averages. The Agents page derives last-used from the newest audit row per connector, so it fills in as traffic arrives rather than being hardcoded null.

  The audit log's Client column also stops reporting "unknown" for traffic it can identify: browser requests classify as `dashboard`, widget callers as `widget`, and the transport-level `POST /mcp` row as `mcp` (previously only the row carrying a tool name matched). Where a row has an OAuth client, the column shows the connector's name instead of a coarse bucket.
  - @getmunin/types@5.7.0

## 5.6.0

### Patch Changes

- @getmunin/types@5.6.0

## 5.5.0

### Patch Changes

- @getmunin/types@5.5.0

## 5.4.0

### Patch Changes

- @getmunin/types@5.4.0

## 5.3.0

### Patch Changes

- @getmunin/types@5.3.0

## 5.2.2

### Patch Changes

- @getmunin/types@5.2.2

## 5.2.1

### Patch Changes

- @getmunin/types@5.2.1

## 5.2.0

### Patch Changes

- @getmunin/types@5.2.0

## 5.1.0

### Patch Changes

- Updated dependencies [be67821]
- Updated dependencies [be67821]
  - @getmunin/types@5.1.0

## 5.0.2

### Patch Changes

- @getmunin/types@5.0.2

## 5.0.1

### Patch Changes

- @getmunin/types@5.0.1

## 5.0.0

### Minor Changes

- 39613c3: Analytics `identify` accepts a signed email, so web analytics and the email inbox converge on one identity

  `window.mn.identify(externalId, userHash, { email })` now takes an optional email trait, and the email address is covered by the HMAC — an unsigned or mis-signed address is rejected, so a browser cannot claim someone else's address and pull down their journey.

  This closes a split that used to be invisible. Inbound email creates a provisional identity keyed `email:<address>`; `identify` created one keyed by the customer's own id. The same human ended up as two `end_users` rows, and neither the contact journey nor the funnel could see across them. Now:

  - **Email first, sign-in second** — `identify` finds the provisional row by address and promotes it in place. `external_id` becomes the caller's id and the row id is unchanged, so every conversation, CRM contact and analytics event already pointing at it stays attached. No merge, no FK repointing.
  - **Sign-in first, email second** — inbound mail resolves by the email column and reuses that identity instead of forking a provisional one. Both inbound paths (email channel and channel webhooks) share one resolver.
  - **Two established identities already hold the address** — nothing is merged; the conflict is logged as `identify.email_conflict` for an operator to resolve. Auto-merging two real people on a page load is not a decision this code should make.

  The identity payload is now length-prefixed per field (`mn.identity.v1`) so no value can be shifted across a field boundary — the previous `${externalId}:${visitorId}` form was ambiguous, and Munin's own provisional ids contain a colon. Integrations that send no email keep working: the legacy payload is still accepted in that case.

  Adds a partial unique index on `(org_id, lower(email))`, which is what makes the two paths converge rather than race.

  Existing duplicates are merged by the migration rather than left for an operator, because a self-hosted deploy has no one to hand-merge them. The rows are the same human by construction — one address, one org — so only the survivor is a decision, and it is ordered rather than guessed: a real `external_id` beats a provisional `email:<address>` one, then oldest, then id. Every reference is repointed before the losers are deleted, and the keeper backfills its own null `name`/`phone` from them, so nothing is detached and nothing is overwritten. Read receipts are deduplicated to the earliest per message, since `(message_id, end_user_id)` is unique and the same read can sit on the keeper and on two different losers at once. Each merge is announced with a `RAISE NOTICE` naming the address and the surviving id.

### Patch Changes

- Updated dependencies [ace185f]
  - @getmunin/types@5.0.0

## 4.81.0

### Minor Changes

- 42abe67: Analytics: separate the stats per tracker.

  An org with several trackers (marketing site, docs, app) could mint one key per site but only ever read the sum: every query tool aggregated across the whole org, and `analytics_view_events.tracker_id` was written but never read. Search events didn't even record which tracker sent them, so `analytics_list_zero_result_searches` could never be split.

  Every analytics read tool now takes an optional `trackerId` — `analytics_list_top_subjects`, `analytics_list_top_countries`, `analytics_list_traffic_sources`, `analytics_list_referrer_hosts`, `analytics_get_views_over_time`, `analytics_get_subject_engagement`, `analytics_get_funnel`, `analytics_get_contact_journey` and `analytics_list_zero_result_searches`. Omitting it keeps the previous org-wide behaviour; an id that doesn't belong to the org is a `404` rather than an empty result, so a typo can't be misread as "no traffic".

  `analytics_search_events` gains a `tracker_id` column (migration `0068`), stamped by the `/v1/a/s` ingest endpoint from the tracker key. Pre-existing rows and searches Munin ran itself through the CMS delivery API stay NULL and are excluded from tracker-scoped queries. Views recorded through the token-signed CMS entry pixel/beacon carry no tracker either — filter those with `source` instead.

  Analytics export/import now round-trips the tracker foreign key on both event kinds, resolved through the transfer `idMap`, so moving an org between servers no longer flattens per-tracker attribution.

### Patch Changes

- @getmunin/types@4.81.0

## 4.80.1

### Patch Changes

- @getmunin/types@4.80.1

## 4.80.0

### Patch Changes

- 556e620: Redesign Channels and Trackers as card grids matching the Integrations page, and give Trackers real 7-day view stats.

  Channels and Trackers rendered as full-width `<ul><li>` rows while Integrations already shipped a bordered-card grid (`IntegrationCard`/`CardMenu`/`StatusLine`/`CardGrid`), so the three settings pages didn't read as one family. `CardGrid`, `CardMenu`, and `StatusLine` move out of `components/integrations/integration-card.tsx` into a new shared `components/card-kit.tsx`, alongside a new `SettingsCard` shell: mono kind eyebrow (chat/email/SMS/voice — no logo tile, since nothing real would go in one) with the vendor logo + name demoted to footer metadata, serif name with a mono qualifier, an always-visible status line, a one-line description, and a 1.5px amber top rule for anything needing attention (awaiting credentials, never fired). A new `CardGridSkeleton` gives the loading state the same shape as the loaded grid; the Integrations page itself is visually untouched (only its internal imports move), and Channels/Trackers keep their existing `EmptyCallout`/`LoadFailed` empty and error states unchanged.

  Trackers' cards also show a 7-day view count and sparkline per tracker. `analytics_view_events` previously had no way to attribute a view to a specific tracker — the ingest controller resolved the tracker from its API key but discarded the id before calling `recordView` — so this needed a small backend addition: a nullable `trackerId` column (+ index) on `analytics_view_events`, threaded through from the two ingest call sites, a new `AnalyticsService.trackerViewSummaries()` aggregation, and a dashboard-only `GET /v1/analytics/trackers/views-summary` endpoint (kept off the `analytics_*` MCP tool surface deliberately). Phone-number qualifiers (SMS `fromNumber`/`originator`) now format through `libphonenumber-js` instead of showing the raw E.164 string.
  - @getmunin/types@4.80.0

## 4.79.0

### Patch Changes

- ef55960: Fix two voice channel bugs found while testing Threll:

  - Phone calls stored every transcript turn twice. Threll redelivers the full call transcript as a burst of `call.transcript` events shortly after the live turns already streamed in, with no signal distinguishing the redelivery from the original. `ThrellAdapter` now dedupes voice messages on insert via a partial unique index on `(conversation_id, threllCallId, voiceTurnIndex, threllRole)`, so a redelivered turn is dropped instead of creating a second `conv_messages` row — and a second copy mirrored into Slack. The migration also collapses turns already duplicated on existing deploys, keeping the earliest copy of each.
  - A voice call that auto-closed on hangup still looked open everywhere except the dashboard. Both voice adapters closed the conversation with a raw `UPDATE` and emitted only `conversation.voice.call_ended`, which no operator bridge consumes: `conversation.status_changed` never fired, so the Slack thread parent kept rendering the open state with a "Close" button until someone clicked it, and the `skill://crm/extract-contact-from-message` pass that every other close enqueues never ran for voice — the channel most likely to have a name or email volunteered out loud. `ThrellAdapter` and `VapiAdapter` now write call metadata and then route the status transition through `ConvService.changeStatus`, so an auto-close emits the same events, clears human-attention state, releases the runner lease, and enqueues the same follow-up job as a manual close.

- 068fb46: Show voice transcript turns in the order they were spoken.

  Threll redelivers the full call transcript as a burst of `call.transcript` events around `call.ended`, and on a browser voice call that burst is the only delivery — no turns stream in live. Munin handled each webhook the instant it arrived, so nothing was delayed on our side, but `conv_messages.created_at` was left to its `now()` default and so recorded when the webhook was _processed_, not when the turn was spoken. Every read path orders by `created_at`, so a burst that arrived grouped by speaker rendered as every agent turn followed by every caller turn. A real call in the widget produced exactly that.

  `ThrellAdapter` now derives `created_at` from the `turnIndex` Threll already sends, anchored to the call's start (`metadata.voiceStartedAt`, falling back to the conversation's own `created_at` for inbound phone calls). `turnIndex` was already being captured into `metadata.voiceTurnIndex` and never read. It also makes the timestamp idempotent across redeliveries: the turn dedup added alongside this keeps whichever copy inserted first, and an arrival-time `created_at` meant that copy decided where the turn sorted. `handleEnded` no longer deletes `voiceStartedAt`: transcripts and `call.ended` arrive in the same burst with retries, so a straggler processed after the call closed would otherwise re-anchor to a conversation that opened days earlier and scatter those turns through the chat history. Nothing reads the field, so keeping it is free.

  Backdating `created_at` collided with the widget's incremental fetch, which is the only way a rendered conversation ever gains a message: the realtime event carries no body, it just triggers `backfillSince(lastSeenAt)`, and `lastSeenAt` is a monotonic high-water mark. The "Call ended · 00:36" separator is a real message inserted at real time, so it pushed the cursor past the entire call before the transcript burst landed — and every backdated turn then sat below the cursor and was never delivered at all. Ordering the rows correctly in the database would have traded a scrambled transcript for a missing one.

  So `created_at` is now purely the display clock and `conv_messages.ingested_at` (default `clock_timestamp()`) is the arrival clock. The widget's `since` filter and page ordering both move to `ingested_at`, the response carries an explicit `cursor` the client advances instead of inferring one from the last message's `at`, and rows are sorted by `created_at` before serialization. `clock_timestamp()` rather than `now()` because `now()` is fixed for a transaction: a batch that inserts several turns at once — Vapi's end-of-call report does — would tie on the cursor column and let keyset pagination skip rows. The server-computed cursor also advances past a page of internal-only messages, which previously stalled the `while (hasMore)` loop.

  `ui.addMessages` inserts by timestamp instead of appending, so a turn that arrives late but was spoken earlier lands in the right place without waiting for a reload.

  Existing rows inherit `created_at` as their `ingested_at`. The backfill runs inside a `bypass_rls` block because `conv_messages` is FORCE ROW LEVEL SECURITY, which applies to the table owner too — without it the `UPDATE` matches nothing on a live deploy while a fresh CI database, where the policies are applied only after migrations run, looks green.

  Vapi has the same display-ordering defect and is untouched here: `handleEndOfCallReport` inserts every turn of a report inside one transaction, so all of them share a `created_at` and `ORDER BY created_at` breaks ties arbitrarily.
  - @getmunin/types@4.79.0

## 4.78.0

### Minor Changes

- 5802b45: Outreach: `proposedSendAt` now actually schedules a send

  A proposal's `proposedSendAt` used to be inert metadata — it was stored, revisable and exported, but approval always delivered immediately and no worker ever read the column. Approving a draft that said "send Tuesday 09:00" sent it on the spot.

  Approval is now the authorization, and the send time is honored:

  - `outreach_approve_proposal` takes an optional `sendAt`. With no argument it inherits the draft's `proposedSendAt` when that is still in the future; `sendAt: null` forces an immediate send; a `sendAt` in the past is refused. A scheduled proposal parks at `status: 'approved'` with `scheduledSendAt` set, and `outreach_list_proposals({ status: 'approved' })` lists what is waiting, soonest first.
  - A new `OutreachSendWorker` drains due proposals (default every 60s, `MUNIN_OUTREACH_SEND_POLL_MS`, disabled by `MUNIN_OUTREACH_SEND_WORKER_DISABLED`) and re-runs every eligibility check at send time: campaign still enabled, contact not suppressed and still consented, and no prospect reply on a follow-up. A proposal that fails any of them goes to `status: 'failed'` with `failureReason` instead of being delivered. Quiet hours and blackout dates hold the send until the window opens rather than failing it. Transient delivery errors retry up to five attempts (`send_attempts`) before giving up.
  - New `outreach_cancel_scheduled_send` pulls an approved send back to `pending` before it goes out — the one real undo in outreach, and only before delivery.
  - New events: `outreach.proposal.scheduled`, `outreach.proposal.send_canceled`, `outreach.proposal.send_failed`.
  - The dashboard drawer names the inherited time on its approve button and offers Send now / Schedule…; a Scheduled sends section lists what is queued with a call-off action. The Inspector panel labels the button **Approve & schedule** and spells out the time above it.

  The one-proposal-per-(campaign, contact, kind) unique index now covers `approved` alongside `pending`, so a contact with a scheduled send cannot pick up a second in-flight draft. Proposals that were scheduled on a source server import as `pending` with a warning — no timer follows the data across servers.

### Patch Changes

- fdf6734: Give every locale variant of a CMS entry its own slug.

  `cms_entries` was already unique per `(collection, slug, locale)`, so a Norwegian row with slug `varlansering-2026` next to an English `spring-launch-2026` always stored fine. What blocked it was identity: the shared slug _was_ the link between locale variants — `skill://cms/localize-entry` told agents to create siblings with the same slug — so the moment the slugs diverged there was no way to answer "what are the other languages of this entry?". That question drives `hreflang`, language switchers, "which locales are still missing", and any decision about fallback.

  Entries now carry `translation_group_id`. Variants share it, `(org, group, locale)` is unique, and no locale in a group is privileged — which matters because `cms_set_default_locale` can flip the default at any time, and a parent/child model would have made that a data migration. Slug and group are independent: a shared slug across locales is now a stylistic choice (fine for product codes, wrong for prose) rather than the mechanism.

  `cms_create_entry` takes `translationOf` — the id of any entry in the group to join — and pre-checks the locale so a second `nb` variant conflicts with `cms_translation_conflict` instead of poisoning the request transaction into a bare 500. `cms_list_entry_translations` returns every variant with its own slug and status. `cms_link_translation` joins two entries that were authored separately and should have been linked; `cms_unlink_translation` undoes a wrong link by minting a fresh group of one. Changing an entry's `locale` through `cms_update_entry` gets the same group pre-check.

  The delivery API adds `_locales: [{ locale, slug }, …]` to a published entry — every _published_ variant in its group, which is what `hreflang` and a language switcher need, and which drafts never enter. It still matches on both slug and locale, and a pair with no published row is still a `404`: `skill://cms/localize-entry` claimed a server-side fallback to the default locale that the controller never implemented, and the honest fix is documenting the `404` rather than shipping the fallback. Serving English under a Norwegian URL is worse than a miss, and `_locales` lets a frontend redirect deliberately.

  Export/import keeps variants linked: `translationGroupId` rides along in the payload and is remapped to local groups on import. Payloads written before this change fall back to grouping by `(collection, slug)` — the old convention — and a variant whose target group already holds its locale is imported standalone with a warning rather than failing the import.

  Migration `0062_cms_entry_translation_groups` backfills the same way, deriving the group id from `(collection_id, slug)` so it is idempotent and identical across environments. It sets `app.bypass_rls` inside the backfill: `cms_entries` is `FORCE ROW LEVEL SECURITY` and no `app.org_id` is set during a migration, so without it the `UPDATE` matches zero rows on a real deploy while a fresh CI database looks green.

- 59634b2: Let `conv_list_conversations` express the curation sweep's eligibility rule.

  `skill://kb/review-content` told the sweep agent to scope to "the last 7 days of resolved handovers" and to pass `since` to `conv_list_conversations`. That tool had no `since` and no handover filter, so both rules were prose the agent could skip — and on 2 August the weekly sweep skipped both, drafting KB candidates from six-week-old conversations that never had a handover at all.

  Worse, the field the skill named as the handover signal does not survive the handover. It claimed `needsHumanAttentionAt` "is set whenever the conversation was _ever_ flagged, even if the flag has since been cleared". Both clear paths — a non-internal staff reply, and closing the conversation — set `needsHumanAttention = false` **and** `needsHumanAttentionAt = null`. A resolved handover was indistinguishable from a conversation the agent handled alone.

  `conv_conversations.handover_resolved_at` is stamped when the flag clears (only for rows that were actually flagged) and nulled when a handover is re-requested. `conv_list_conversations` gains:

  - `handover: 'active' | 'resolved' | 'never'` — waiting on a human, answered and cleared, or no handover on record.
  - `since` — ISO 8601; keeps conversations whose `lastMessageAt` is at or after it. A malformed value is a `conv_invalid` error, not a 500.

  `handoverResolvedAt` is on the conversation DTO. It is null for everything resolved before this migration — there is nothing to backfill, since the timestamp was being erased — so old conversations do not appear under `handover: 'resolved'`. The skill says so, and the sweep prompt now names the exact call.

- 992f78a: Make a dismissed KB curation candidate stay dismissed.

  Candidates are `kb_documents` rows that are deleted on dismiss and on publish, and the only thing stopping a curation pass from refiling a source conversation was a candidate still sitting in `kb-curation-inbox`. Empty the inbox — review a batch, publish two, dismiss the rest — and the next weekly sweep redrafts the same conversations from scratch. That happened in production: candidates reviewed on 26 July came back on 2 August, six weeks after the conversations themselves.

  `kb_curation_decisions` records one row per decision (`dismissed` or `published`) with the reason, the deciding actor, and the published document when there is one. Rows outlive the candidate and the source conversation. `kb_propose_curation_candidate` now pre-checks the source conversation and throws `kb_curation_decided` when one exists, so the gate is enforced in the service rather than described in the skill — the "last 7 days" and "resolved handovers only" rules were prose-only, and the sweep that produced those drafts honored neither.

  Blocking is coarse and permanent, matching `crm_merge_proposals`: one decision retires the whole conversation, and there is no un-dismiss. Title matching would lose to rewording — the June and August drafts of the same answer had different titles. Something genuinely new from a decided conversation goes in with `kb_create_document`.

  New tools: `kb_dismiss_curation_candidate` (deletes the draft, records the decision, takes an optional `reason` and the reviewed `ifVersion`) and `kb_list_curation_decisions` (filter by `outcome` or `sourceConversationId`). Dismissing with `kb_delete_document` still records a reasonless decision, so the Slack button, the dashboard drawer and the Inspector panel are all covered by the same choke point in `removeDocument`.

  `POST /v1/kb/curation/candidates/:id/dismiss` accepts `reason` and `ifVersion`; `KbCurationDecidedError` maps to a 409 there. The dashboard drawer and the panel now say the dismissal is permanent.

- 180727a: fix(slack): mirrored replies lose their signature when the strip lands late

  An inbound email is mirrored into Slack the moment it is ingested, but the
  signature stripper is a curator job that runs afterwards — so the dashboard
  showed the cleaned one-liner while the Slack thread kept the full sign-off and
  contact block. `conv_strip_message_signature` now emits
  `conversation.message.body_revised`, and the Slack bridge edits the reply it
  already posted (`chat.update`) instead of leaving the stale copy in place.

  `slack_message_links.author_labeled` records whether the mirror had to embed the
  speaker's name in the message text (the `chat:write.customize` fallback), so the
  edit reproduces the same shape rather than silently dropping the author line.

- Updated dependencies [5802b45]
- Updated dependencies [180727a]
  - @getmunin/types@4.78.0

## 4.77.0

### Minor Changes

- cfa7b4f: refactor(outreach): first-touch replaces "initial" on the public surface

  `outreach_propose_initial_message` is now `outreach_propose_first_touch`, the campaign flag `autoDraftInitial` is now `autoDraftFirstTouch` (column `auto_draft_initial` → `auto_draft_first_touch`), and the three skills `skill://outreach/draft-initial-{email,sms,call}` are now `skill://outreach/draft-first-touch-{email,sms,call}`.

  The three propose tools file the three proposal kinds (`initial`, `reply`, `followup`), but only the first carried a medium in its name — `_message` was filler to make `outreach_propose_initial` grammatical, and inaccurate besides: the tool also files the script for an outbound voice call, which is not a message. Its description now says "first-touch outreach draft", the neutral term the input schema already uses (`draftSubject` / `draftBody`). The campaign flag had the same defect: `autoDraftInitial` paired with `autoDraftReplies` put a bare adjective next to a noun, while the surrounding descriptions had already switched to saying "first-touch".

  The weekly scheduled sweep follows: it is now `curator-outreach-first-touch`, reads `MUNIN_CURATOR_OUTREACH_FIRST_TOUCH_CRON`, and enqueues under the dedupe key `outreach-first-touch:scheduled`.

  Internals that track the stored kind keep `initial`: the `outreach_proposals.kind` value and `OutreachService.proposeInitial`.

  Breaking, with no aliases published:

  - callers that hardcode `outreach_propose_initial_message`
  - callers that send or read `autoDraftInitial` on `outreach_create_campaign` / `outreach_update_campaign` / `outreach_list_campaigns`
  - callers that read the old `skill://outreach/draft-initial-*` URIs via `skills_read` / `resources/read`
  - self-hosters who set `MUNIN_CURATOR_OUTREACH_INITIAL_CRON` — the old name is ignored and the sweep silently reverts to its weekly default, so rename it
  - campaign JSON exported before this release fails `outreach_import` validation on the renamed field

  Migration `0059_outreach_first_touch_rename` renames the column in place, so stored per-campaign values survive, and carries the persisted curator queue across. `job_uri`, `dedupe_key` and `source_event_type` are rewritten on every row — they point at things that were renamed, so history stays queryable and a pending row still dedupes against the next scheduled enqueue. `user_prompt` is rewritten only for `status = 'pending'` rows: the scheduler persists its prompt verbatim at enqueue time, so a queued job would otherwise wake up naming a tool and a skill that no longer exist, while a finished job's prompt is the record of what it was actually told. Every step is guarded and safe to re-run.

### Patch Changes

- Updated dependencies [cfa7b4f]
  - @getmunin/types@4.77.0

## 4.76.0

### Patch Changes

- Updated dependencies [1461e0e]
  - @getmunin/types@4.76.0

## 4.75.0

### Patch Changes

- Updated dependencies [c5a05c5]
- Updated dependencies [c5a05c5]
  - @getmunin/types@4.75.0

## 4.74.0

### Minor Changes

- cad7227: Analytics: one row per page view, read depth and route changes tracked by default, canonical subject ids, declarative events, generic search ingest, and identity backfill.

  **Breaking for dashboards, not for code: `views` changes meaning.** Until now every page load wrote at least two rows — the initial view plus an exit beacon carrying `dwellMs`, plus one more per SPA route change — so tracker-sourced `views` was inflated roughly 2×. The tracker now mints a `viewId` per page view and sends it on both beacons; ingest upserts on the new partial-unique `(org_id, client_view_id)`, so the exit beacon enriches the row instead of adding one. Tracker `views` drops ~50% on the deploy date; `visitors` is unchanged. History carries no `viewId` and is not repairable, so don't compare `views` across the upgrade. Beacons without a `viewId` still insert one row each — old cached bundles keep working.

  Enrichment is max-wins for `dwell_ms` / `read_depth` and fill-if-null for attribution (`referrer`, `utm_*`, `path`, `locale`, `country`, `metadata`, `end_user_id`), so an exit beacon that overtakes the initial view — `sendBeacon` guarantees no ordering — can create the row without erasing the real referrer. `clientViewId` is deliberately absent from `analytics_export_events` / `analytics_import`: it is an ingest dedup key, and merging two servers' events would collide on the index.

  **No new flags.** The bundle now measures scroll depth and tracks route changes for every site, and ingest canonicalizes subject ids, all without configuration:

  - **Read depth** — passive `scroll` + `resize` listeners, rAF-throttled, deepest 25/50/75/100 milestone, sent on the exit beacon so it costs no extra row. `avgReadDepth` in `analytics_get_subject_engagement` finally has data.
  - **Exit reporting on two triggers** — dwell and read depth are sent on `visibilitychange` → hidden as well as `pagehide`. Unload-only beacons are why `dwell_ms` was sparse (mobile app-switch and tab-kill often fire only `visibilitychange`), and reporting twice is free because enrichment is idempotent: same `viewId`, max-wins on both columns. The usual hidden-then-`pagehide` pair sends once; a reader who returns and leaves again reports a larger value. `dwell_ms` now accumulates only the time the page was visible, so max-wins can't be poisoned by a tab left open in the background — previously it was wall-clock from view start, which with two triggers would have made the inflated report the winning one.
  - **Route changes** — `history.pushState` / `replaceState` / `popstate` close the previous view and open a new one. Changes that leave `location.pathname` alone are ignored, so query-param filter and tab state costs nothing and a classic multi-page site never triggers it.
  - **Canonical subject ids** — trailing slashes are always folded (`/pricing/` → `/pricing`), and a leading locale segment is folded when it matches the locale the page itself reports via `<html lang>`, which every beacon already carries (`/en/pricing` on `lang="en-US"` → `/pricing`). The match is exact against the full tag or its language subtag, so `/enterprise/pricing` and `/uk/pricing` on `lang="en-GB"` are untouched, ids that don't start with `/` are never rewritten, and `path` always keeps the raw URL. **Existing localized sites will see subject ids move at the deploy date** — `/en/pricing` events start landing on `/pricing`, so one subject goes quiet and another appears.

  `analytics_create_tracker` / `analytics_update_tracker` take `canonicalLocales` for the two cases inference can't reach: pages that set no `lang`, and a URL prefix that disagrees with the tag (`/no/priser` on `lang="nb-NO"`). It applies from the next event with no site redeploy, which is why it lives on the tracker rather than in markup.

  Also new:

  - `data-mn-event` on any element records a click as a view event, with `data-mn-subject-type`, `data-mn-metadata` (defensively parsed JSON object) and `data-mn-once="session"`. `window.mn.trackOnce()` is the JS twin.
  - `POST /v1/a/s` and `window.mn.trackSearch(query, resultCount)` record search events from any search implementation. `analytics_list_zero_result_searches` previously only saw Munin's own CMS delivery search, which left every site running Pagefind/Algolia/a hand-rolled index structurally dark.
  - CMS entry views: `_tracking` now ships the bare `token` alongside `pixelUrl`/`beaconUrl`, and the tracker records entry views with a visitor id via `window.mn.trackEntry(token)` or `<div data-mn-entry-token="…">` — on the page that shows the entry, not on list cards, since a `cms_entry` view means "read this" and tagging an index would rank the homepage highest (the skill says so, and names a separate `subjectType` for impressions). The pixel cannot report `visitors` (it takes no visitor parameter, and a first-party cookie can't survive the cross-origin API) — that limitation is now stated in the skill instead of being discovered from `visitors: 0`.

  Identity linking backfills: `identify` (and the chat widget's own identity resolution) now stamps `end_user_id` on that visitor's anonymous `analytics_view_events` / `analytics_search_events` rows from the last 30 days, in the same transaction as the bridge row. The auto page view always beats the `identify` round-trip, so without this the first event of every new visitor's session stayed anonymous forever. Adds `analytics_search_events_visitor_idx` to keep that update indexed.

### Patch Changes

- Updated dependencies [cad7227]
  - @getmunin/types@4.74.0

## 4.73.0

### Patch Changes

- Updated dependencies [0ac33df]
  - @getmunin/types@4.73.0

## 4.72.0

### Patch Changes

- @getmunin/types@4.72.0

## 4.71.0

### Minor Changes

- 426a66e: CMS: keep the master, serve derivatives. Image assets now carry a ladder of WebP renditions and the delivery API hands out the light one.

  Until now an asset was delivered exactly as uploaded. The dashboard downscaled client-side before upload, but every other path — `cms_upload_asset_from_base64`, `cms_upload_asset_from_url`, presigned uploads, and generated images — stored whatever bytes arrived and served them verbatim. A 2.2MB PNG hero and a 99KB hand-uploaded JPEG could sit in the same library with no policy between them.

  - `cms_assets` gains `width`, `height`, `variants`, and `variants_version`. Variants are derived state: the original upload is always preserved as the master at `public_url`.
  - Uploads derive renditions at 320/640/1024/1536/2048px plus one full-size recompress (capped at 2560px), skipping any width at or above the source so nothing is ever upscaled. WebP at quality 80. For a 1536×1024 master the whole ladder costs ~10% of the master's bytes.
  - The delivery API rewrites inline `asset://` tokens to the widest variant instead of the master, and `AssetSummary` (typed asset fields and the `_assets` sidecar) now carries `width`, `height`, and the full variant list so consumers can build a `srcset`. Assets without variants keep resolving to the master, so nothing breaks while the library converges.
  - Generation is not a one-shot backfill. The existing CMS worker reconciles any asset below the current ladder version, which covers assets that predate this change, presigned uploads whose bytes arrived late, and generation that failed on the upload path. Changing the ladder later is a version bump rather than a new migration script, and generation on upload is therefore an optimisation rather than a correctness requirement.
  - Non-images and undecodable bytes are settled once so the worker stops reclaiming them. Batch size is tunable with `MUNIN_CMS_VARIANT_BATCH` (default 10 per tick).

### Patch Changes

- 5b49ac1: Slack outreach approvals now thread per campaign instead of posting one standalone message per draft: a parent message carries a live pending count (flipping to an all-handled banner at zero, with one parent per campaign per UTC day, so daily waves never land in a buried thread), each draft posts as a compact thread reply with a shorter body preview, and a new _View full draft_ button opens the complete subject and body in a Slack modal so reviewing no longer requires the dashboard.
- Updated dependencies [426a66e]
  - @getmunin/types@4.71.0

## 4.70.1

### Patch Changes

- @getmunin/types@4.70.1

## 4.70.0

### Minor Changes

- e123820: Add `outreach_revise_proposal` and `outreach_withdraw_proposal`, the two agent-side corrections to a pending outreach draft.

  `outreach_revise_proposal` rewrites the draft in place on the same proposal id — the contact and campaign are fixed, since a different recipient is a different proposal. A `reason` is required and the revision is recorded (`revisionCount`, `lastRevisedAt`, `lastRevisionReason`, revising actor), so an edit can never be silent. Proposals now also record the first time a human opens them for review; when a revision lands after someone else has already read the draft, `revisedAfterReviewAt` is stamped and both the dashboard review drawer and the MCP Apps inspector panel warn the reviewer that Wednesday's text is not the text they read on Monday.

  `outreach_withdraw_proposal` lets a curator retract its own pending draft — a duplicate, a prospect who turned out not to qualify, a bounced address — under a new terminal `withdrawn` status. Withdrawal is deliberately neutral: it does not suppress the contact, does not touch consent, and does not stop a campaign sequence, so a withdrawn follow-up leaves that step eligible again where a dismissed one ends the sequence for good. Slack approval cards resolve as withdrawn, and `skill://outreach/review-proposals` documents when each of the four verbs applies.

### Patch Changes

- Updated dependencies [e123820]
  - @getmunin/types@4.70.0

## 4.69.3

### Patch Changes

- @getmunin/types@4.69.3

## 4.69.2

### Patch Changes

- @getmunin/types@4.69.2

## 4.69.1

### Patch Changes

- @getmunin/types@4.69.1

## 4.69.0

### Minor Changes

- 18dc6a6: Slack approval notifications: pending CRM merge proposals, outreach drafts, and KB curation candidates now post to Slack with approve/dismiss buttons, and the message updates in place once the item is decided anywhere. New optional `approvals` channel route (`slack_set_routing` with `purpose: "approvals"`), falling back to escalations, then default. KB curation now emits `kb.curation_candidate.proposed/published/dismissed` events, and the CRM merge events `crm.merge_proposal.applied/dismissed` join the public event catalog. Adds the `slack_notification_links` table and a `subject_key` ordering column on `slack_deliveries` (migration 0055).

### Patch Changes

- Updated dependencies [18dc6a6]
- Updated dependencies [6f31549]
  - @getmunin/types@4.69.0

## 4.68.0

### Minor Changes

- 1482bbe: Connectors trunk: encrypted `connector_connections` storage behind a vendor-adapter registry, `connectors_*` admin MCP tools (list vendors, CRUD, credential test), `connectors:read`/`connectors:write` scopes, and the shared scope/identity helpers domain modules (commerce, bookings) build their typed read surfaces on.
- 8da0e90: Connectors management UI and secure credential handoff. The Integrations settings page gains a Data connectors section to list, add, test, and remove connections. Secrets can be entered inline or handed off: creating a connection without its secret returns a one-time link (`/connect/credentials`) a human opens to enter credentials in the dashboard, so secrets never pass through an agent conversation. Backed by a generic `credential_requests` handoff primitive (reusable by other MCP-set-up integrations) and a `/v1/connectors` control-plane API.
- 491186c: Multi-step outreach sequences. Campaigns can define ordered `sequenceSteps` (wait period + drafting brief per step, email campaigns only); a daily curator sweep (`skill://outreach/draft-followup-email`, `MUNIN_CURATOR_OUTREACH_FOLLOWUP_CRON`) finds conversations whose next step is due via the new `outreach_list_due_followups` tool and files `kind: 'followup'` proposals with `outreach_propose_followup` into the existing human review queue. Any inbound reply permanently stops a sequence (the reply flow takes over), as does unsubscribe/suppression or dismissing a follow-up draft. Follow-ups thread into the initial's conversation with no subject or unsubscribe footer, and export/import round-trips sequences.
- cdff1ad: Slack integration phase 3: claim/close buttons, live parent state, source-channel routing

  The thread parent message becomes interactive: Claim and Close buttons (Reopen once resolved) plus a live status line (status, claimed-by, assigned-to, needs-attention) that updates via `chat.update` as conversation events flow through the mirror. A signed interactivity endpoint (`POST /v1/slack/interactivity`) maps button clicks onto the existing service paths — `ConversationClaimsService.claim` and `conv_change_status` — as the clicking teammate, with the same account-linking rule and ephemeral rejections as thread replies (including "already claimed by someone else").

  Routing gains source-channel overrides: `slack_set_routing` with `convChannelId` mirrors conversations from one Munin conversation channel into their own Slack channel (widget → #support-chat, email → #support-email) while everything else keeps the default. Migration `0051_slack_route_overrides` adds the column and reworks the route uniques. Also fixes a phase-1 gap where routing two purposes at the same Slack channel surfaced as a bare 500 instead of a conflict.

  The Slack app manifest gains the interactivity request URL (`/v1/slack/interactivity`).

- 8037e74: Slack integration phase 1: mirror conversations into Slack threads (operator surface)

  - New `slack` module: per-org workspace connection via Slack OAuth (deployment-level app credentials in `SLACK_CLIENT_ID`/`SLACK_CLIENT_SECRET`), channel routing, and a bridge worker that projects conversation events (`created`, messages, status, assign/claim, handover) into one Slack thread per conversation. Handover requests additionally alert a configurable escalations channel with an optional mention.
  - The bridge registers an `EventSink` on `WebhookDispatcher` (contract introduced in the integration foundations release) — deliveries are enqueued transactionally with the emitted event; the webhooks queue and the Slack bridge are peer consumers.
  - New tables (`slack_integrations`, `slack_channel_routes`, `slack_conversation_links`, `slack_message_links`, `slack_user_links`, `slack_deliveries`) with RLS; a Slack channel can only mirror one org (`(team_id, slack_channel_id)` unique), so one workspace can serve multiple orgs.
  - Admin MCP tools `slack_get_install_url`, `slack_get_status`, `slack_set_routing`, `slack_test`, `slack_disconnect` (scopes `slack:read`/`slack:write`), the `skill://slack/connect-slack` setup skill with the app manifest, `/v1/slack` control endpoints, and a Slack card under AI settings → Integrations.

  Reply-from-Slack and interactive claim/close buttons are follow-up phases; message links already dedupe both directions to keep the loop-prevention invariant.

### Patch Changes

- Updated dependencies [491186c]
  - @getmunin/types@4.68.0

## 4.67.2

### Patch Changes

- @getmunin/types@4.67.2

## 4.67.1

### Patch Changes

- @getmunin/types@4.67.1

## 4.67.0

### Patch Changes

- @getmunin/types@4.67.0

## 4.66.1

### Patch Changes

- @getmunin/types@4.66.1

## 4.66.0

### Patch Changes

- @getmunin/types@4.66.0

## 4.65.0

### Patch Changes

- @getmunin/types@4.65.0

## 4.64.0

### Patch Changes

- @getmunin/types@4.64.0

## 4.63.1

### Patch Changes

- @getmunin/types@4.63.1

## 4.63.0

### Minor Changes

- 834138e: outreach: stop re-drafting already-contacted prospects + add per-campaign automation switches

  - `outreach_propose_initial` now refuses a fresh first-touch when the contact already has a `sent` or `approved` initial proposal in that campaign (previously dedup only covered pending drafts, so the weekly curator could re-draft someone who was already emailed). `dismissed`/`failed` proposals still allow a re-draft.
  - New `outreach_campaigns` columns `auto_draft_initial` (default `false`) and `auto_draft_replies` (default `true`), exposed on `outreach_create_campaign` / `outreach_update_campaign` / `outreach_list_campaigns`. The weekly first-touch curator only drafts for campaigns with `autoDraftInitial = true`, and inbound prospect replies are auto-drafted only when `autoDraftReplies = true`. Existing campaigns keep auto-replies but must opt in to automated first-touch.

### Patch Changes

- @getmunin/types@4.63.0

## 4.62.1

### Patch Changes

- 81e91ae: Fix the `cms_asset_references` migration (0048) being silently skipped on
  existing databases. Its journal `when` timestamp was lower than the preceding
  migration's, and drizzle only applies migrations whose timestamp is newer than
  the latest one already recorded — so on any database already past 0047 the
  table was never created, and the follow-up RLS step failed with
  `relation "cms_asset_references" does not exist`. Fresh databases (CI) applied
  everything in order, which is why it passed review.

  The timestamp is corrected, the migration is made idempotent (so a database
  that already applied the broken version re-runs it as a no-op), and a new test
  asserts journal `when` timestamps strictly increase with idx to catch this
  class of bug before release.
  - @getmunin/types@4.62.1

## 4.62.0

### Minor Changes

- 4d7d83a: CMS: support inline images in entry bodies. Embed an `asset://<assetId>` reference inside a `markdown`/`rich_text` field and the delivery API, `cms_get_entry`, and `cms_search` resolve it to the asset's `publicUrl` plus an `_assets` sidecar map. Inline references are validated on write (an unknown or unconfirmed asset is rejected). Asset references — inline and typed fields alike — are now tracked, so `cms_delete_asset` refuses to delete an asset still in use, and a new `cms_list_asset_usage` tool reports which entries reference an asset.

### Patch Changes

- @getmunin/types@4.62.0

## 4.61.1

### Patch Changes

- @getmunin/types@4.61.1

## 4.61.0

### Minor Changes

- 86bf3d0: Add `analytics_get_funnel`: an admin MCP tool that computes ordered conversion funnels (per-step visitor counts, conversion and drop-off rates) from page-view events. Steps match by `subjectType`/`subjectId` and/or a `pathLike` pattern, are strictly ordered, and support an optional per-step time budget (`stepWindowHours`). Visitors are grouped by their identified end-user when known (else their anonymous `visitor_id`), so a journey crossing the anonymous → identified boundary isn't double-counted.

  `analytics_get_contact_journey` now resolves the `visitor_id → end_user` link at read time, so a contact's page-views and searches recorded _before_ they identified are included retroactively (no backfill).

  Adds an `analytics_view_events (org_id, visitor_id, created_at)` index to back visitor-grouped scans.

### Patch Changes

- @getmunin/types@4.61.0

## 4.60.0

### Patch Changes

- @getmunin/types@4.60.0

## 4.59.2

### Patch Changes

- e5f7d98: fix(db): backfill OAuth token reference_id under bypass_rls

  Migration `0045` backfilled `oauth_refresh_token.reference_id` (and access tokens) by joining `org_members`, but that table has `FORCE ROW LEVEL SECURITY`. Real deploys run migrations as the database **owner** (Scaleway RDB has no Postgres superuser), and `FORCE` RLS applies to the owner — so without `app.bypass_rls` set, the `org_members` join saw zero rows and the backfill silently updated nothing, leaving every existing OAuth agent unpinned and hidden from the flock. (It only appeared to work in tests, which run as a superuser that bypasses RLS.)

  `0046` re-runs the backfill inside a `DO` block that sets `app.bypass_rls` first, so it works under the owner role too.
  - @getmunin/types@4.59.2

## 4.59.1

### Patch Changes

- b8c162b: feat(oauth): pin OAuth/MCP agent connections to an organization

  OAuth agents used to float to the user's current default org, resolved live on every request — so the flock listed an agent under whichever org happened to be default, switching the default silently retargeted live agents, and revoke was user-global.

  Connections are now pinned to a specific org at consent time via BetterAuth's `consentReferenceId`, which persists the org as `reference_id` on the refresh token and as an `org_id` claim on the issued JWT access token (carried forward on refresh). The credential resolvers read that pinned org and require the user to still be a member of it — removing someone from an org now kills their agents there. Tokens issued before this change fall back to the default org and are backfilled by a migration.

  As a result the flock is truthful per-org (lists only agents pinned to the calling org) and revoke is org-scoped (only revokes grants pinned to the caller's org, leaving the same user's other-org agents alone). Which org an agent binds to is the user's active org at consent time, set with the existing topbar org switcher.
  - @getmunin/types@4.59.1

## 4.59.0

### Minor Changes

- 2e3b87a: feat(conv): per-channel default agent mode

  Add `defaultAgentMode` (`auto` | `draft_only` | `off`) to conversation channels. New conversations inherit the channel's mode when no explicit mode is passed — including inbound replies that fail threading and open a fresh conversation. Set an outreach-only inbox to `draft_only` so prospect replies are always drafted for human approval and never auto-sent, even when threading can't link the reply to its originating conversation. Configurable via `conv_setup_email_channel` and the email channel dialog.

### Patch Changes

- Updated dependencies [2e3b87a]
  - @getmunin/types@4.59.0

## 4.58.0

### Patch Changes

- Updated dependencies [3d91858]
  - @getmunin/types@4.58.0

## 4.57.1

### Patch Changes

- @getmunin/types@4.57.1

## 4.57.0

### Patch Changes

- @getmunin/types@4.57.0

## 4.56.1

### Patch Changes

- @getmunin/types@4.56.1

## 4.56.0

### Patch Changes

- @getmunin/types@4.56.0

## 4.55.0

### Patch Changes

- @getmunin/types@4.55.0

## 4.54.0

### Patch Changes

- @getmunin/types@4.54.0

## 4.53.0

### Minor Changes

- 95f2983: Prioritize interactive onboarding work over background curator jobs. Curator jobs now carry a `priority` (default `0`), and the claim path orders by `priority DESC, next_attempt_at ASC` so a user-initiated website import (`task://web/scrape-website`, priority `100`) is claimed ahead of a backlog of older scheduled `skill://` sweeps instead of waiting behind them. Priority is derived centrally via `priorityFor(uri)` and can be overridden per-enqueue; a partial index keeps the claim path index-served.
- 82fef68: Redesign the onboarding "Lift-off" summary's website-import section into three real states — importing, failed, and succeeded — driven by live crawl progress.

  The web crawler now emits incremental progress (`{ total, done, recentPaths }`) as it reads pages; the runner persists it to a new nullable `curator_jobs.progress` column (throttled, best-effort), and the curator-job DTO surfaces it via `GET /v1/curator/jobs/:id`. The summary screen polls that to show a live `done / total` counter, a progress bar, and the paths being read while importing; the imported page count and duration on success; and the failure reason plus an inline **Retry import** on failure. A new internal `POST /v1/curator/jobs/:id/progress` endpoint backs the out-of-process runner path.

  Also align the full-screen loading screens with the page background: `AuthLoading` (and the root route loader) now paint `bg-bone` so the loader no longer flashes the lighter paper surface before the bone-backed page resolves.

### Patch Changes

- Updated dependencies [95f2983]
- Updated dependencies [82fef68]
  - @getmunin/types@4.53.0

## 4.52.1

### Patch Changes

- @getmunin/types@4.52.1

## 4.52.0

### Patch Changes

- @getmunin/types@4.52.0

## 4.51.4

### Patch Changes

- @getmunin/types@4.51.4

## 4.51.3

### Patch Changes

- Updated dependencies [139d00e]
  - @getmunin/types@4.51.3

## 4.51.2

### Patch Changes

- @getmunin/types@4.51.2

## 4.51.1

### Patch Changes

- @getmunin/types@4.51.1

## 4.51.0

### Patch Changes

- @getmunin/types@4.51.0

## 4.50.1

### Patch Changes

- @getmunin/types@4.50.1

## 4.50.0

### Patch Changes

- Updated dependencies [3f034de]
  - @getmunin/types@4.50.0

## 4.49.0

### Patch Changes

- @getmunin/types@4.49.0

## 4.48.0

### Patch Changes

- Updated dependencies [dc70c67]
  - @getmunin/types@4.48.0

## 4.47.0

### Patch Changes

- @getmunin/types@4.47.0

## 4.46.0

### Patch Changes

- @getmunin/types@4.46.0

## 4.45.1

### Patch Changes

- @getmunin/types@4.45.1

## 4.45.0

### Patch Changes

- @getmunin/types@4.45.0

## 4.44.1

### Patch Changes

- @getmunin/types@4.44.1

## 4.44.0

### Patch Changes

- @getmunin/types@4.44.0

## 4.43.2

### Patch Changes

- @getmunin/types@4.43.2

## 4.43.1

### Patch Changes

- @getmunin/types@4.43.1

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

### Patch Changes

- Updated dependencies [3858d3e]
  - @getmunin/types@4.43.0

## 4.42.0

### Patch Changes

- 205e1eb: Repair the drizzle migration snapshot chain so `drizzle-kit generate` works again. Snapshots `0003-0005` were byte-identical duplicates with the same `prevId`, which made drizzle-kit abort with a collision error; snapshots for `0006-0038` were never written because migrations after `#22` have been hand-authored. Result: nobody on the team has been able to run the generator, and any hand-written migration risks conflicting with what drizzle would have produced.

  Fix: delete the three duplicate snapshots and add a fresh `0038_snapshot.json` generated from the current `schema.ts`, with `prevId` chained to `0002`. drizzle-kit's snapshot validation only enforces parseability and no-duplicate-`prevId`, and the generator diffs against the lex-last snapshot — so this is sufficient to restore `db:generate`. `_journal.json` and all `.sql` files are untouched; `drizzle-orm`'s migrator never reads snapshots, so `db:migrate` behavior is unchanged for both fresh installs and existing databases.
  - @getmunin/types@4.42.0

## 4.41.1

### Patch Changes

- @getmunin/types@4.41.1

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

- @getmunin/types@4.41.0

## 4.40.4

### Patch Changes

- @getmunin/types@4.40.4

## 4.40.3

### Patch Changes

- @getmunin/types@4.40.3

## 4.40.2

### Patch Changes

- @getmunin/types@4.40.2

## 4.40.1

### Patch Changes

- 706d8c9: CodeQL cleanup: drop the `Math.random` session-id fallback in the chat widget (modern browsers always have `crypto.randomUUID`/`getRandomValues`), tighten the HTML-stripping regexes used by the web crawler and widget email fallback so nested/whitespaced `</script>` tags don't slip through, and rejection-sample in `makeId` to remove the modulo bias on the cryptographic random source.
  - @getmunin/types@4.40.1

## 4.40.0

### Minor Changes

- 547a97b: Drop the legacy `oauth_clients` (plural) table and its dormant FK column `tokens.oauth_client_id`.

  `oauth_clients` predates the BetterAuth OAuth provider plugin we adopted in migration 0017/0018. Since then the real OAuth client model has lived in `oauth_client` (singular) — that's the table the consent page reads from, the table DCR writes into, and the table FK'd by `oauth_access_token` / `oauth_refresh_token` / `oauth_consent`. The legacy `oauth_clients` was kept around because `tokens.oauth_client_id` had an FK pointing at it, but nothing has ever written either side: BetterAuth uses its own table, and `tokens.oauth_client_id` has only ever held NULL.

  Both `oauth_clients` and `tokens.oauth_client_id` were verified empty in dev and prod before the drop. The new migration `0037_drop_legacy_oauth_clients.sql` drops the FK, the column, the index, and the table; `src/sql/rls.sql` loses the matching RLS block; `schema.ts` loses the `oauthClients` export and the `oauthClientId` field on `tokens`.

  No application-level changes — nothing referenced the dropped column or table.

### Patch Changes

- @getmunin/types@4.40.0

## 4.39.0

### Patch Changes

- @getmunin/types@4.39.0

## 4.38.0

### Patch Changes

- @getmunin/types@4.38.0

## 4.37.0

### Patch Changes

- @getmunin/types@4.37.0

## 4.36.0

### Patch Changes

- @getmunin/types@4.36.0

## 4.35.0

### Minor Changes

- 73320e2: Add a drop-in tracker script for arbitrary web pages — same ergonomics as the chat widget. `analytics_create_tracker` mints a public `mn_track_*` API key, then a single `<script async src=".../v1/a/tracker.js" data-key="mn_track_…">` tag auto-fires page views, tracks dwell on `pagehide`, and exposes `window.mn.track(subjectId, attrs)` for SPA route changes. Events land in `analytics_view_events` with `source='tracker'`. Tracker keys are write-only and org-scoped — safe to embed in browsers.

  Also adds three admin read tools: `analytics_top_subjects` (most-viewed pages/entries), `analytics_subject_engagement` (views/dwell/depth for one subject), `analytics_zero_result_searches` (queries readers asked that returned nothing — the best "what to write next" signal). The `cms/review-stale-entries` skill now consults `analytics_subject_engagement` to judge refresh-vs-archive instead of relying on inbound references alone; a new `skill://analytics/track-website-traffic` walks operators through the full setup.

### Patch Changes

- @getmunin/types@4.35.0

## 4.34.0

### Minor Changes

- 290472e: Add an `analytics` module that records page-view and search events for any consumer surface. Two ingress paths: a 1×1 GIF pixel at `GET /v1/a/v/:token.gif` and a JSON beacon at `POST /v1/a/v`. Both anonymous, throttled, bot-UA filtered, and gated by an HMAC-signed view token bound to `(orgId, subjectType, subjectId)` so callers can't spoof arbitrary subjects. Events land in two new polymorphic tables (`analytics_view_events`, `analytics_search_events`) keyed by `subject_type` (`'cms_entry'` today, `'landing'`/`'dashboard_route'`/… later) — no per-consumer schema churn.

  CMS delivery wires in as the first consumer: every entry and list item from `/v1/cms/{orgId}/...` now ships with a `_tracking: { pixelUrl, beaconUrl }` block (suppressible via `?tracking=0`), and the public `/search` endpoint logs every query plus its `result_count` for "what to write next" analysis (zero-result queries are indexed for fast lookup).

  Also: the email open pixel and the new CMS tracking URLs both now build off `MUNIN_API_URL` via a new `readApiBaseUrl()` helper, fixing a latent bug where pixels were minted against the MCP host on split-host deployments (`api.*` vs `mcp.*` subdomains). The unused `readPublicBaseUrl()` shim is removed, and `MUNIN_API_URL` is documented in `.env.example` under the Backend section.

- 8d25fee: **`@getmunin/db` — configurable connection pool size.** `createDb` now accepts a `poolMax` option, and falls back to the `MUNIN_DB_POOL_MAX` env var when none is passed. Lets self-hosters and cloud operators size the per-process pool against their Postgres `max_connections` budget without forking the package. Invalid values (non-positive integers, non-numeric strings) throw at startup so configuration mistakes fail fast instead of silently degrading. Default behavior unchanged — when neither is set, postgres-js' default (10) still applies.

### Patch Changes

- @getmunin/types@4.34.0

## 4.33.0

### Patch Changes

- @getmunin/types@4.33.0

## 4.32.0

### Patch Changes

- Updated dependencies [03d62af]
  - @getmunin/types@4.32.0

## 4.31.0

### Patch Changes

- @getmunin/types@4.31.0

## 4.30.0

### Patch Changes

- @getmunin/types@4.30.0

## 4.29.2

### Patch Changes

- @getmunin/types@4.29.2

## 4.29.1

### Patch Changes

- @getmunin/types@4.29.1

## 4.29.0

### Minor Changes

- bc0d601: Introduces `org_alerts`, a first-class operational alerts surface (new `system_alerts_*` MCP tools, `GET /v1/system/alerts`, `org_alert.opened|resolved|acknowledged` realtime events). LLM-provider and channel-inbound failure paths now write to alerts instead of dedicated `last_error` columns on `agent_health` / `conv_inbound_state`, which are dropped. The dashboard banner reads from the alerts feed and renders per-source CTAs.

  Auto-deactivates an inbound poll channel after 5 consecutive failures: `conv_channels.active` flips to `false` (so the worker stops hammering broken credentials), the existing alert metadata records `deactivatedAt` + `attemptCount`, and the channels settings page renders an `ACTIVATE` button. `POST /v1/conversations/channels/:id/activate` re-enables the channel and resolves the alert.

  Also fixes an `imapflow` crash loop in the email adapter: a late TLS socket error after `tick()` returned was emitted with no listener attached, terminating the Node process. The adapter now attaches an `error` listener at construction and tears down the client on `connect()` failure.

### Patch Changes

- @getmunin/types@4.29.0

## 4.28.0

### Patch Changes

- @getmunin/types@4.28.0

## 4.27.1

### Patch Changes

- @getmunin/types@4.27.1

## 4.27.0

### Patch Changes

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
  - @getmunin/types@4.27.0

## 4.26.0

### Patch Changes

- @getmunin/types@4.26.0

## 4.25.0

### Patch Changes

- 7ddf932: **Security**: address four audit findings.
  - **High**: gate every sensitive control-plane endpoint on owner/admin role (webhooks, conversation channels, agent-config, org/assistant PATCH, etc.). Previously any signed-in member could rotate widget keys, change LLM provider credentials, or create event-exfiltrating webhooks.
  - **High**: agent provider URLs (`providerBaseUrl`) now route through `safeFetch` (blocks private/loopback/link-local hosts) and reject `http://` unless `MUNIN_SSRF_ALLOW_PRIVATE` is set. Closes the SSRF + credential-exfil path that let a misconfigured base URL leak the provider API key.
  - **High**: add RLS policy on `conv_widget_email_fallbacks` (the ledger had `org_id` but no policy). Plus a meta-test in `rls.test.ts` that fails when any `org_id`-bearing table is missing RLS.
  - **Medium**: expand role-coverage integration tests to cover the newly-gated endpoints (webhooks, conv channels, org/assistant PATCH).

  **Ergonomics**: introduce `@RequireRole(...)` / `@RequireActorType(...)` decorators + a single `RoleGuard` to replace inline `assertOwnerOrAdmin(...)` calls scattered across ~13 controllers. Conditional / body-dependent checks (`members:patch`) stay inline.
  - @getmunin/types@4.25.0

## 4.24.3

### Patch Changes

- @getmunin/types@4.24.3

## 4.24.2

### Patch Changes

- @getmunin/types@4.24.2

## 4.24.1

### Patch Changes

- f96c899: Make the embedding HNSW index creation in `kb.sql` and `cms.sql` opclass-aware.

  Postgres `CREATE INDEX IF NOT EXISTS` parses and validates the operator class against the column type _before_ the name-existence check fires, so once a deployment had switched the embedding column to `halfvec` (via `MUNIN_EMBEDDING_DIMENSIONS > 2000`), every subsequent `runMigrations` call errored with `operator class "vector_cosine_ops" does not accept data type halfvec` — even though the index already existed. That includes every `pnpm migrate` on container redeploy.

  Wrap each index creation in a `DO` block that inspects `information_schema.columns` for the actual `udt_name` (`vector` vs `halfvec`) and picks the matching opclass (`vector_cosine_ops` or `halfvec_cosine_ops`). The result is identical for the default OSS schema (`vector(1536)`) and unblocks deployments running at `halfvec(dim)`.
  - @getmunin/types@4.24.1

## 4.24.0

### Minor Changes

- ef55e18: Make the embedding vector dimension a deploy-time parameter.

  `OpenAIEmbeddingProvider` now accepts an optional `dimensions` field that is sent in the request body (honored by `text-embedding-3-*` and Scaleway's `qwen3-embedding-8b`) and enforced on the response — Matryoshka-truncated and L2-renormalized if the upstream returns a larger vector. The factory reads `OPENAI_EMBEDDING_DIMENSIONS` and cross-validates against `MUNIN_EMBEDDING_DIMENSIONS` so a mismatched deploy fails at boot rather than corrupting the index.

  `packages/db/src/schema.ts` reads `MUNIN_EMBEDDING_DIMENSIONS` (default 1536, range 32..4000). The embedding column is `vector(dim)` when `dim <= 2000` and `halfvec(dim)` above that, so deployments wanting near-native Qwen3 quality can pick `halfvec(4000)` and still index with HNSW. OSS defaults are unchanged — leaving the env var unset keeps the existing `vector(1536)` schema and 1536-dim provider.

  OSS migrations stay pinned to `vector(1536)`; bumping the dimension requires a fresh database or a deployment-specific ALTER. Self-hosters on the default see no behavior change.

### Patch Changes

- @getmunin/types@4.24.0

## 4.23.5

### Patch Changes

- @getmunin/types@4.23.5

## 4.23.4

### Patch Changes

- @getmunin/types@4.23.4

## 4.23.3

### Patch Changes

- @getmunin/types@4.23.3

## 4.23.2

### Patch Changes

- Updated dependencies [f0e5389]
  - @getmunin/types@4.23.2

## 4.23.1

### Patch Changes

- @getmunin/types@4.23.1

## 4.23.0

### Patch Changes

- @getmunin/types@4.23.0

## 4.22.0

### Patch Changes

- @getmunin/types@4.22.0

## 4.21.0

### Patch Changes

- @getmunin/types@4.21.0

## 4.20.0

### Minor Changes

- cedba8d: Adds an opt-in feedback module: OSS instances can collect feedback locally and, with an org admin's explicit approval, forward each item to `feedback.getmunin.com`. Gated by `MUNIN_FEEDBACK_ENABLED` (default `false`) — when disabled, no controllers, no MCP tools, no outbound code path is loaded.
  - `db`: new `feedback_outbox` table (org-scoped, RLS) for pending items and `system_config` for the deployment-wide `instance_id`. Drizzle migration `0032_feedback_outbox.sql`.
  - `backend-core`: `@Global() FeedbackModule` exposing `feedback_{create,list,get,approve,reject}` MCP tools and `POST /v1/feedback` + `/:id/{approve,reject}` REST routes. `InboxController` takes `@Optional() FeedbackService` so pending items appear inline in `GET /v1/inbox`'s queue when the module is loaded. Approval signs the outbound payload with `HMAC(instance_id, "munin-feedback-intake-v1")` so cloud can verify by re-deriving. Also renames `assistants.controller`'s `getOrCreate()` → `findOrCreateAssistant()` to match the dominant `findOrCreate*` convention.
  - `dashboard-pages`: extends `QueueItem` / `useQueueBuilder` / `QueueRow` / `QueueDrawer` with a `feedback` kind so pending items render in the unified inbox queue, with attribution copy disclosing data flow to Munin developers.
  - `ui`: new `feedback` tone variant on `Pill`.

### Patch Changes

- @getmunin/types@4.20.0

## 4.19.4

### Patch Changes

- @getmunin/types@4.19.4

## 4.19.3

### Patch Changes

- @getmunin/types@4.19.3

## 4.19.2

### Patch Changes

- @getmunin/types@4.19.2

## 4.19.1

### Patch Changes

- @getmunin/types@4.19.1

## 4.19.0

### Patch Changes

- @getmunin/types@4.19.0

## 4.18.0

### Patch Changes

- @getmunin/types@4.18.0

## 4.17.0

### Patch Changes

- @getmunin/types@4.17.0

## 4.16.0

### Patch Changes

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

- @getmunin/types@4.15.0

## 4.14.0

### Patch Changes

- @getmunin/types@4.14.0

## 4.13.0

### Patch Changes

- @getmunin/types@4.13.0

## 4.12.0

### Patch Changes

- @getmunin/types@4.12.0

## 4.11.0

### Patch Changes

- @getmunin/types@4.11.0

## 4.10.0

### Patch Changes

- @getmunin/types@4.10.0

## 4.9.0

### Patch Changes

- @getmunin/types@4.9.0

## 4.8.0

### Patch Changes

- @getmunin/types@4.8.0

## 4.7.1

### Patch Changes

- @getmunin/types@4.7.1

## 4.7.0

### Patch Changes

- @getmunin/types@4.7.0

## 4.6.1

### Patch Changes

- @getmunin/types@4.6.1

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

- @getmunin/types@4.6.0

## 4.5.1

### Patch Changes

- @getmunin/types@4.5.1

## 4.5.0

### Patch Changes

- @getmunin/types@4.5.0

## 4.4.1

### Patch Changes

- @getmunin/types@4.4.1

## 4.4.0

### Patch Changes

- @getmunin/types@4.4.0

## 4.3.0

### Patch Changes

- @getmunin/types@4.3.0

## 4.2.0

### Patch Changes

- @getmunin/types@4.2.0

## 4.1.1

### Patch Changes

- @getmunin/types@4.1.1

## 4.1.0

### Patch Changes

- @getmunin/types@4.1.0

## 4.0.0

### Patch Changes

- @getmunin/types@4.0.0

## 3.9.1

### Patch Changes

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
