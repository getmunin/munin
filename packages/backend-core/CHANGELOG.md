# @getmunin/backend-core

## 4.81.0

### Minor Changes

- 42abe67: Analytics: separate the stats per tracker.

  An org with several trackers (marketing site, docs, app) could mint one key per site but only ever read the sum: every query tool aggregated across the whole org, and `analytics_view_events.tracker_id` was written but never read. Search events didn't even record which tracker sent them, so `analytics_list_zero_result_searches` could never be split.

  Every analytics read tool now takes an optional `trackerId` — `analytics_list_top_subjects`, `analytics_list_top_countries`, `analytics_list_traffic_sources`, `analytics_list_referrer_hosts`, `analytics_get_views_over_time`, `analytics_get_subject_engagement`, `analytics_get_funnel`, `analytics_get_contact_journey` and `analytics_list_zero_result_searches`. Omitting it keeps the previous org-wide behaviour; an id that doesn't belong to the org is a `404` rather than an empty result, so a typo can't be misread as "no traffic".

  `analytics_search_events` gains a `tracker_id` column (migration `0068`), stamped by the `/v1/a/s` ingest endpoint from the tracker key. Pre-existing rows and searches Munin ran itself through the CMS delivery API stay NULL and are excluded from tracker-scoped queries. Views recorded through the token-signed CMS entry pixel/beacon carry no tracker either — filter those with `source` instead.

  Analytics export/import now round-trips the tracker foreign key on both event kinds, resolved through the transfer `idMap`, so moving an org between servers no longer flattens per-tracker attribution.

- 978d28e: `agentMode: 'draft_only'` now actually drafts on a support conversation

  Until now `draft_only` and `off` were the same code path outside outreach: the conversation
  runner bailed at `agentMode !== 'auto'`, so an email or SMS channel set to _Draft only ·
  needs approval_ produced no draft and no reply — the agent was simply silent. The only thing
  that ever drafted was an outreach-originated conversation, via
  `skill://outreach/draft-reply-email`. Both the dashboard channel dialog (`agentReplies.draftOnly`
  in `en`/`nb`) and the `conv_configure_email_channel` / SMS tool descriptions already promised
  human-approved drafts, so this closes a gap between the documented product and the runtime.

  The runner now resolves a _delivery_ per conversation instead of a boolean: `send` for `auto`,
  `draft` for `draft_only`. A draft run does the identical work — prompt assembly, MCP tool
  loop, knowledge-base and connector lookups, the audit pass — and then calls `setDraftReply`
  plus `requestHandover` instead of `postAgentMessage`. The dashboard inbox already renders the
  latest `draft_reply` message in an editable composer for a flagged conversation, so a teammate
  edits and sends with no UI change.

  Deliberate boundaries, each covered by a test:

  - **Outreach conversations are untouched.** They carry an `outreachCampaignId`, have their own
    proposal review queue with evidence and no-unsubscribe-footer rules, and are drafted by the
    outreach curator. Two drafts per inbound would be worse than none, so the runner skips them.
  - **No typing indicator and no greeting.** Nothing is being sent to the end user, so the widget
    must not claim someone is writing, and a proactive greeting nobody will read is not worth
    drafting.
  - **Audit actions that end a thread are withheld.** `set_topic` and `mark_spam` still apply;
    `close_conversation` and `snooze_conversation` do not, because they would hide a conversation
    whose answer has not been sent from the person who still has to send it.
  - **The retries-exhausted fallback flags a handover without its public message.** In `send` mode
    the customer gets "a teammate will follow up"; in `draft` mode nothing should reach them.
  - **No recovery sweep.** `listConversationsAwaitingAgentReply` stays `auto`-only. It keys off the
    last _non-internal_ message being from the end user, and a parked draft is internal — including
    `draft_only` there would redraft the same conversation every 30 seconds forever. A draft is
    produced from the inbound realtime event; if the runner is down when mail lands the
    conversation is just unanswered in the inbox, which is what a human-in-the-loop inbox is for.

  One follow-on worth knowing: because drafting flags the conversation for attention, a human
  sending the reply resolves that handover, which enqueues the existing `skill://kb/review-content`
  curation pass. A `draft_only` inbox therefore feeds the knowledge base from every human-sent
  answer. Candidates still require human approval before an agent can use them.

  `skill://conv/setup-email-channel` documents the three modes and these boundaries.

### Patch Changes

- c37dd17: fix(deps): clear the three open Dependabot advisories and unblock the security updater

  - **`js-yaml` 4.3.0 → 4.3.1** (GHSA / CVE-2026-59870, quadratic CPU consumption in `!!omap` resolution). The override key `js-yaml@>=4 <4.3.0` had already been climbed out of by the installed 4.3.0, so it was inert; it is now `>=4 <4.3.1` → `^4.3.1`. Reached only through dev tooling (`cosmiconfig`, and `read-yaml-file` under changesets).
  - **`fast-uri` 3.1.4 → 3.1.5** (host confusion via a backslash authority introducer). Transitive via `ajv`; the previous `^3.1.4` floor sat exactly at the vulnerable version.
  - **`hono` 4.12.32 → 4.13.1** (ReDoS in the CORS middleware via `Access-Control-Request-Headers`). Transitive and optional under `@modelcontextprotocol/node`, which we drive over the Express transport rather than the Hono one, so the CORS middleware is never mounted.

  This also fixes the failing Dependabot security-update job. `.github/dependabot.yml` ignored `js-yaml` with no version qualifier — every version, not just the pinned one — so the updater had nothing it was permitted to propose and aborted the whole run with `all_versions_ignored`, taking the other ecosystems' updates down with it. The rule's stated reason no longer held: it was added when changesets pinned js-yaml at v3 through `read-yaml-file@1`, and the existing `read-yaml-file@1` → `^2.1.0` override has since moved that consumer onto js-yaml 4. There is no v3 left in the tree, so the ignore is removed rather than narrowed.

- Updated dependencies [42abe67]
- Updated dependencies [978d28e]
  - @getmunin/db@4.81.0
  - @getmunin/agent-runtime@4.81.0
  - @getmunin/core@4.81.0
  - @getmunin/inspector-app@4.81.0
  - @getmunin/mcp-toolkit@4.81.0
  - @getmunin/types@4.81.0
  - @getmunin/emails@4.81.0

## 4.80.1

### Patch Changes

- 0250c9c: Replace the inline `safeParse` + `throw BadRequestException` boilerplate across the control-plane HTTP handlers with `nestjs-zod`'s `createZodDto` + a globally registered `ZodValidationPipe`. Each route's body is now declared at the parameter signature (`@Body() input: CreateApiKeyBody`) and validated before the handler runs, so handlers start at their business logic instead of six lines of unwrapping. The schema is still plain Zod — `createZodDto(z.object({...}))` only wraps it in a class the pipe recognises. Query and route-param validation is untouched.

  The pipe is created with a custom exception factory (`common/zod-validation.pipe.ts`) rather than the library default. Out of the box `nestjs-zod` answers a validation failure with `{ message: 'Validation failed', errors: [...zod issues] }`, which drops every field name from the message and puts the detail under a key the dashboard's API client does not read — so the previously informative 400 would have degraded to an unhelpful constant. The factory instead emits `{ message: 'validation_failed: host: …; port: …', fieldErrors: [{ field, message }] }`, matching the shape `packages/dashboard-pages/src/api.ts` already parses and the convention `connectors.service.ts` already uses, so form-level validation errors can bind per field.

  Three groups of handlers keep the manual `safeParse` on purpose, because they do not answer a malformed body with a 400 and the global pipe would force them to. The public analytics beacons (`analytics-tracker.controller.ts`, `analytics-views.controller.ts`) are `@HttpCode(204)` fire-and-forget browser endpoints that log and swallow an invalid payload — a 400 there would be noise the browser cannot act on, and would also reveal whether a tracker key parsed. The widget endpoints (`conv/widget/widget.controller.ts`) throw `ForbiddenException('invalid_widget_input: …')` deliberately, and they validate only _after_ the key checks, so routing them through the pipe would both change 403 to 400 and let an unauthenticated caller learn its body was malformed before `widget_auth_required` fires. Query and route-param validation is likewise untouched everywhere.

  This originally shipped as #303 but was lost before it reached `main`: it was stacked on another PR's branch and merged into that branch seconds after the parent had already squash-merged, so the commit was stranded on a deleted branch. Re-landed here against `main`, extended to the controllers added in the meantime.

- 0250c9c: Close two CodeQL high-severity findings on paths that take remote input.

  `InvitationsService.create` validated the invitee address with a hand-rolled `/^[^@\s]+@[^@\s]+\.[^@\s]+$/`. Because `.` is itself a member of `[^@\s]`, the group on either side of `\.` is ambiguous and the pattern can be driven into polynomial backtracking. It now runs the same `z.string().email()` the `POST /v1/orgs/me/invitations` DTO already applies, so the service agrees with its own controller instead of re-deriving a weaker rule.

  `contentHash` looped to `input.length` over freshly concatenated remote content with no ceiling. HTTP bodies are already capped by the default 100kb parser limit, but the scraper and import paths do not go through it, so the loop was bounded only by whatever a document happened to contain. It now rejects input above 5,000,000 characters — roughly fifty times the HTTP limit and far above any real document — rather than hashing an unbounded string on the event loop.

  Digests are unchanged: the guard is a pre-check and does not touch the mixing loop or the `\x01` title/body separator, and `chunker.test.ts` now pins three known digests (including one with surrogate pairs) so a future edit cannot silently change them. That matters because `content_hash` is persisted and compared to decide whether to re-embed — altering the function would invalidate every stored hash and force a full re-embed of the KB and CMS.

- c2a6218: Fix three Slack-mirror rendering bugs.

  An anonymous customer's mirrored message showed a nearly-blank avatar (a single dot baked into the fallback PNG); it now renders a Lucide `user-round` icon. A customer identified only by phone number showed the raw E.164 string as their Slack display name and the first digit as their avatar initial — `authorName()`/`contactPhone` now format through `libphonenumber-js` (matching the same fix already shipped on the dashboard), and `avatarKey()` only matches letters, so a name with no letters at all (any phone number) falls through to the same icon fallback as a fully anonymous contact. The now-unreachable digit-keyed avatar PNGs (`0`–`9`) are removed.

  System-generated notifications were inconsistently attributed: voice-call-started/ended and the internal handover note (real `conv_messages` rows with `authorType: 'system'`) posted under a distinct `System` username with a `:gear:` icon, while conversation-lifecycle notifications (resolved, assigned, taken over, handover requested/resolved — never stored as `conv_messages`, posted directly from the event handler) fell through to the Slack app's own default identity (`Munin` + the raven logo) because those call sites never set a username override. `speakerIdentity()` drops the separate `system` identity — both paths now post as plain `Munin`, matching what the lifecycle events already did — and `messageBodyText()` carries the `:gear:` signal into the message text instead (`:gear: *Voice call started · Thea*`), the same way `Conversation is resolved.` already leads with an emoji and bolds the key phrase. The raw `conv_messages.body` strings are untouched — Slack-specific mrkdwn only lives in the Slack presentation layer, not the channel-agnostic stored value.

  Teammates previously got a generic `:technologist:` emoji icon, indistinguishable from any other teammate. They now get the same letter-avatar scheme as customers — but rendered on a dark tile (an exact color swap of the customer tiles' paper/ink colors) so a teammate reply is visually distinguishable from a customer message at a glance, not just by the username text. `SlackAvatarsController` serves the new tiles from `-dark`-suffixed keys (`K-dark.png`, `default-dark.png`).

- 2ea6198: Expose the widget greeting's trailing-clause emphasis as the `--munin-greeting-emphasis` custom property, defaulting to the existing serif italic. Sites that want the clause upright can now set it to `normal` from their own stylesheet: custom properties inherit across the shadow boundary, so this is the one override route that does not depend on the panel's internal class names.
- Updated dependencies [9558bc2]
- Updated dependencies [0250c9c]
  - @getmunin/agent-runtime@4.80.1
  - @getmunin/core@4.80.1
  - @getmunin/mcp-toolkit@4.80.1
  - @getmunin/db@4.80.1
  - @getmunin/types@4.80.1
  - @getmunin/inspector-app@4.80.1
  - @getmunin/emails@4.80.1

## 4.80.0

### Minor Changes

- 556e620: Redesign Channels and Trackers as card grids matching the Integrations page, and give Trackers real 7-day view stats.

  Channels and Trackers rendered as full-width `<ul><li>` rows while Integrations already shipped a bordered-card grid (`IntegrationCard`/`CardMenu`/`StatusLine`/`CardGrid`), so the three settings pages didn't read as one family. `CardGrid`, `CardMenu`, and `StatusLine` move out of `components/integrations/integration-card.tsx` into a new shared `components/card-kit.tsx`, alongside a new `SettingsCard` shell: mono kind eyebrow (chat/email/SMS/voice — no logo tile, since nothing real would go in one) with the vendor logo + name demoted to footer metadata, serif name with a mono qualifier, an always-visible status line, a one-line description, and a 1.5px amber top rule for anything needing attention (awaiting credentials, never fired). A new `CardGridSkeleton` gives the loading state the same shape as the loaded grid; the Integrations page itself is visually untouched (only its internal imports move), and Channels/Trackers keep their existing `EmptyCallout`/`LoadFailed` empty and error states unchanged.

  Trackers' cards also show a 7-day view count and sparkline per tracker. `analytics_view_events` previously had no way to attribute a view to a specific tracker — the ingest controller resolved the tracker from its API key but discarded the id before calling `recordView` — so this needed a small backend addition: a nullable `trackerId` column (+ index) on `analytics_view_events`, threaded through from the two ingest call sites, a new `AnalyticsService.trackerViewSummaries()` aggregation, and a dashboard-only `GET /v1/analytics/trackers/views-summary` endpoint (kept off the `analytics_*` MCP tool surface deliberately). Phone-number qualifiers (SMS `fromNumber`/`originator`) now format through `libphonenumber-js` instead of showing the raw E.164 string.

### Patch Changes

- 12dce01: Advertise `offline_access` in the protected-resource metadata so Claude Code can authenticate.

  `/.well-known/oauth-protected-resource` listed only the Munin permission scopes. The MCP SDK
  uses that list verbatim as the `scope` of its dynamic client registration (SEP-835 scope
  selection), so the resulting OAuth client was stored without `offline_access`. Claude Code then
  requested `offline_access` at `/auth/oauth2/authorize` to obtain a refresh token, and Better
  Auth validates the requested scopes against the _client's_ registered scopes before falling back
  to the server-wide list — so the browser landed on `invalid_scope: The following scopes are
invalid: offline_access`. claude.ai was unaffected because it registers without a `scope`, which
  defaults the client to the full server-wide list.

  The two metadata documents now derive from one source: `STANDARD_OIDC_SCOPES`,
  `SUPPORTED_AUTH_SCOPES` and the new `RESOURCE_ADVERTISED_SCOPES` all live in
  `oauth.constants.ts`, and a test asserts the resource metadata never advertises a scope the
  authorization server would reject.

- Updated dependencies [556e620]
- Updated dependencies [05dd500]
  - @getmunin/db@4.80.0
  - @getmunin/agent-runtime@4.80.0
  - @getmunin/inspector-app@4.80.0
  - @getmunin/core@4.80.0
  - @getmunin/mcp-toolkit@4.80.0
  - @getmunin/types@4.80.0
  - @getmunin/emails@4.80.0

## 4.79.0

### Minor Changes

- 48ddaba: Gate the voice tool list a Threll or Vapi call gets by connector state and channel appropriateness.

  Every voice call — Threll phone calls, Threll web-widget voice, Vapi — built its tool list from the full `self_service` registry with no filtering. Two consequences: `commerce_*`/`bookings_*` tools were offered to the voice agent even when the org had never configured a commerce or bookings connector connection, and `conv_request_human` (an async "flag this conversation for a teammate to review later" tool) was offered on live calls where it can't actually pull a human into the call — `conv_request_callback`, which places a real outbound call, is the voice-appropriate escalation.

  `@McpTool` gains `excludeChannelKinds`, and `McpToolRegistry.list()` takes an optional `{ channelKind }` filter; `conv_request_human` now sets `excludeChannelKinds: ['voice']`. A new `VoiceSelfServiceToolsService` — shared by `ThrellToolBridge` and `VapiToolBridge`, so a future voice vendor picks up the same behavior for free — additionally drops connector-backed tools per-request when `ConnectorsService.listActiveDomains` reports no active connection for their domain. Both bridges' `dispatch()` route through the same service's `isCallable`, so a channel-excluded tool is rejected even when a client calls it by name outside the advertised list.

  `listActiveDomains` resolves every domain in one indexed read on the caller's executor. `WidgetVoiceService.startSession` builds its tool list inside an open transaction, so the check has to reuse that transaction: acquiring a second pool connection while the first is held deadlocks the pool once concurrent voice starts reach `MUNIN_DB_POOL_MAX` (default 10), since no outer transaction can commit until an inner connection it will never be granted frees up. The domain→tool-prefix map is keyed by `ConnectorDomain`, so adding a third connector domain is a compile error here until it is gated too.

- dfd3327: chat widget: `data-munin-fonts="inherit"` really adopts the page's typography, and the launcher bubble is themeable

  `data-munin-fonts` used to accept `"system"`, which did nothing to the type stack: `buildWidgetCss()`
  discarded its argument, so the only effect was skipping the `@font-face` injection and letting
  `'Munin Serif'` / `'Munin Mono'` fall through to `ui-serif` / `ui-monospace`. The widget still rendered
  serif headings and mono labels, and never picked up the host page's font — `all: initial` on the shadow
  host plus `font-family: var(--munin-sans)` on `:host` made that impossible.

  `"system"` is replaced by `"inherit"`, which does what the name says: no webfonts are downloaded and
  every string in the panel renders in the `font-family` the page applies to `<body>`. Sizes, weights and
  italics are unchanged. `"bundled"` remains the default and the designed look. An embed still passing
  `data-munin-fonts="system"` logs the usual console warning and falls back to `"bundled"`.

  The launcher bubble was hardcoded to the near-black ink of the panel header, with `data-munin-theme-color`
  only reaching the badge, links, send button and visitor bubbles. Two new attributes fix that:
  `data-munin-launcher-color` fills the bubble and `data-munin-launcher-icon-color` overrides the glyph.
  Given only a bubble color, the glyph picks whichever of ink/paper contrasts better — the same pick now
  also drives `--munin-theme-fg`, so a light `data-munin-theme-color` no longer paints near-white text on
  visitor bubbles.

  Three more gaps closed in the same pass:

  - **`data-munin-header-color`** themes the panel's top bar (org name + close button) the same way
    `data-munin-launcher-color` themes the bubble — auto-contrast text/icon, defaults to the same fixed
    chrome tone.
  - **`data-munin-color-scheme`** (`auto` default, `light`, `dark`) gives the panel a real dark mode.
    `auto` follows `prefers-color-scheme` live; `light`/`dark` pin it regardless of the visitor's OS
    setting. Only the panel body (welcome/chat/composer/cards/bubbles) inverts — the launcher, header bar
    and voice-call screen keep their fixed near-black chrome in every mode (introduced `--munin-chrome`/
    `--munin-chrome-fg`, decoupled from the `--munin-ink`/`--munin-paper` pair that now flips per scheme)
    so brand-color and dark-mode customization don't fight each other.
  - **`window.mn.widget`** exposes `open()`/`close()`/`toggle()`/`isOpen()` once the script has run, so a
    site's own "Chat with us" link (or a proactive prompt) can drive the panel instead of requiring a click
    on the launcher bubble. It's one global, so with two embeds on a page it stays bound to whichever
    mounted first and the second warns instead of silently stealing an already-wired control surface.

  Two latent bugs found while reviewing the above, both verified in a browser rather than from the source:

  - `color-scheme` was declared on `:host`, where the shadow host's inline `style="all: initial"` outranks
    it — so it computed to `normal` and every UA-rendered surface inside the panel (scrollbar track/thumb
    where scrollbars aren't overlay-style, autofill styling) stayed in light mode even with the panel fully
    dark. It now sits on `.root`, which the inline reset can't reach. The pre-existing `color-scheme: light`
    was inert for the same reason.
  - `HEX_COLOR` accepted `{3,8}` hex digits, including the 5- and 7-digit lengths CSS rejects. A typo'd
    `data-munin-header-color="#12345"` passed validation without a warning, reached CSS as an invalid token,
    and resolved to a _transparent_ header — near-white auto-contrast text on the near-white panel, so the
    org name and close button both became invisible. Now `{3,4}|{6}|{8}` only, so a bad value warns and
    falls back like every other malformed attribute.

  The panel's edge also moved to a `--munin-edge` token that inverts to a light hairline in dark mode; the
  only edge treatment was an `inset … rgba(15, 20, 25, 0.08)` hairline plus dark drop shadows, which made
  the panel dissolve entirely into a host page whose background was near `#1B1D22`. Light mode is
  byte-identical.

  Two more hardcoded colors became tokens, on opposite sides of the chrome/body split:

  - The two voice `[data-state='error']` dots used `#B91C1C` on the always-dark chrome — 2.8:1 against
    `#0F1419`, too weak for a 7px status dot. They now use a `--munin-chrome-danger` that is deliberately
    _not_ scheme-flipped (`#F87171`, ~6.6:1) because the surface under them never flips. Body-scoped
    `--munin-danger` still inverts per scheme for `.counter.over`.
  - `.pcard-shot` hardcoded `background: #fff`, a blinding tile in a dark panel. It's now `--munin-shot`:
    `#FFFFFF` in light, `#E8E4DC` in dark. It stays a _light_ tile in both because `object-fit: contain`
    letterboxes product photography that overwhelmingly assumes white — a dark tile would make
    transparent-PNG product art disappear and leave white-background JPEGs sitting in a bright rectangle.
    The `.pcard-shot-empty` placeholder is unaffected and still follows the scheme.

### Patch Changes

- a699168: Tell MCP agents the real API host, not the MCP host. The connect-time server instructions and the `{{API_URL}}` substitution in skill bodies both derived the "API base URL" from `NEXT_PUBLIC_MCP_URL`'s origin, so any deployment that splits the API and MCP onto separate subdomains handed agents the wrong host. Coding agents following `skill://playbooks/frontend-integration` then baked it into customer frontends as `NEXT_PUBLIC_API_URL` / `VITE_API_URL`. It worked only because both hostnames happen to route to the same backend today; anything that splits them (a separate service, per-host WAF or rate-limit rules, a route narrowed to `/mcp`) would break shipped customer pages, and the same page already mixed hosts — the dashboard embed snippet and the CMS delivery API's own `_tracking` block resolve the API host via `MUNIN_API_URL`.

  Both call sites now use `readApiBaseUrl()`, the resolver every other self-referencing URL already goes through, and the instructions state the API base URL and the MCP endpoint URL as two separate facts instead of claiming one origin serves both. `readApiBaseUrl()` gained a fallback to `NEXT_PUBLIC_MCP_URL`'s origin ahead of `http://localhost:3001`, so single-host and tunnel setups that never set `MUNIN_API_URL` keep resolving to a reachable host.

  Two related fixes: the Slack bridge built avatar image URLs (`/v1/slack/avatars/*.png`, fetched by Slack) off the MCP origin, and the in-process agent runner never passed an API base URL at all, so its skills reached the model with a literal, unsubstituted `{{API_URL}}`.

  Skills and playbooks stopped naming deployments. Hosts and hosting tiers are per-deployment facts an agent cannot verify from inside a tenant, so they no longer appear in skill bodies: `skill://playbooks/frontend-integration` describes allowlist behavior by the env var that controls it rather than by tier, `skill://slack/connect-slack` keys its prerequisite step off `slack_get_status.appConfigured` and gets the manifest URLs substituted from `{{API_URL}}` instead of asking the agent to hand-replace a placeholder, `skill://playbooks/data-migration` is retitled "Data migration (server ⇄ server)" (slug unchanged), and the analytics and outreach skills use `example.com` in sample arguments.

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

- Updated dependencies [a699168]
- Updated dependencies [ef55960]
- Updated dependencies [48ddaba]
- Updated dependencies [068fb46]
  - @getmunin/core@4.79.0
  - @getmunin/db@4.79.0
  - @getmunin/mcp-toolkit@4.79.0
  - @getmunin/agent-runtime@4.79.0
  - @getmunin/inspector-app@4.79.0
  - @getmunin/types@4.79.0
  - @getmunin/emails@4.79.0

## 4.78.0

### Minor Changes

- 1974c11: CMS: migrated content keeps its original publication date

  `publishedAt` was stamped `new Date()` on every path that publishes an entry, and nothing could override it. It was not accepted by `cms_create_entry` or `cms_publish_entry`, `cms_schedule_publish` refuses past dates, and `cms_export` did not carry the column at all — so `cms_import` re-created every published entry through `createEntry` and dated the whole set to the moment of the import. Moving a blog between two Munin servers silently collapsed its archive into a single day, and importing one from another CMS had no way to keep the real dates. The workaround was to duplicate the date into a `publishedAt` field on the collection and sort the frontend on `data.publishedAt` instead of the built-in column.

  - `cms_create_entry` accepts an optional `publishedAt` (ISO 8601) alongside `status: "published"`. Passing it on a draft is a `cms_invalid` error rather than a silently ignored argument; an unparseable value is rejected the same way.
  - `cms_publish_entry` accepts the same optional `publishedAt`, so an entry imported as a draft can be published with its historical date. Omitting it still stamps now.
  - `cms_export` emits `publishedAt` per entry and `cms_import` (and `POST /v1/cms/transfer/import`) restores it when creating a published entry, so a server-to-server transfer round-trips the date. Importing an export produced by an older server leaves the field absent and falls back to the previous behavior.

  The delivery API already orders by `publishedAt` descending, so a frontend archive sorts on the built-in column with no duplicate field in `data`. `skill://cms/migrate-content`, `skill://cms/publish-entry`, `skill://cms/design-collection` and `skill://playbooks/data-migration` document this; the blog archetype in `design-collection` no longer suggests a redundant `publishedAt` field.

  The same import loop flattened the other two statuses. `cms_import` mapped every non-published entry to `draft`, so archived entries came back as live drafts in the editing queue and the `scheduledAt` that `cms_export` emitted was never read by anything:

  - Archived entries import as `archived`.
  - An entry still scheduled for a future time imports as `scheduled` with its `scheduledAt`, and the target's schedule worker publishes it.
  - An entry whose `scheduledAt` has already passed imports as a `draft` with a warning naming the entry and the stale time. A months-old export must not publish unreviewed content on the target the minute it lands, so the schedule is dropped deliberately rather than honored late — re-schedule with `cms_schedule_publish` or publish directly.

  Entries that already exist on the target are unchanged here: import still patches their content and leaves the target's own `status`, `publishedAt` and `scheduledAt` alone.

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

- f3db6e6: fix(conv): the channel listing stops handing out credential material

  `toChannelDto` surfaced `conv_channels.config` as stored, so both consumers of the channel list — `GET /v1/conversations/channels` (the dashboard) and `conv_list_channels` (MCP, admin audience) — returned every secret the jsonb holds: the pgcrypto ciphertext of the Twilio auth token, the MessageBird access + signing keys, the Vapi and Threll API keys and webhook secrets, the nested SMTP/IMAP passwords, and — in plaintext, since the widget never encrypted it — the chat widget's `identityVerificationSecret`.

  Only the ciphertexts need `MUNIN_ENCRYPTION_KEY` to be worth anything, and that key is not in the payload; the widget secret needs nothing. What made all of it worth removing is that nothing on either side reads these fields, while an agent's copy of a tool result travels: into a transcript, a log line, or an LLM provider's request body. Credential-derived material crossing that boundary widens the blast radius of any unrelated leak, and it does so for no gain.

  A single projection, `publicChannelConfig` (`conv/channels/public-config.ts`), now walks the stored config recursively before it is surfaced. An `encrypted<Field>` key becomes `<field>: '••••'` when a secret is stored and `<field>: ''` when it is not, which is the shape the per-vendor DTOs and the dashboard already expect — so the list and the configure responses finally agree, and "credentials present" stays readable without the ciphertext. The widget's `identityVerificationSecret` collapses to `hasIdentityVerificationSecret`, matching that module's own sanitizer. Being a rule about key shape rather than a per-vendor list, it covers a vendor added later.

  `needsCredentials` was email-only and therefore wrong for all five vendor-backed kinds — a Twilio channel parked on an unopened credential link reported `false`. It now reads the `pendingSetup` marker too, so the flag is truthful for every channel.

  That truthful flag needed somewhere to lead. The dashboard's only credential form was the email SMTP/IMAP one, so a pending Twilio or Vapi channel could be created by an agent and then only be finished by opening the one-time credential link — an odd detour for someone already signed in to the dashboard, and the reason a vendor channel's "Awaiting credentials" state had nowhere to go. Channels now renders the same generic form the connectors page already uses: the secret fields come from `GET /v1/conversations/channels/vendors` (`configFields` where `secret: true`), and saving posts to the existing `POST /v1/conversations/channels/:id/credentials`, which completes the vendor-side setup and activates the channel. No new endpoint, and the credential link keeps working for handing the job to someone who is not in the dashboard.

  A pending channel row now reads like a pending connector card — the same `StatusLine` dot, an outline "Enter credentials" as the only action, and no Edit button or test/place-call entry in the ⋯ menu, since every one of those is rejected while the channel is awaiting credentials.

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

- 5b4fb1a: Bind merge application to the proposal that was reviewed.

  `crm_apply_merge_proposal` took only `{ id }`, and `crm_propose_merge` does not always create a proposal: on a pair that already has a pending one it updates that row in place, overwriting `confidence`, `evidence`, `recommendedKeeperId` and `recommendedPatch` under the same id. Merge proposals also have none of the review tracking outreach has — no `revisionCount`, no `revisedAfterReviewAt` — so the rewrite was completely silent. A curator pass that re-filed a pair with the keeper flipped would change the card an operator was reading, and their click would retire the contact they meant to keep.

  Applying is not a small write: it copies the patch onto the keeper, repoints activities, deals and relationships, archives the duplicate with `doNotContact: true` and a cleared `endUserId`, auto-dismisses pending outreach proposals for the duplicate, and auto-dismisses other pending merge proposals touching it. Unwinding all of that by hand is not realistic, and the dismissed outreach followups do not come back.

  Proposals now carry a `mergeFingerprint` over `(contactAId, contactBId, recommendedKeeperId, confidence, recommendedPatch)` and apply requires it — `{ id, fingerprint }` on the MCP tool, `{ fingerprint }` in the body of `POST /v1/crm/merge-proposals/:id/apply`. A mismatch is a `409` with `crm_conflict`: nothing is merged and the proposal stays pending. The Slack apply button carries the digest in its action value; the panel and the dashboard pass what they rendered, and the panel re-lists on a refusal so the operator lands on the current proposal with the conflict still shown.

  The digest deliberately covers the proposal row and not the contact rows behind it. `crm_update_contact` can change the name or email a card displays, but it cannot change which record survives or what patch lands, and digesting live contact fields would invalidate queued cards on ordinary CRM activity — conflicts on untampered work teach operators to click through them.

  `evidence` is also excluded, so the weekly hygiene pass can refresh its reasoning on a pending pair without invalidating a queue the operator is working through. Only a changed decision invalidates a review.

- 992f78a: Make a dismissed KB curation candidate stay dismissed.

  Candidates are `kb_documents` rows that are deleted on dismiss and on publish, and the only thing stopping a curation pass from refiling a source conversation was a candidate still sitting in `kb-curation-inbox`. Empty the inbox — review a batch, publish two, dismiss the rest — and the next weekly sweep redrafts the same conversations from scratch. That happened in production: candidates reviewed on 26 July came back on 2 August, six weeks after the conversations themselves.

  `kb_curation_decisions` records one row per decision (`dismissed` or `published`) with the reason, the deciding actor, and the published document when there is one. Rows outlive the candidate and the source conversation. `kb_propose_curation_candidate` now pre-checks the source conversation and throws `kb_curation_decided` when one exists, so the gate is enforced in the service rather than described in the skill — the "last 7 days" and "resolved handovers only" rules were prose-only, and the sweep that produced those drafts honored neither.

  Blocking is coarse and permanent, matching `crm_merge_proposals`: one decision retires the whole conversation, and there is no un-dismiss. Title matching would lose to rewording — the June and August drafts of the same answer had different titles. Something genuinely new from a decided conversation goes in with `kb_create_document`.

  New tools: `kb_dismiss_curation_candidate` (deletes the draft, records the decision, takes an optional `reason` and the reviewed `ifVersion`) and `kb_list_curation_decisions` (filter by `outcome` or `sourceConversationId`). Dismissing with `kb_delete_document` still records a reasonless decision, so the Slack button, the dashboard drawer and the Inspector panel are all covered by the same choke point in `removeDocument`.

  `POST /v1/kb/curation/candidates/:id/dismiss` accepts `reason` and `ifVersion`; `KbCurationDecidedError` maps to a 409 there. The dashboard drawer and the panel now say the dismissal is permanent.

- f5b2992: Bind KB curation publishing to the version that was reviewed.

  A curation candidate is an ordinary KB document, `kb_update_document` rewrites its title and body, and `publishCurationCandidate` copies `candidate.title` and `candidate.body` verbatim into the target space. So an agent could rewrite the draft after the review card rendered and the operator's click would publish text nobody read.

  `kb_publish_curation_candidate` now requires `ifVersion`, the same optimistic-concurrency argument `kb_update_document`, `kb_delete_document` and `kb_restore_version` already take, and `POST /v1/kb/curation/candidates/:id/publish` takes it in the body. A mismatch throws `KbConflictError`, nothing is written to the target space and the candidate stays in the inbox. The check runs before target-space resolution, so a refused publish no longer auto-creates a space as a side effect.

  `KbConflictError` now maps to a 409 in the candidates controller. It was unmapped, so a version conflict on that route surfaced as a bare 500.

  The Slack publish button carries the reviewed version in its action value, which the approval codec already had a slot for. Without it the Slack path would have read the current version and passed that back, making the check vacuously true on the one surface where the card can sit unread the longest.

  Also fixes the Inspector panel's Dismiss button, which called `kb_delete_document` without the required `ifVersion` and therefore failed schema validation on every click. Both panel actions now use the version of the body the operator actually opened, falling back to the list version. Publish re-lists on a refusal so the operator lands on the current draft with the conflict still shown.

- d78ff2a: Bind outreach approval to the draft that was reviewed, not to the proposal id.

  `outreach_approve_proposal` took only `{ id }`, so it meant "send proposal #a3f9", never "send the email I just read". `outreach_revise_proposal` is model-callable and mutates a pending draft in place, so an agent could rewrite the body after the panel, the dashboard drawer or the Slack card had rendered it — and the operator's click would send the rewrite. The revision count on the card was the only tell, and it was advisory: a human had to notice it on a card they had already decided about.

  Every proposal now carries a `draftFingerprint` (a digest of campaign, contact, kind, subject, body and proposed send time) and approval requires it — `{ id, fingerprint }` on the MCP tool, `{ fingerprint }` in the body of `POST /v1/outreach/proposals/:id/approve`. A mismatch is a `409` with `outreach_conflict`: nothing is sent and the proposal stays pending, so the drift goes back through review instead of through the wire. Approve already re-checked campaign state, contact suppression and superseding replies at click time; the draft text is now one of those conditions.

  All three review surfaces pass what they rendered. The Slack approve button carries the digest in its action value, and the bridge already re-renders the card on `outreach.proposal.updated`, so a revised draft rebinds its button and a card that missed the update refuses rather than sending stale text. The Inspector panel re-lists on a refused approval so the operator lands on the current draft with the conflict still shown.

  This deliberately stops short of single-use tokens. The proposal state machine already refuses anything non-pending, which covers replay; what was missing was binding the decision to the content, and a digest does that without an issuance store or a secret inside the iframe. `crm_apply_merge_proposal` and `kb_publish_curation_candidate` are still id-bound and want the same treatment.

- f9f4d11: fix(outreach): duplicate proposals and campaign names return a conflict, not a 500

  Four outreach write paths leaned on a `try/catch` around the insert (or nothing at
  all) to turn a unique violation into a `ConflictException`. That never worked over
  `/mcp`: the handler runs inside the request's tenant transaction, so the violation
  poisons it and the _commit_ fails after the handler returns — past the catch —
  surfacing as a bare `{"statusCode":500,"message":"Internal server error"}`.

  Each now pre-checks with a `SELECT` before the failing statement:

  - `outreach_propose_first_touch` — a second **pending** first-touch for the same
    (campaign, contact) was unguarded; the pre-check only looked for `sent` /
    `approved`.
  - `outreach_propose_reply` — a second pending reply for the same conversation had
    no pre-check at all.
  - `outreach_create_campaign` — duplicate campaign name within the org.
  - `outreach_update_campaign` — renaming a campaign onto an existing name had
    neither a pre-check nor a catch, so it was always a raw 500.

  The existing catches stay as backstops for genuine races. `outreach_propose_followup`
  already pre-checked and is unchanged. The pre-checks also mean these paths no longer
  depend on the unique index's _name_, which is what made the failure invisible until
  an index rename exposed it.

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

- cfa0241: Withhold the agent reply when the audit pass marks a conversation as spam, and stop the assistant redirecting senders off-channel.

  The audit pass runs after generation but before delivery, so a `mark_spam` verdict flipped the conversation to `spam` and then posted the generated reply anyway — a cold pitch got both a spam label and a polite answer. The verdict now gates delivery: on spam the reply is withheld and parked as a `draft_reply` instead, so a misclassified customer is one click from recovery rather than a silently dropped thread. `shouldRespond` already skips non-open conversations, so later turns stay silent too.

  Parking needs a way to author a draft without requesting a handover, so `conv.setDraftReply` and `POST /v1/conversations/:id/draft-reply` are new; the endpoint replaces any existing draft rather than stacking, and pre-checks the conversation so an unknown id is a 404 rather than a poisoned transaction.

  The seed system prompt scoped its no-redirect rule to handovers only, so it never bound on a reply that wasn't one. That rule is now unconditional, adds "never name a contact address the sender already wrote to" (inbound mail has by definition already reached the right inbox), and tells the assistant to decline pitches briefly without routing anyone anywhere. Existing orgs keep the prompt they already have in KB — the seed only applies to orgs that don't have the document yet.

- 144a49c: fix(agent-runtime): close three prompt-injection holes in how untrusted text reaches the model

  Three gaps in the runtime's untrusted-content handling, all reachable by text an outsider controls. A new `untrusted.ts` module in `@getmunin/agent-runtime` is now the single place that fences untrusted text: `fenceUntrusted(tag, body, attrs)` wraps content in a reserved tag and escapes any reserved framing tag inside it, so a fenced region can only be closed by the fence itself.

  **Tool results could break out of their own `<data>` wrapper.** `runAgent` wraps every tool result in `<tool_result tool="…"><data>…</data></tool_result>` and pairs it with a system note telling the model to treat everything inside `<data>` as information, never as instructions. The wrapper interpolated the tool body verbatim, so a KB document, CRM field, or inbound email containing the literal `</data></tool_result>` closed the region early and everything after it read as sitting _outside_ the untrusted frame — the whole defense was a string-delimiter contract with no escaping, the same shape of bug as unescaped SQL. Escaping is tolerant of casing, internal whitespace and attributes, and leaves `<database>`-style lookalikes alone. The `tool` attribute is sanitized too: the name comes from the model's tool call, so a crafted name could otherwise escape the attribute even when the call itself resolves to an unknown tool.

  **Scraped third-party HTML reached the customer-facing agent's system prompt.** `kb_import_website` crawls a site, summarises it into a `company-profile` KB document, and the conversation runtime concatenated that document verbatim into the system prompt of every end-user conversation. Neither stage was defended: the summariser called the provider directly (bypassing `runAgent`, so it never got the untrusted-data note) and pasted raw page markdown into a plain user turn, and the runtime pasted the result straight into its most-trusted channel. A crawl reaching any page with third-party content — a blog comment, a review widget, a forum, a stale subdomain — could therefore write instructions into the support agent's system prompt. Scraped pages are now fenced per page as `<source_page url="…" title="…">` with the summariser told explicitly that page content is data to describe and never instructions to follow, and the runtime wraps the profile in `<company_context>` behind a note marking it as reference material. The block is still omitted entirely when no profile exists.

  **Imported conversation history could plant a real system turn.** `historyToChatMessage` mapped a message with `authorType: 'system'` to a genuine `role: 'system'` message. Every system note Munin writes itself is `internal: true` and filtered out of runtime history, so the branch was unreachable in practice — except through `conv_import`, whose schema accepts `authorType: 'system'` with `internal: false`. Migration payloads are exactly where third-party text lives (a Zendesk or Intercom export is full of end-user prose), which made this a path from an untrusted export straight into the agent's most-trusted channel. Fixed at both ends: system-authored history is now rendered as an assistant-side `[System note]`, matching how staff messages are already handled, and `conv_import` stores `system` messages as internal staff-only notes regardless of the payload flag, reporting each coercion in `warnings`.

  **Connected MCP hosts were told none of this.** The untrusted-data note lives inside Munin's own runtime, so an admin agent driving `/mcp` from claude.ai or any other host received raw tool results — arbitrary customer and end-user prose — into a session holding `kb:write`, `crm:write` and the rest, with nothing marking it as third-party text. The server `instructions` every host surfaces at initialize now carry a data-provenance paragraph naming which modules return text Munin did not author, and a note that the `agent-runtime` and `website-import` KB spaces are live agent configuration rather than reference material, so edits there change how the org's support agent behaves in every future conversation.

  None of this changes normal operation — no code path produced a public `system` message, no legitimate tool result or company profile contains its own closing framing tags, and the profile's content and wording are unchanged.

- Updated dependencies [fdf6734]
- Updated dependencies [59634b2]
- Updated dependencies [5b4fb1a]
- Updated dependencies [992f78a]
- Updated dependencies [f5b2992]
- Updated dependencies [d78ff2a]
- Updated dependencies [5802b45]
- Updated dependencies [180727a]
- Updated dependencies [cfa0241]
- Updated dependencies [144a49c]
- Updated dependencies [6dd772d]
  - @getmunin/db@4.78.0
  - @getmunin/inspector-app@4.78.0
  - @getmunin/types@4.78.0
  - @getmunin/agent-runtime@4.78.0
  - @getmunin/core@4.78.0
  - @getmunin/mcp-toolkit@4.78.0
  - @getmunin/emails@4.78.0

## 4.77.0

### Minor Changes

- 2d14917: fix(outreach): keep `outreach_list_proposals` payloads bounded

  `outreach_list_proposals` returned every column of every matching row, curator `evidence` included. Evidence is an unbounded JSONB the curator fills with sources, compliance notes and reasoning — around 4,000 characters per proposal in practice, roughly three quarters of a row. Combined with a default limit of 100 and a default of all statuses, a queue of ~16 proposals already produced an 80,000-character result that clients refuse, and 100 rows would have been half a million characters. The failure is silent-ish and total: the MCP Apps panel renders the size error instead of the review UI, and the model gets no data either, so the review pass just stops.

  List rows now carry the draft, the nested `contact` / `campaign` / `delivery` summaries and a boolean `hasEvidence`, but not `evidence` itself. The default limit drops from 100 to 25 and the ceiling from 500 to 200.

  The new `outreach_get_proposal` reads one proposal by id with the full evidence attached, so nothing became unreachable — this exposes the `getProposal` service method the Slack bridge and `GET /v1/outreach/proposals/:id` already used. The Inspector panel's **Evidence** toggle now fetches on click rather than receiving evidence for every card up front.

  `GET /v1/outreach/proposals` and the inbox queue return the same trimmed rows. Nothing in the dashboard rendered `evidence` from a list response.

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

- d0d3d28: Rename `conv_send_voice_sms_channel_test` → `conv_send_sms_channel_test`

  The send path dispatches on `capabilities.sendTest`, which only Twilio and MessageBird set. Vapi and Threll both declare `sendTest: false`, so on a voice channel the tool has always answered `channel vendor 'vapi' does not support test sends` — the `voice_sms` qualifier 4.76.0 gave it promised a path that does not exist.

  Its sibling `conv_test_voice_sms_channel` keeps the qualifier: all four vendors implement the credential check. The pair reads asymmetrically now, which is the point — their reach differs.

  The description says SMS-only and points voice at `conv_test_voice_sms_channel` for credentials and the dashboard's **Make a test call** for end-to-end. `skill://conv/setup-voice-sms-channel` names the error a voice channel gets. There is still no MCP tool that places a call: `ChannelAdminService.call()` stays `/v1`-only, human-initiated.

### Patch Changes

- Updated dependencies [2d14917]
- Updated dependencies [cfa7b4f]
  - @getmunin/inspector-app@4.77.0
  - @getmunin/types@4.77.0
  - @getmunin/db@4.77.0
  - @getmunin/agent-runtime@4.77.0
  - @getmunin/core@4.77.0
  - @getmunin/mcp-toolkit@4.77.0
  - @getmunin/emails@4.77.0

## 4.76.0

### Minor Changes

- 1461e0e: Rename MCP tools so a tool's name says which surface it acts on, and add a test that keeps names and titles in agreement

  The channel tools were the worst offenders: `conv_test_channel` and `conv_send_channel_test` sounded universal but only resolve vendors in the voice/SMS adapter registry, so calling either on an email channel failed with `unknown channel vendor 'smtp'`. Meanwhile `conv_create_channel` sounded universal but only handles email and chat. The unqualified names were the narrow ones, and three verbs (`create` / `setup` / `configure`) meant the same action across three channel families. Renames:

  - `conv_setup_email_channel` → `conv_configure_email_channel`
  - `conv_send_email_test` → `conv_send_email_channel_test`
  - `conv_widget_create_channel` → `conv_create_widget_channel`
  - `conv_widget_update_channel` → `conv_update_widget_channel`
  - `conv_widget_rotate_key` → `conv_rotate_widget_key`
  - `conv_widget_rotate_identity_secret` → `conv_rotate_widget_identity_secret`
  - `conv_configure_channel` → `conv_configure_voice_sms_channel`
  - `conv_test_channel` → `conv_test_voice_sms_channel`
  - `conv_send_channel_test` → `conv_send_voice_sms_channel_test`
  - `conv_list_channel_vendors` → `conv_list_voice_sms_vendors`

  `conv_create_channel` now rejects `voice` and `sms` at the schema instead of asking the model not to pass them. Taking that path used to insert a row with `active: true`, no adapter binding and no credential link — a channel that looked configured and could not send. `conv_import` still accepts all four types, since importing historical conversations is not the same as provisioning transport.

  Elsewhere the same operation carried different verbs, and four singular/plural pairs were distinguished by one letter where the rest of the surface uses `get_X` / `list_Xs`:

  - `crm_find_contact` → `crm_lookup_contact` (matches the connector modules' `lookup` for keyed-by-email reads)
  - `bookings_lookup_bookings` → `bookings_list_guest_bookings`
  - `bookings_get_my_bookings` → `bookings_list_my_bookings`
  - `commerce_lookup_orders` → `commerce_list_customer_orders`
  - `commerce_get_my_orders` → `commerce_list_my_orders`
  - `crm_change_stage` → `crm_change_deal_stage`
  - `cms_search` → `cms_search_entries`
  - `slack_test` → `slack_send_test_message`
  - `kb_import_website_status` → `kb_get_website_import_status`
  - `outreach_propose_initial` → `outreach_propose_initial_message`
  - `analytics_get_traffic_by_source` → `analytics_list_traffic_sources`
  - `feedback_get` → `feedback_get_item`, `feedback_create` → `feedback_create_item`, `feedback_list` → `feedback_list_pending_items`, `feedback_search` → `feedback_search_roadmap`, `feedback_vote` → `feedback_vote_on_roadmap_item`

  The `feedback_*` prefix covered two unrelated corpora with nothing in the names to say so: `feedback_list` reads the local outbox awaiting admin action, while `feedback_search` queries the public Munin roadmap.

  Descriptions that no longer matched behaviour are corrected. `outreach_propose_initial_message` and `outreach_approve_proposal` still described email-only sends after SMS and voice campaigns shipped; approving now documents an email, an SMS, or an outbound call, and `outreach_propose_followup` states that sequences are email-only. `conv_list_channels` claimed `voice` and `sms` were "reserved for upcoming adapters" — both have shipped. `conv_request_channel_credentials` is generically named and generically implemented but claimed to be email-only, so an agent holding a pending Twilio channel would have skipped the one tool that mints its credential link.

  Titles now restate their tool's name rather than drifting from it — they are what a host shows in a permission prompt. Analytics titles were noun phrases ("Top referrer hosts") where the rest of the surface is imperative, and the bookings titles said "Book a table" for a vendor-agnostic bookings contract that also serves non-restaurant venues.

  `tool-naming.test.ts` boots the registry and asserts, across every registered tool, that names carry a known module prefix, that titles start with that module's display prefix, that a title's leading word matches the verb in its name, that a title mentions the object its name acts on, and that no two tools share a title. It caught three tools this pass that the manual review missed: `conv_widget_rotate_key` and `conv_widget_rotate_identity_secret` kept the family-before-verb shape, `conv_request_callback` was titled "Place a phone call…" against a name that promises a request, and `analytics_export_config` was titled "Export trackers + visitor identities" — accurate about the payload, silent about the `config` its name promises.

### Patch Changes

- Updated dependencies [1461e0e]
  - @getmunin/inspector-app@4.76.0
  - @getmunin/types@4.76.0
  - @getmunin/agent-runtime@4.76.0
  - @getmunin/core@4.76.0
  - @getmunin/db@4.76.0
  - @getmunin/mcp-toolkit@4.76.0
  - @getmunin/emails@4.76.0

## 4.75.0

### Minor Changes

- c5a05c5: Inbound SMS threads into the existing conversation, and STOP unsubscribes

  Webhook-mode channels used to open a brand-new conversation for every inbound message. Two texts from the same person were two unrelated conversations, and no reply could ever be attributed to what it was replying to. Inbound messages now land in that contact's most recent open conversation on the channel, reopening it if it was snoozed; a closed conversation still starts a fresh one. New conversations also inherit the channel's `defaultAgentMode`, which the generic ingest path was dropping while the email path honoured it.

  An inbound SMS whose entire body is an opt-out keyword — `STOP`, `STOPP`, `SLUTT`, `AVMELD`, `UNSUBSCRIBE`, `END`, `QUIT`, `CANCEL`, `STOPALL`, case-insensitive, trailing punctuation ignored — now suppresses the CRM contact holding that number: `doNotContact` set, `unsubscribedAt` stamped, and a `crm_activities` note recording why. The message is still ingested so the conversation reads truthfully, and suppressed contacts drop out of `crm_list_contacts_in_segment`, so they leave every outreach audience. A message that merely contains the word ("can you cancel my order?") is an ordinary message.

  Honouring STOP is a legal requirement for SMS in the US and expected practice in the EU, so this lands before SMS outreach rather than alongside it.

- cc87bb6: Outreach proposals say where they are going before you approve them

  A proposal DTO now carries `delivery`: the campaign channel's type and vendor, the destination the approval would actually reach (email address for email campaigns, phone number for voice and SMS), and whether Munin will append the campaign CTA link and unsubscribe footer at send time. `contact` gains `phone` alongside `email`.

  Both review surfaces use it. The MCP App panel and the dashboard drawer state the consequence in words — "Approving places a phone call to +1 415 555 9999", "Approving emails jane@acme.com. Munin appends the campaign CTA link, an unsubscribe footer" — and warn in red when the contact has no address or number on file, which is a send that would fail. A voice proposal's approve button reads "Approve & call" rather than "Approve & send", and its missing subject renders as "(spoken call — no subject)" instead of the bare "(no subject)" an email would show.

  This matters most for voice campaigns, where approving dials a real phone number and the panel previously showed nothing but a subject-less body and an Approve button. It is worth having for email too: a reviewer approving a first-touch could not see the recipient address unless the contact happened to have no name.

  The panel's `Proposal.kind` union was also missing `'followup'`, which every follow-up proposal has carried since sequences shipped.

- 3269f5c: Outreach calls work on any registered voice vendor, not only Vapi

  `loadOutreachChannel` accepted `voice:vapi` and nothing else, so a campaign could not run on a Threll channel even though Threll has shipped an adapter, admin service and dashboard support for as long as Vapi has. The restriction was an accident of the voice path being written against one vendor: `approveInitialVoice` called `VapiClientService` directly, read config with Vapi's parser, and hard-coded `vapiCallId` as the key linking a call back to its conversation.

  Voice outreach now goes through a small `OutreachVoiceCaller` seam — vendor name, the metadata key its conversations are keyed by, and one `placeOutreachCall` method — registered per vendor and resolved by `channel.vendor`. Adding a third vendor is a class implementing that interface and a line in the module; nothing in `OutreachService` needs to know it exists. A voice channel whose vendor has no registered caller is refused at campaign-create time, naming the vendors that do work, rather than failing at approval.

  Each vendor keeps the linkage its own webhook expects: Vapi carries the draft and the outreach ids in `assistantOverrides.metadata` and keys conversations on `vapiCallId`, Threll passes the draft as call `context` and keys on `threllCallId`. Both partial unique indexes already existed (0026 and 0040), so no migration was needed.

- b98f618: Outbound calls and text messages are approved only by a person in the dashboard

  A proposal whose campaign runs on a voice or SMS channel can now only be approved by a signed-in dashboard user. `outreach_approve_proposal` refuses every other caller — an MCP agent, an unrestricted admin API key on the control plane, a curator, the Slack approval button — and the proposal stays `pending`. Email approval is unchanged, including by agents and admin keys.

  The check lives in `OutreachService.approveProposal`, so it holds regardless of which surface the call arrives through. It is not an MCP tool-visibility hint: hosts that don't implement MCP Apps still list the tool, and calling it on a voice proposal fails there too.

  Slack declines these in-thread with a pointer to the dashboard rather than surfacing a service error. The Inspector panel drops the approve button for voice and SMS proposals — Dismiss stays, since dismissing sends nothing — and says where the call is actually placed.

  Quiet hours and blackout dates are now enforced when a call or text is approved. They were previously stored on the campaign and consulted only when listing due follow-ups, so nothing stopped a call at 3am. `cadenceRules` gains an optional `quietHoursTimezone` (IANA, validated) that quiet hours and blackout dates are read in; without it they are read in UTC, which is not what a Norwegian campaign means by "no calls before 08:00".

- 862b055: Remove the MCP tools that place outbound voice calls

  `conv_call_channel` and `conv_call_contact` no longer exist on the MCP surface, so no connected agent can place a phone call. Anthropic's MCP directory does not list connectors that let an assistant dial third parties on its own, and an in-client tool-approval click does not clear that bar.

  Nothing else changes. The `VoiceCallbackService` and `ChannelAdminService.call` service methods stay, the `/v1/conversations/channels/:id/call` endpoints stay, and the dashboard's per-channel test call keeps working — it is authenticated as a human dashboard session, not as an agent. `conv_request_callback` also stays: it is `self_service`-only, so it is reachable by an org's own end-user agents (the widget's "can you call me?" flow) and refused for admin callers by the audience gate in `dispatch.ts`.

  The dashboard action is renamed from "Place a call" to "Make a test call", matching "Send test email" and "Send test SMS" — verifying a newly configured voice channel is what it is for.

  Outbound calling as a product capability moves to `outreach`, where a voice campaign already drafts a proposal that a human approves before anything is dialed.

- eedcba5: SMS outreach campaigns

  An outreach campaign can now run on an SMS channel. `outreach_propose_initial` drafts a text against a contact's phone number, and a person approving it in the dashboard creates the outbound conversation and sends the message. As with voice, an agent cannot approve one.

  Drafts are capped at 480 characters — roughly three billable segments — and rejected above it, with the limit stated in the tool schema so a curator can write to it rather than discover it. Composition is SMS-shaped: the campaign CTA is appended as a bare URL and the opt-out line as `Reply STOP to opt out.`, instead of the markdown link footer an email gets. `skill://outreach/draft-initial-sms` covers the writing rules, including why an emoji triples the cost of a message.

  **Outbound SMS was never actually delivered.** `ConvService` enqueued a `conv_message_deliveries` row only for `channelType === 'email'`, so an agent or operator replying on an SMS conversation stored a message that silently never sent — the `OutboundDeliveryWorker` and both SMS adapters were fine, nothing was ever handed to them. The gate now covers email and SMS.

  Follow-up sequences stay email-only: an SMS campaign rejects `sequenceSteps`, and `outreach_propose_followup` still refuses a text conversation. One touch, then the reply flow, which works because inbound texts thread into the outreach conversation.

  `findOrCreateContactByPhone` was duplicated in the Vapi and Threll adapters and inlined a third time in the outreach voice path; it is now one shared helper taking the source as a parameter.

- c5a05c5: SMS channels can set how the agent handles inbound texts

  `defaultAgentMode` has always been a `conv_channels` column, but only the email path could write it — the vendor-backed path that creates every SMS channel had no way to set it, and neither did the dashboard. Every SMS number was stuck on `auto`, replying to inbound texts automatically.

  It is now settable on SMS channels through `conv_configure_channel`, the vendor tools, the `/v1` SMS endpoints, and a control in the Twilio and MessageBird dialogs alongside the one email already had. Set `draft_only` on a number you only run campaigns from and inbound replies are drafted for approval instead of auto-answered.

  Voice channels reject it with an explanation rather than accepting a value that would do nothing: an inbound call is run by the vendor's assistant, not by the Munin agent, so there is no reply for the mode to govern.

  Also corrects `conv_create_channel`'s description, which claimed "the `voice` and `sms` channel types are reserved and not yet wired to an adapter". Both SMS vendors and both voice vendors have shipped adapters; those channels are created with `conv_configure_channel`, which the description now says.

### Patch Changes

- 77820b0: Add a skill for drafting outbound calls

  `skill://outreach/draft-initial-call` covers the voice-campaign pass, which had no skill of its own — an agent had to infer from the email skill that `draftBody` on a voice campaign is what a text-to-speech agent says out loud, not a message that gets delivered.

  It says what only a spoken channel needs said: write speech rather than prose, no markdown or emoji (read aloud or mangled), no URLs or reference codes (nobody can click on a phone call), identify the caller in the first sentence, give the voice agent a goal and boundaries rather than a script, and tell it what to do when the person is busy or asks whether it is a human. It also sets a higher bar for who is worth calling at all — matching a segment filter is a reason to email, not to phone — and states that approval is dashboard-only, so filing the proposal is where the agent stops.

  Cross-links the three first-touch skills to each other and lists all of them in `review-proposals`, which named only the email ones.

- c5a05c5: SMS channel dialogs: agent-reply select on create, sender switching actually clears

  The "Agent replies" select is now on the SMS create dialog, not just edit — a new channel no longer silently starts on `auto` until someone goes back and changes it. Renamed from "Default agent mode" / "Inbound replies" to a shared "Agent replies" across email and SMS dialogs, since "agent mode" is the database column name, not something an operator configuring a phone number has a mental model for.

  Twilio's From-number and Messaging-Service-SID fields are now a single "Send from" choice instead of two always-visible inputs with an "either, both is also OK" caveat. Switching the choice on an existing channel now actually clears the field you switched away from — `updateChannel` previously merged with `?? prev`, so the old value survived a switch and both were sent on every message.

- Updated dependencies [cc87bb6]
- Updated dependencies [b98f618]
- Updated dependencies [c5a05c5]
- Updated dependencies [c5a05c5]
  - @getmunin/inspector-app@4.75.0
  - @getmunin/types@4.75.0
  - @getmunin/agent-runtime@4.75.0
  - @getmunin/core@4.75.0
  - @getmunin/db@4.75.0
  - @getmunin/mcp-toolkit@4.75.0
  - @getmunin/emails@4.75.0

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

- 0d6a0ce: Slack outreach approval replies now quote the full draft body inline instead of a 200-character preview — Slack's own _Show more_ collapsing handles long drafts, so reviewing no longer takes a second click. The _View full draft_ button and its read-only modal are gone: drafting passes produce 30–200-word bodies that fit comfortably in one Slack message, and the rare draft that overflows the block limit is cut with a `(truncated)` marker pointing at the dashboard, where it can be edited as well as read.
- Updated dependencies [cad7227]
- Updated dependencies [5128795]
- Updated dependencies [c7bf800]
  - @getmunin/db@4.74.0
  - @getmunin/types@4.74.0
  - @getmunin/core@4.74.0
  - @getmunin/inspector-app@4.74.0
  - @getmunin/agent-runtime@4.74.0
  - @getmunin/mcp-toolkit@4.74.0
  - @getmunin/emails@4.74.0

## 4.73.0

### Minor Changes

- 62776e2: CMS: `cms_get_entry` no longer renders an MCP Apps panel.

  An entry is a document — long prose, blocks, images, under a user-defined schema — which is the worst fit for a fixed card in a chat transcript. The panel rendered every field stacked at full height and dumped `blocks` fields as raw JSON into a `<pre>` with no height cap, so reading one article produced a screen-and-a-half of transcript.

  The decisive constraint is that the binding is per-tool, not per-call: hosts resolve `_meta.ui.resourceUri` from the tool definition, and neither the MCP Apps spec nor the ext-apps SDK defines a way to suppress rendering for a single call. So a panel that is mildly useful when reviewing one draft is unavoidably also rendered five times when an agent reads five entries for a research pass. There is no setting that makes it appear only when it helps.

  Nothing moves out of reach. `cms_publish_entry` / `cms_unpublish_entry` / `cms_schedule_publish` were never app-only — unlike the outreach and CRM proposal actions — and they carry `destructiveHint: true`, so the human confirmation lives in the host's destructive-tool prompt rather than in a panel button. The tool result is unchanged: the full entry JSON was always in `content`, which is what the model reads.

  The inspector app keeps its other six panel-bound tools (`cms_list_assets`, `kb_list_curation_candidates`, `crm_list_merge_proposals`, `outreach_list_proposals`, and the four analytics reads), all of which wrap bounded, actionable payloads. The entry view, its type guards, its `inspector.entry` translations, and its styles are deleted.

- 62776e2: CMS: entry lists return summaries, so a list call can no longer blow the host's result cap.

  `cms_list_entries` ran every row through the same projection as `cms_get_entry`, so listing a collection of articles returned every full body. On a real collection, `{ collection: "journal-blocks", limit: 100 }` produced 72,768 characters — over Claude Desktop's per-result cap, which spilled the payload to a file and left the calling agent with nothing usable. `cms_search` had the same shape: full `data` on up to 50 hits, redundant with the match excerpt it already returned.

  Both now summarize. Because collection schemas are user-defined, the projection is driven by value size rather than a per-collection config: short values (text, numbers, booleans, dates, selects, asset/reference ids) come back verbatim, long text is shortened to a ~200-character lead, and oversized collections are replaced by an item count. What was withheld is reported per field in `fieldSummary` — `{ "body": { "words": 1600, "truncated": true } }` — so a length signal survives without the bytes. A result-wide budget sheds lead length in stages and, as a last resort, drops rows, reported as `dropped` rather than silently truncated.

  Breaking changes to two tool result shapes:

  - `cms_list_entries` returns `{ entries, returned, dropped, truncated }` instead of a bare array, and each entry gains `title`, `titleFieldName`, `fieldSummary`, and `truncated`. It no longer expands asset fields or accepts `include` — summaries never expand. `cms_get_entry` (unchanged) and the public delivery API remain the full-fidelity reads.
  - `cms_search` hits carry summarized `data` plus `title`, `fieldSummary`, and `truncated`. `include: ["references"]` still works: expanded references keep their `{ id, slug, collection, locale }` identity and their nested `data` is summarized in turn. The public delivery API's search is untouched and still returns full entry data for frontends.

  New inputs on `cms_list_entries`: `ids` reads up to 50 specific entries in one widget-free call — the shape a research pass over several entries actually wants, instead of N `cms_get_entry` calls each rendering an MCP Apps panel — and `fields` returns named fields verbatim when the full value is the point.

  Also fixes a latent 500 found while testing this: `cms_create_entry` and `cms_update_entry` had no duplicate pre-check against `cms_entries_slug_uq`, so reusing a slug in a collection poisoned the request transaction and failed at commit, past any handler-level catch, surfacing as a bare `500`. Both now pre-check and raise `cms_slug_conflict`.

### Patch Changes

- 0ac33df: Commerce: a product search renders as a gallery instead of a wall of prose.

  `commerce_search_products` returns image, title, price range and a storefront link per product, and until now every one of those had to survive a round trip through the model's prose. This adds a rendered surface for that result on all three chat surfaces, over one payload contract.

  - **New `MessageComponent` contract** (`@getmunin/types`): a Zod-validated `product_list` payload with a `source` block naming the connection that produced it, capped at 8 items. Price formatting lives in a deliberately dependency-free `@getmunin/types/message-format` subpath so the browser bundles can import it without dragging zod along — `formatPriceRange` renders `priceMin`/`priceMax` through `Intl.NumberFormat` from the payload's own `currency`, collapsing an equal min/max to a single price and falling back to `<amount> <code>` when a vendor reports a currency `Intl` doesn't know.
  - **The payload is derived server-side from the typed tool result, never authored by the model.** `runAgent` already returns each turn's tool calls with their raw results, so the conversation handler maps the last successful `commerce_search_products` call of the turn into components and persists them on `conv_messages.metadata`. The model cannot invent a price, a stock claim or a spec line, because there is no field for one. A refined second search supersedes the first; an errored search falls back to an earlier successful one; a search with no matches attaches nothing.
  - **Insecure or malformed URLs are nulled rather than dropping the product**, so a vendor serving images over http yields a card with a placeholder instead of a missing product. The schema itself requires https, and non-JSON or unparseable results are ignored entirely.
  - **Widget exposure is a whitelist, not a spread.** `conv_messages.metadata` also carries runner state (session ids, provider message ids, claim holders), so the widget's message list reads only the `components` key and re-validates it against the schema on the way out. Components are only ever attached to, or rendered on, `agent`/`user` messages, and never on internal notes.
  - **Chat widget** renders the gallery natively: an edge-to-edge scroll-snap rail that bleeds into the panel's own padding so the next card is visibly cut, a placeholder for missing or blocked imagery, and the connection named in a provenance line. It costs **1 kB gzip**. Hosting the real MCP App panel here was measured and rejected: `AppBridge` alone is 33.5 kB gzip and the panel it renders is 324 kB gzip — roughly twice the entire widget — on a customer's own marketing page, and an anonymous visitor has no MCP session for the panel to call tools against.
  - **Agent inbox** renders the same payload with the same rules, below the bubble at full drawer width rather than inside the 85%-max bubble. Native rather than an `AppBridge` host because the inbox is a transcript: a conversation with five product searches would mean five 324 kB iframes, each fed a persisted snapshot into a panel built around a live `ontoolresult`.
  - **claude.ai and other MCP App hosts** get the gallery via a new `views/products.tsx` in the inspector panel, shape-routing on the `{ connection, products }` tool result the way the six existing views do, with `commerce_search_products` now declaring `_meta.ui.resourceUri`. The panel keeps its own shape guard rather than importing the schema, matching how every other view there works. An empty result falls through to the neutral view.
  - `cdn.shopify.com` joins the panel's CSP `resourceDomains` so Shopify imagery actually loads. Other vendors host product images on the merchant's own domain, which is per-connection and cannot be known when the resource is built — those cards show the placeholder. Making that allowlist org-aware is follow-up work.
  - The `skill://commerce/answer-product-questions` skill now tells the agent what the gallery already shows, so prose stops restating prices and links, stops promising a count it hasn't verified, and names missing specs (weights, materials) as absent from the product feed rather than inferring them.

  No migration: `conv_messages.metadata` is existing jsonb.

- 0ac33df: Commerce: stop telling customers a stocked product doesn't exist.

  `commerce_search_products` claimed "we don't have that" for products the store demonstrably sells. Three separate causes, all in the adapters.

  - **No relevance ordering at all.** The Shopify products query never set `sortKey`, so it defaulted to `ID` — creation order. With a `limit` of 10 against a store with many matches, the agent was shown ten arbitrary products and could never see the best one. Now `sortKey: RELEVANCE`.
  - **Every term was required.** Shopify implies `AND` between terms, so `borrelåsreim jenter` demanded both words and matched nothing, because no product title contains "jenter". Magento was stricter still: it wrapped the _whole_ query in a single `LIKE '%…%'`, so word order mattered — `borrelåsreim Xplora` could not match "Xplora 4 Borrelåsreim Blå". Magento now filters one group per term (all terms must appear, in any order), and both adapters retry a multi-term search as OR when the all-terms pass finds nothing. Precise queries keep their precision; the second vendor call only happens on a miss.
  - **OR results came back badly ordered, and re-ranking them starved.** Shopify's own `RELEVANCE` does not favour products matching more of the OR terms — for `borrelåsreim Xplora jenter` it ranked Samsung straps and screen protectors above the nine Xplora straps that matched two terms, placing them beyond position 25. So the broad pass now over-fetches a flat pool of 50 and re-ranks locally by how many query terms appear in the title, stable within equal coverage, before truncating to the caller's limit. The pool is deliberately not a multiple of `limit` — the depth needed is set by how badly the vendor orders OR results, not by how many results we intend to show, and a proportional pool left `limit: 3` and `limit: 5` still showing the wrong products first.

  Shopify's search-syntax `OR` binds tighter than `AND`, so the fallback query is explicitly parenthesised as `status:active AND (…)`. Terms stay double-quoted, which also keeps a literal `OR` typed by a customer as a search term rather than a connective.

  Not attempted: prefix wildcards (`term*`) would need a second, unquoted escaping path, since wildcards inside a quoted phrase are literal — that reintroduces search-syntax injection surface for a partial-word win. Typo tolerance is not available on either Admin API at all; on Shopify it would mean moving to the Storefront API's `predictiveSearch`, which needs a separate storefront access token on every existing connection and caps results at 10. Both deferred.

- Updated dependencies [62776e2]
- Updated dependencies [0ac33df]
  - @getmunin/inspector-app@4.73.0
  - @getmunin/types@4.73.0
  - @getmunin/agent-runtime@4.73.0
  - @getmunin/core@4.73.0
  - @getmunin/db@4.73.0
  - @getmunin/mcp-toolkit@4.73.0
  - @getmunin/emails@4.73.0

## 4.72.0

### Minor Changes

- f7113e4: Connector secrets can no longer transit the conversation

  `connectors_create_connection` and `connectors_update_connection` now reject secret
  config fields outright — the only way a secret enters Munin from an agent flow is the
  one-time credential link. Creating a connection returns the link directly; the
  `connect-external-system` skill is rewritten around that flow (its examples previously
  showed pasting `accessToken` into the tool call, which is why agents offered chat
  paste as an option).

  Two credential-link dead ends are fixed alongside:

  - A pending connection missing required non-secret config (e.g. Shopify without
    `shopDomain`) is now rejected at create time with the missing keys named, instead of
    minting a link whose save step can never validate.
  - The credential-entry page keeps the one-time token on a failed save (the server
    only consumes it on success), so it now offers a retry that resets the form instead
    of stranding the user on an error. Also drops the doubled top padding on the
    status states.
  - The Shopify adapter's default Admin API version moves from the sunset `2025-01`
    to `2026-04`.

- 58abfbc: Email channel passwords can no longer transit the conversation

  `conv_setup_email_channel` now rejects SMTP/IMAP passwords in its config — the same
  link-only contract the connectors got. A channel whose transport needs passwords is
  created `active: false` and the response carries the one-time credential link; saving
  the passwords through the link verifies them against the SMTP/IMAP servers (new
  `verify` step on the channel credential handler) and activates the channel. A
  `mailer`-outbound channel without IMAP needs no secrets and is active immediately.
  The `/v1` dashboard path is unchanged.

  The SMTP/IMAP probe moved from the email tools into a shared `EmailChannelProbe` so
  the credential handoff and `conv_test_email_channel` run the same checks, and the
  `setup-email-channel` skill is rewritten around the link flow.

- c81065d: Serve MCP protocol revision 2026-07-28 alongside 2025-11-25

  `/mcp` now speaks both protocol eras from the same endpoint. Modern clients get the
  stateless 2026-07-28 revision (no `initialize` handshake, no `Mcp-Session-Id`,
  `server/discover`, per-request `_meta` envelope, `Mcp-Method`/`Mcp-Name` header
  validation); existing 2025-era clients keep working unchanged.

  - Migrated from `@modelcontextprotocol/sdk` v1 to the v2 package split
    (`@modelcontextprotocol/{server,client,node}`). `createMcpServer` now returns a v2
    `Server`, and the HTTP entry is `createMcpHandler` + `toNodeHandler` instead of
    `StreamableHTTPServerTransport`. **Breaking for anyone embedding
    `@getmunin/mcp-toolkit` directly.**
  - `tools/list`, `resources/list` and `resources/read` advertise `ttlMs` /
    `cacheScope` on the 2026 revision, scoped `private` because listings are filtered
    per actor audience and scopes.
  - `tools/list` is now returned in a stable, name-sorted order so clients can cache it.
  - POSTs to `/mcp` whose `Content-Type` media type is not `application/json` are
    rejected with `415 Unsupported Media Type` (SDK v2 parses the header instead of
    substring-matching it). MCP SDK clients always send `application/json`; parameters
    like `charset=utf-8` continue to work.
  - The authorization server advertises
    `authorization_response_iss_parameter_supported` (RFC 9207 / SEP-2468), which
    BetterAuth already emits, and derives its BetterAuth `baseUrl` from
    `authorizationServerUrl()` so the advertised issuer and the emitted `iss` cannot
    drift apart.

- 45b8b7c: Voice/SMS channel secrets can no longer transit the conversation

  `conv_configure_channel` now rejects secret config fields (Vapi/Threll API keys,
  Twilio auth tokens, MessageBird access/signing keys) — completing the contract that
  connectors and email channels already follow. Creating a channel stores a pending row
  (`active: false`, non-secret config under `pendingSetup`) and returns the one-time
  credential link; saving the secrets runs the vendor's `completeSetup`, which performs
  the create-time vendor side effects at apply time — Vapi's assistant-webhook install
  and Threll's webhook-subscription creation (whose signing secret the vendor mints) —
  then verifies the credentials with the vendor's test call and activates the channel.

  Every admin action on a pending channel (test, call, send-test, options, updates)
  answers `conv_invalid: channel is awaiting credentials` instead of a raw 500 from the
  strict stored-config schemas. `conv_list_channel_options` drops its credentialed
  pre-create discovery mode — options are listed with a channel's stored credentials
  after the link completes; initial assistant/worker ids come from the vendor dashboard.
  The new `setup-voice-sms-channel` skill documents the flow, and the `/v1` dashboard
  paths are unchanged.

### Patch Changes

- 852ba5c: CMS: never keep an image variant that is heavier than its master.

  The variant ladder assumed recompressing to WebP q80 always beats the original. For an already-efficiently-compressed photographic JPEG at full width it does not — WebP loses that contest. On a real asset a 199,523-byte JPEG master produced a 214,250-byte "derivative", and because delivery resolves inline `asset://` to the widest variant, the delivery path served 7% _more_ bytes than the master it was supposed to improve on.

  - Any rendition whose encoded bytes are not smaller than the master is discarded rather than stored. `widestVariantUrl` then falls back to the next-widest rendition, or to the master when none qualify, so the invariant is now "a variant is only ever offered if it is genuinely lighter".
  - Renditions dropped by this rule are also deleted from storage, so re-deriving an asset that previously produced an oversized variant reclaims that object instead of orphaning it.
  - `VARIANT_LADDER_VERSION` goes to 2, so the CMS worker's reconciliation pass re-derives every existing asset under the new rule. No backfill or manual repair.

  The regression escaped its own test: the suite already asserted "every variant is lighter than the master", but built the fixture from `sharp({create})` with a flat solid colour, which compresses so trivially that the assertion could not fail. The fixture is now a noisy JPEG master, which reproduces the failure against the old code, and there is explicit coverage for dropping the oversized rendition and for reclaiming a superseded object.

- 1b52a3e: The end-user conversation agent can now reach commerce and bookings connectors: its delegated identity previously carried only conv/kb/crm scopes, so every `commerce_*` and `bookings_*` tool was stripped at the `/mcp` scope intersection and the widget agent deferred to a human even with a configured Shopify or Gastroplanner connection. The in-process runner resolves the connector scopes per conversation from the org's active connections, so orgs without a commerce or bookings connection never see those tools.

  Alongside the wider scopes, self-service connector lookups no longer trust self-reported emails: browser-supplied widget emails (first-ingest visitor payload and the save-conversation box) are stamped `emailSource: 'visitor'` on the end-user record, and `requireEndUserEmail` rejects anonymous identities and visitor-sourced emails with `connectors_unverified`. This closes an account-takeover vector where an anonymous chat visitor could claim someone else's email and read their orders or cancel their bookings. Emails asserted by trusted paths — inbound email, SMS/voice caller ID, operator-minted delegated tokens, the admin API — keep working.

- Updated dependencies [c81065d]
- Updated dependencies [1b52a3e]
  - @getmunin/mcp-toolkit@4.72.0
  - @getmunin/agent-runtime@4.72.0
  - @getmunin/inspector-app@4.72.0
  - @getmunin/core@4.72.0
  - @getmunin/db@4.72.0
  - @getmunin/types@4.72.0
  - @getmunin/emails@4.72.0

## 4.71.0

### Minor Changes

- 426a66e: CMS: keep the master, serve derivatives. Image assets now carry a ladder of WebP renditions and the delivery API hands out the light one.

  Until now an asset was delivered exactly as uploaded. The dashboard downscaled client-side before upload, but every other path — `cms_upload_asset_from_base64`, `cms_upload_asset_from_url`, presigned uploads, and generated images — stored whatever bytes arrived and served them verbatim. A 2.2MB PNG hero and a 99KB hand-uploaded JPEG could sit in the same library with no policy between them.

  - `cms_assets` gains `width`, `height`, `variants`, and `variants_version`. Variants are derived state: the original upload is always preserved as the master at `public_url`.
  - Uploads derive renditions at 320/640/1024/1536/2048px plus one full-size recompress (capped at 2560px), skipping any width at or above the source so nothing is ever upscaled. WebP at quality 80. For a 1536×1024 master the whole ladder costs ~10% of the master's bytes.
  - The delivery API rewrites inline `asset://` tokens to the widest variant instead of the master, and `AssetSummary` (typed asset fields and the `_assets` sidecar) now carries `width`, `height`, and the full variant list so consumers can build a `srcset`. Assets without variants keep resolving to the master, so nothing breaks while the library converges.
  - Generation is not a one-shot backfill. The existing CMS worker reconciles any asset below the current ladder version, which covers assets that predate this change, presigned uploads whose bytes arrived late, and generation that failed on the upload path. Changing the ladder later is a version bump rather than a new migration script, and generation on upload is therefore an optimisation rather than a correctness requirement.
  - Non-images and undecodable bytes are settled once so the worker stops reclaiming them. Batch size is tunable with `MUNIN_CMS_VARIANT_BATCH` (default 10 per tick).

- 0b864a4: Add live product-catalog lookups to the commerce connector domain: `commerce_search_products` and `commerce_get_product` (admin + self-service) return published products with price range, storefront link, description, and per-variant price and `availableForSale`. Shopify searches are pinned to `status:active` with operator-safe token quoting and need the `read_products` scope; Magento reads enabled+visible products via searchCriteria, expands configurable children, and reports stock from `stockItems` (null when the CatalogInventory ACL is missing). Ships with the `skill://commerce/answer-product-questions` skill and updated connect instructions.
- 5b49ac1: Slack outreach approvals now thread per campaign instead of posting one standalone message per draft: a parent message carries a live pending count (flipping to an all-handled banner at zero, with one parent per campaign per UTC day, so daily waves never land in a buried thread), each draft posts as a compact thread reply with a shorter body preview, and a new _View full draft_ button opens the complete subject and body in a Slack modal so reviewing no longer requires the dashboard.

### Patch Changes

- Updated dependencies [426a66e]
- Updated dependencies [5b49ac1]
  - @getmunin/core@4.71.0
  - @getmunin/db@4.71.0
  - @getmunin/types@4.71.0
  - @getmunin/agent-runtime@4.71.0
  - @getmunin/mcp-toolkit@4.71.0
  - @getmunin/inspector-app@4.71.0
  - @getmunin/emails@4.71.0

## 4.70.1

### Patch Changes

- ff032db: Mark the Slack webhook controllers (`/v1/slack/events`, `/v1/slack/interactivity`, `/v1/slack/oauth/*`, `/v1/slack/avatars`) as anonymous-callable via `PublicController`. Deployments that register `AuthGuard` as a global `APP_GUARD` were returning 401 "invalid or expired credential" to Slack before signature verification ever ran, which broke button interactions and inbound event delivery. Slack authenticates these routes with its signing secret (and the OAuth callback with signed state + a nonce cookie), not a Munin credential. The events/interactivity endpoint is now also rate-limited like other public webhook endpoints.
  - @getmunin/core@4.70.1
  - @getmunin/db@4.70.1
  - @getmunin/types@4.70.1
  - @getmunin/mcp-toolkit@4.70.1
  - @getmunin/inspector-app@4.70.1
  - @getmunin/agent-runtime@4.70.1
  - @getmunin/emails@4.70.1

## 4.70.0

### Minor Changes

- 5cb5ff3: CMS: lift the dashboard's 100KB image-upload ceiling and stop leaking agent-oriented error strings into the UI.

  The dashboard's cover-image upload previously went through the base64 path shared with the `cms_upload_asset_from_base64` MCP tool, inheriting its 100KB cap (which exists to keep agent tool payloads small) and surfacing its raw error message verbatim. Now:

  - New control-plane endpoints `POST /v1/cms/drafts/:id/assets/upload-request` and `POST /v1/cms/drafts/:id/assets/:assetId/complete` expose the existing presigned upload flow (up to 50MB), and the dashboard uses them. Note for S3-backed deployments: the bucket CORS policy must allow PUT/POST from the dashboard origin.
  - The dashboard downscales images client-side before upload (long edge capped at 2400px, re-encoded as WebP with JPEG/PNG fallback), so stored assets are delivery-ready instead of raw camera files.
  - `CmsInvalidError` carries a specific `code` (`cms_asset_too_large` for size-limit rejections), the CMS drafts controller includes `code` in error bodies, and the dashboard inbox/queue surfaces translate known codes through `useTranslateError` (new `errors.*` copy in English and Norwegian) instead of showing raw backend messages.

- 4601314: Extend the inspector MCP App with five new views: CRM merge-proposal review (side-by-side contact comparison with app-only apply/dismiss), KB curation-candidate review (new `kb_list_curation_candidates` tool, app-only `kb_publish_curation_candidate`), analytics charts (views over time, funnel, traffic by source, contact journey), CMS entry preview with publish/unpublish/schedule actions, and a media-library thumbnail gallery. The panel resource now CSP-allows the asset-storage origin so thumbnails render inside the iframe.
- e123820: Add `outreach_revise_proposal` and `outreach_withdraw_proposal`, the two agent-side corrections to a pending outreach draft.

  `outreach_revise_proposal` rewrites the draft in place on the same proposal id — the contact and campaign are fixed, since a different recipient is a different proposal. A `reason` is required and the revision is recorded (`revisionCount`, `lastRevisedAt`, `lastRevisionReason`, revising actor), so an edit can never be silent. Proposals now also record the first time a human opens them for review; when a revision lands after someone else has already read the draft, `revisedAfterReviewAt` is stamped and both the dashboard review drawer and the MCP Apps inspector panel warn the reviewer that Wednesday's text is not the text they read on Monday.

  `outreach_withdraw_proposal` lets a curator retract its own pending draft — a duplicate, a prospect who turned out not to qualify, a bounced address — under a new terminal `withdrawn` status. Withdrawal is deliberately neutral: it does not suppress the contact, does not touch consent, and does not stop a campaign sequence, so a withdrawn follow-up leaves that step eligible again where a dismissed one ends the sequence for good. Slack approval cards resolve as withdrawn, and `skill://outreach/review-proposals` documents when each of the four verbs applies.

### Patch Changes

- Updated dependencies [4601314]
- Updated dependencies [e123820]
  - @getmunin/inspector-app@4.70.0
  - @getmunin/types@4.70.0
  - @getmunin/db@4.70.0
  - @getmunin/core@4.70.0
  - @getmunin/mcp-toolkit@4.70.0
  - @getmunin/agent-runtime@4.70.0
  - @getmunin/emails@4.70.0

## 4.69.3

### Patch Changes

- 137fe87: Auth: actually link social sign-ins when the pre-existing local account's email is unverified. better-auth's account linking has a second gate — `requireLocalEmailVerified` (default `true`) — that rejects linking a trusted provider to an existing account whose email isn't verified. Since email/password sign-up runs with `requireEmailVerification: false`, those accounts are unverified, so Google/GitHub sign-in still failed with `account_not_linked`. Set `requireLocalEmailVerified: false` (the incoming provider's verified email is the proof of ownership). Also surface OAuth `?error=` codes on the login page instead of silently showing a clean form.
  - @getmunin/inspector-app@4.69.3
  - @getmunin/core@4.69.3
  - @getmunin/db@4.69.3
  - @getmunin/types@4.69.3
  - @getmunin/mcp-toolkit@4.69.3
  - @getmunin/agent-runtime@4.69.3
  - @getmunin/emails@4.69.3

## 4.69.2

### Patch Changes

- 5b82be8: Auth: link Google/GitHub sign-ins to an existing account with the same verified email instead of failing with `account_not_linked`. OAuth errors now redirect to the app's login/signup page (via `errorCallbackURL`) instead of the API origin root, which returned a 404.
  - @getmunin/inspector-app@4.69.2
  - @getmunin/core@4.69.2
  - @getmunin/db@4.69.2
  - @getmunin/types@4.69.2
  - @getmunin/mcp-toolkit@4.69.2
  - @getmunin/agent-runtime@4.69.2
  - @getmunin/emails@4.69.2

## 4.69.1

### Patch Changes

- 2d118b3: Build the Slack OAuth redirect URI from the auth origin (`NEXT_PUBLIC_AUTH_URL`) instead of the MCP resource origin, so browser-facing install flows land on the `api.*` host that Slack apps register as the callback. Falls back to the MCP origin when no auth URL is set, matching single-origin self-host deployments.
  - @getmunin/core@4.69.1
  - @getmunin/db@4.69.1
  - @getmunin/types@4.69.1
  - @getmunin/mcp-toolkit@4.69.1
  - @getmunin/inspector-app@4.69.1
  - @getmunin/agent-runtime@4.69.1
  - @getmunin/emails@4.69.1

## 4.69.0

### Minor Changes

- 7078b30: CMS draft preview links: drafts can now be viewed rendered by the customer frontend before publishing. `cms_get_preview_link` (and `POST /v1/cms/drafts/:id/preview-link`, plus a Preview action in the inbox drawer) mints a signed, entry-scoped token valid for 1 hour; the public delivery API's single-entry route accepts it as `?preview=<token>` and returns the entry regardless of status with `Cache-Control: no-store` and a `status` field. Reference expansion under preview includes draft-status referenced entries so the previewed page is truthful. Collections can carry a `settings.previewUrl` template (`{token}`, `{slug}`, `{locale}`, `{collection}` placeholders) pointing at the frontend's draft-mode endpoint; the full frontend contract is documented in the new `skill://cms/preview-entry`. List and search delivery routes never accept preview tokens.
- 18dc6a6: Slack approval notifications: pending CRM merge proposals, outreach drafts, and KB curation candidates now post to Slack with approve/dismiss buttons, and the message updates in place once the item is decided anywhere. New optional `approvals` channel route (`slack_set_routing` with `purpose: "approvals"`), falling back to escalations, then default. KB curation now emits `kb.curation_candidate.proposed/published/dismissed` events, and the CRM merge events `crm.merge_proposal.applied/dismissed` join the public event catalog. Adds the `slack_notification_links` table and a `subject_key` ordering column on `slack_deliveries` (migration 0055).
- 6f31549: Slack thread parents now headline the conversation subject once it is set. `conv_set_subject` emits a new `conversation.subject_changed` event, the Slack bridge mirrors it by refreshing the thread root in place (no thread reply), and the parent headline switches from "New conversation #N" to the subject.

  Resolved conversations are now unmistakable in Slack: the parent's status line becomes a ":white*check_mark: \_Conversation is resolved.*" banner (":no*entry_sign: \_Marked as spam.*" for spam), and status-change thread replies use human phrasing ("Conversation is resolved.", "Conversation reopened", "Conversation snoozed") instead of "Status changed to _closed_".

### Patch Changes

- 352ba3e: Bumped three more dependencies flagged by Dependabot: `next` to 16.2.12 (nine advisories fixed in 16.2.11 — SSRF in Server Actions on custom servers and in rewrites, App Router DoS via Server Actions, middleware bypass with Turbopack and a single locale, image-optimization DoS via SVG, response-body cache confusion, unbounded Edge Server Action payloads, and disclosure of internal Server Function endpoints), `postcss` to 8.5.23 (path traversal in previous-source-map auto-loading), and `brace-expansion` to 5.0.8 (DoS via unbounded expansion length). Declared ranges moved to the patched floor; `next` peer ranges stay at `^16.0.0` so consumers are not narrowed.
- dcf7022: Bumped four transitively-pulled dependencies flagged by Dependabot: `fast-uri` to 3.1.4 (host confusion via backslash authority delimiter and failed IDN canonicalization), `linkify-it` to 5.0.2 (quadratic-complexity DoS in the `mailto:` validator), `hono` to 4.12.32 (per-request JSX context isolation, `cx()` escaping bypass, header de-duplication), and `sharp` to 0.35.3 (libvips 8.18.3, covering CVE-2026-33327/33328/35590/35591). The `hono` and `fast-uri` overrides already allowed the patched versions and only needed re-resolution; `linkify-it` was pinned at the now-vulnerable floor. `sharp` moves ahead of the `^0.34.5` that `next` still declares as an optional dependency.
- 2f2ea9e: Fix merged contacts being re-proposed for merge on every dedup pass. `crm_propose_merge` now rejects a pair with `crm_conflict` when either contact carries `customFields.mergedInto` or the pair already has an `applied` proposal on record, so a merge the operator approved stays approved instead of reappearing in the review queue. `crm_apply_merge_proposal` also dismisses any other pending proposals that reference the archived duplicate (reason `contact merged into <keeperId>`), and contact lookup by email/phone (`crm_find_contact`, bulk-create and import dedup) now prefers the surviving row over an archived duplicate. `skill://crm/clean-contact-data` tells the curator to drop merged-away rows from the candidate buffer and to skim applied proposals alongside dismissed ones.
- 277080c: The Slack app manifest for self-hosters is now also checked in as `slack-app-manifest.json` at the repo root; the connect-slack skill points to it and a test keeps the two copies in sync.
- Updated dependencies [7078b30]
- Updated dependencies [18dc6a6]
- Updated dependencies [6f31549]
  - @getmunin/core@4.69.0
  - @getmunin/types@4.69.0
  - @getmunin/db@4.69.0
  - @getmunin/agent-runtime@4.69.0
  - @getmunin/mcp-toolkit@4.69.0
  - @getmunin/inspector-app@4.69.0
  - @getmunin/emails@4.69.0

## 4.68.0

### Minor Changes

- 8116ea6: Bookings module: connector-backed booking lookups with a Gastroplanner adapter. Admin tools (`bookings_lookup_bookings`, `bookings_lookup_booking`) take a guest email; self-service tools (`bookings_get_my_bookings`, `bookings_get_my_booking`) bind to the calling end-user's email server-side. Adds the `bookings:read` scope and `skill://bookings/check-booking-status`.
- c48d768: Bookings write support: the Gastroplanner adapter can now check availability and create, modify, and cancel bookings via the booking API. New admin tools `bookings_check_availability`, `bookings_create_booking`, `bookings_update_booking`, `bookings_cancel_booking` and self-service tools `bookings_create_my_booking`, `bookings_update_my_booking`, `bookings_cancel_my_booking` (self-service writes bind to the calling end-user's own email and enforce ownership before modifying or cancelling). Adds the `bookings:write` scope and renames the skill to `skill://bookings/manage-bookings`.
- ab212f4: Email channels can now use the credential-handoff flow: `conv_request_channel_credentials` (and `POST /v1/conversations/channels/:id/credential-link`) return a one-time dashboard link for entering a channel's SMTP/IMAP passwords, so secrets aren't pasted into an agent conversation. Create the channel with the password omitted, then share the link. Registers a `channel` handler on the shared credential-handoff registry.
- 129e6e7: Commerce module: connector-backed order lookups with Shopify and Magento 2 adapters. Admin tools (`commerce_lookup_orders`, `commerce_lookup_order`) take a customer email; self-service tools (`commerce_get_my_orders`, `commerce_get_my_order`) bind to the calling end-user's email server-side. Adds the `commerce:read` scope and `skill://commerce/check-order-status`.
- 1482bbe: Connectors trunk: encrypted `connector_connections` storage behind a vendor-adapter registry, `connectors_*` admin MCP tools (list vendors, CRUD, credential test), `connectors:read`/`connectors:write` scopes, and the shared scope/identity helpers domain modules (commerce, bookings) build their typed read surfaces on.
- 8da0e90: Connectors management UI and secure credential handoff. The Integrations settings page gains a Data connectors section to list, add, test, and remove connections. Secrets can be entered inline or handed off: creating a connection without its secret returns a one-time link (`/connect/credentials`) a human opens to enter credentials in the dashboard, so secrets never pass through an agent conversation. Backed by a generic `credential_requests` handoff primitive (reusable by other MCP-set-up integrations) and a `/v1/connectors` control-plane API.
- 2b3db51: Enforce campaign cadence rules in the outreach follow-up due-scan. `outreach_list_due_followups` now holds back contacts who already received `maxPerWeekPerContact` sent touches (initials + follow-ups) in the trailing 7 days, and returns nothing on a `blackoutDates` day. Quiet hours intentionally do not gate the scan — drafting is not sending, and a midnight sweep would otherwise starve quiet-hours campaigns.
- 491186c: Multi-step outreach sequences. Campaigns can define ordered `sequenceSteps` (wait period + drafting brief per step, email campaigns only); a daily curator sweep (`skill://outreach/draft-followup-email`, `MUNIN_CURATOR_OUTREACH_FOLLOWUP_CRON`) finds conversations whose next step is due via the new `outreach_list_due_followups` tool and files `kind: 'followup'` proposals with `outreach_propose_followup` into the existing human review queue. Any inbound reply permanently stops a sequence (the reply flow takes over), as does unsubscribe/suppression or dismissing a follow-up draft. Follow-ups thread into the initial's conversation with no subject or unsubscribe footer, and export/import round-trips sequences.
- cdff1ad: Slack integration phase 3: claim/close buttons, live parent state, source-channel routing

  The thread parent message becomes interactive: Claim and Close buttons (Reopen once resolved) plus a live status line (status, claimed-by, assigned-to, needs-attention) that updates via `chat.update` as conversation events flow through the mirror. A signed interactivity endpoint (`POST /v1/slack/interactivity`) maps button clicks onto the existing service paths — `ConversationClaimsService.claim` and `conv_change_status` — as the clicking teammate, with the same account-linking rule and ephemeral rejections as thread replies (including "already claimed by someone else").

  Routing gains source-channel overrides: `slack_set_routing` with `convChannelId` mirrors conversations from one Munin conversation channel into their own Slack channel (widget → #support-chat, email → #support-email) while everything else keeps the default. Migration `0051_slack_route_overrides` adds the column and reworks the route uniques. Also fixes a phase-1 gap where routing two purposes at the same Slack channel surfaced as a bare 500 instead of a conflict.

  The Slack app manifest gains the interactivity request URL (`/v1/slack/interactivity`).

- cdff1ad: Slack integration phase 4: manual user links, attachment handling, !assign

  - New admin tools `slack_list_user_links`, `slack_link_user`, `slack_unlink_user` for managing Slack-user ↔ Munin-member attribution when the profile-email auto-match does not apply. Linking again replaces the mapping; unlinked users fall back to rejection.
  - Attachment links on mirrored Munin messages render as :paperclip: lines in the thread (best-effort over the loosely-typed `conv_messages.attachments`). Inbound Slack files are refused loudly instead of dropped silently: a file-only reply is rejected with an ephemeral notice, and a reply with files goes out as text with a warning that the files were not forwarded.
  - `!assign me` / `!assign @teammate` in a mirrored thread assigns the conversation through `conv_assign_conversation` as the sender; unmapped mentionees get an ephemeral error. The assignment mirrors back into the thread and parent status line like any other event.

- 8037e74: Slack integration phase 1: mirror conversations into Slack threads (operator surface)

  - New `slack` module: per-org workspace connection via Slack OAuth (deployment-level app credentials in `SLACK_CLIENT_ID`/`SLACK_CLIENT_SECRET`), channel routing, and a bridge worker that projects conversation events (`created`, messages, status, assign/claim, handover) into one Slack thread per conversation. Handover requests additionally alert a configurable escalations channel with an optional mention.
  - The bridge registers an `EventSink` on `WebhookDispatcher` (contract introduced in the integration foundations release) — deliveries are enqueued transactionally with the emitted event; the webhooks queue and the Slack bridge are peer consumers.
  - New tables (`slack_integrations`, `slack_channel_routes`, `slack_conversation_links`, `slack_message_links`, `slack_user_links`, `slack_deliveries`) with RLS; a Slack channel can only mirror one org (`(team_id, slack_channel_id)` unique), so one workspace can serve multiple orgs.
  - Admin MCP tools `slack_get_install_url`, `slack_get_status`, `slack_set_routing`, `slack_test`, `slack_disconnect` (scopes `slack:read`/`slack:write`), the `skill://slack/connect-slack` setup skill with the app manifest, `/v1/slack` control endpoints, and a Slack card under AI settings → Integrations.

  Reply-from-Slack and interactive claim/close buttons are follow-up phases; message links already dedupe both directions to keep the loop-prevention invariant.

- cdff1ad: Slack integration phase 2: reply from the thread

  Operators reply to customers directly from a mirrored Slack thread. A signed Events API receiver (`POST /v1/slack/events`, v0 HMAC over the raw body, ±5 min replay window) resolves `(channel, thread_ts)` to the conversation and records the reply through `ConvService.sendMessage()` as the mapped org member — outbound delivery, claim, and attention semantics match the dashboard. A leading `!` keeps the reply as an internal note.

  Attribution is by Slack-profile-email ↔ org-member match, cached in `slack_user_links` and re-checked against current membership. Unmapped users are rejected with an ephemeral notice; nothing is recorded or sent. Loop prevention is atomic: the `slack_message_links` row commits in the same transaction as the message, so the mirror worker never re-posts a Slack-authored reply and redelivered events dedupe on the `(channel, ts)` unique index.

  The Slack app manifest gains the `channels:history` bot scope and a `message.channels` event subscription; `SLACK_SIGNING_SECRET` is now required for reply-from-Slack. Workspaces installed before this need a reinstall to grant the new scope.

- 3677620: Slack routing without channel IDs: the configure dialog lists the channels the bot has been invited to (new `GET /v1/slack/channels` + `slack_list_channels` tool), and inviting @Munin to an unrouted channel posts an interactive prompt where an org owner/admin can set default or escalations routing directly from Slack. Also fixes the Slack Web API client to form-encode requests (read methods rejected JSON bodies with invalid_arguments, surfacing as a 500 when saving a route) and sends the OAuth install back to the Integrations page instead of AI settings.

### Patch Changes

- 3870f04: Connectors: run the vendor credential probe outside the DB transaction. Credential handoff now persists secrets in a short transaction, then verifies them (the vendor round-trip) after commit via a new optional `CredentialTargetHandler.verify` hook, so the public `/v1/credentials` completion no longer holds a pooled Postgres connection open across a slow vendor call.
- cdff1ad: Harden the Slack OAuth install flow against install-URL hijacking

  Two defenses on `completeInstall`:

  - **Session binding for dashboard installs.** The `/v1/slack/install-url` endpoint now sets an httpOnly, `SameSite=Lax` `slack_install_nonce` cookie and embeds the nonce in the signed OAuth `state`; the callback requires the cookie to match. A leaked or intercepted dashboard install URL can no longer be completed by anyone but the initiating browser. MCP-minted install URLs (opened by a human in a fresh browser, no cookie continuity) remain nonce-free by design and rely on the short TTL plus the guard below.
  - **Workspace-repoint guard.** `completeInstall` refuses to overwrite an org's existing integration with a _different_ Slack workspace (returns `slack_workspace_mismatch`); switching workspaces requires an explicit `slack_disconnect` first. This blocks the high-impact case where a redeemed install URL would repoint an org's mirrored conversations (customer PII) to an attacker-controlled workspace.

- 8788bd4: Localize the smart/fast model-tier badges (nb: "rask") and surface connector config validation as inline field errors: invalid connector config now returns structured `fieldErrors` instead of a raw zod JSON blob, and the connect dialog highlights the offending inputs with localized per-field messages instead of toasting. The Tailwind preset now defines the `aria-invalid` variant (absent from Tailwind v3 defaults), so the destructive border/ring on invalid inputs actually renders.
- Updated dependencies [1482bbe]
- Updated dependencies [8da0e90]
- Updated dependencies [a66d454]
- Updated dependencies [491186c]
- Updated dependencies [cdff1ad]
- Updated dependencies [8037e74]
- Updated dependencies [3677620]
  - @getmunin/db@4.68.0
  - @getmunin/core@4.68.0
  - @getmunin/types@4.68.0
  - @getmunin/agent-runtime@4.68.0
  - @getmunin/inspector-app@4.68.0
  - @getmunin/mcp-toolkit@4.68.0
  - @getmunin/emails@4.68.0

## 4.67.2

### Patch Changes

- fbb276c: Fix chat-widget read-state loss on identity claim: when an anonymous session is claimed by a verified visitor (`identify`), the anonymous end-user's `conv_message_reads` rows are now migrated to the verified end-user before the anonymous end-user is deleted. Previously the read receipts were cascade-deleted with the anonymous end-user, so already-read agent replies resurfaced as unread (phantom unread badge) after logging in.
  - @getmunin/core@4.67.2
  - @getmunin/db@4.67.2
  - @getmunin/types@4.67.2
  - @getmunin/mcp-toolkit@4.67.2
  - @getmunin/inspector-app@4.67.2
  - @getmunin/agent-runtime@4.67.2
  - @getmunin/emails@4.67.2

## 4.67.1

### Patch Changes

- @getmunin/core@4.67.1
- @getmunin/db@4.67.1
- @getmunin/types@4.67.1
- @getmunin/mcp-toolkit@4.67.1
- @getmunin/inspector-app@4.67.1
- @getmunin/agent-runtime@4.67.1
- @getmunin/emails@4.67.1

## 4.67.0

### Minor Changes

- eead33b: Security hardening from a follow-up audit.

  - **Widget session credential moved out of the URL (BREAKING):** the widget read endpoints (`GET /v1/widget/messages`, `GET /v1/widget/conversations`, `GET /v1/widget/voice/available`) no longer accept the session credential in the query string. `sessionId`, `sessionIds`, `verifiedExternalId`, and `userHash` must now be sent as the `x-munin-session-id`, `x-munin-session-ids`, `x-munin-verified-external-id`, and `x-munin-user-hash` request headers. This keeps the session token — which grants read/write on a visitor's conversation — out of server, proxy, and CDN access logs. The bundled chat widget is updated; any custom integration that called these GET endpoints must move the fields from the query string to headers.
  - **Widget origin allowlist is required by default (BREAKING):** a widget channel with an empty `originAllowlist` now rejects all traffic, and creating one without an allowlist fails, unless `MUNIN_WIDGET_REQUIRE_ALLOWLIST` is explicitly set to `0`/`false`. Previously the allowlist was only enforced when the flag was opted in. Existing widget channels without an allowlist stop accepting requests until their origins are configured (or the flag is disabled). This inverts the default to fail-closed.
  - **OAuth `mcp:admin` scope is gated by org role (BREAKING):** OAuth access tokens (opaque and JWT) issued to users whose org membership role is not `owner` or `admin` no longer carry the `mcp:admin` scope or the admin MCP audience — they resolve to the self-service surface. Previously any member who consented to an `mcp:admin` scope grant reached every admin MCP tool. Admin API keys (`mn_admin_*`) are unaffected.
  - **Channel webhook endpoint hardened:** `POST /v1/conversations/channels/:channelId/webhook` is now rate-limited (per-IP, like the other public endpoints) and returns a uniform `401` for both unknown-channel and signature-verification failures to prevent channel-id enumeration. Note: an unknown channel now returns `401` instead of `404`.

### Patch Changes

- Updated dependencies [eead33b]
  - @getmunin/core@4.67.0
  - @getmunin/agent-runtime@4.67.0
  - @getmunin/mcp-toolkit@4.67.0
  - @getmunin/db@4.67.0
  - @getmunin/types@4.67.0
  - @getmunin/inspector-app@4.67.0
  - @getmunin/emails@4.67.0

## 4.66.1

### Patch Changes

- d266e86: fix(crm): dismiss pending outreach proposals when a contact is merged

  Applying a merge proposal archives the duplicate contact with `doNotContact: true` but previously left its pending outreach proposals bound to the now-suppressed tombstone. Approving one of those orphaned proposals then failed at the eligibility gate with `outreach_invalid: contact … is no longer eligible (suppression or consent withdrawn)`. The merge now dismisses the duplicate's pending proposals (with a `contact merged into <keeperId>` reason) and emits `outreach.proposal.dismissed` for each.

- 47d67aa: widget: add `data-munin-cookie-domain` so a conversation can be shared across sibling subdomains

  The session and visitor ids are kept in `localStorage` with a cookie fallback, and both were host-only — a chat started on `www.example.com` did not carry over to `app.example.com`. Setting `data-munin-cookie-domain=".example.com"` now writes the session + visitor cookies with that `Domain`, so both subdomains read the same ids and the anonymous thread is claimed when the visitor signs in on the app. The value must be a suffix of the page's host or it is ignored (a rejected `Domain` would silently break persistence). Default behavior is unchanged (host-only).
  - @getmunin/inspector-app@4.66.1
  - @getmunin/core@4.66.1
  - @getmunin/db@4.66.1
  - @getmunin/types@4.66.1
  - @getmunin/mcp-toolkit@4.66.1
  - @getmunin/agent-runtime@4.66.1
  - @getmunin/emails@4.66.1

## 4.66.0

### Minor Changes

- 44a9d34: Munin Inspector MCP App: new `@getmunin/inspector-app` package builds the `ui://munin/inspector` panel (React, single self-contained HTML, SDK bundled — no CDN) with an outreach proposal review view and the hello diagnostics view. New `outreach_approve_proposal` / `outreach_dismiss_proposal` admin tools expose the existing decision surface over MCP (declared panel-only via `_meta.ui.visibility: ["app"]` so MCP App hosts hide them from the model — sends require a human click); `outreach_list_proposals` and `inspector_hello` now declare `_meta.ui.resourceUri` so supporting hosts render the panel inline, with approve/dismiss round-tripping over the widget channel. Adds `skill://outreach/review-proposals`.
- abeb2ef: Serve `ui://` MCP App resources (SEP-1865): tools can declare `_meta.ui.resourceUri` pointing at an app-audience HTML resource rendered inline by supporting hosts, with resource-level `_meta` (CSP) passed through `resources/list` / `resources/read`. App resources are kept separate from the `skill://` catalog. Includes the `inspector_hello` spike tool + `ui://inspector/hello` panel, verified end-to-end against claude.ai including the widget-initiated `callServerTool` round trip.

### Patch Changes

- 37c95e9: Outreach proposal mutations (`outreach_approve_proposal`, `outreach_dismiss_proposal`, propose/update) now return the same joined `contact` and `campaign` summaries as `outreach_list_proposals`. Previously they returned `contact: null`, which made the inspector panel's row title fall back to the raw contact id after a decision.
- Updated dependencies [44a9d34]
- Updated dependencies [45f0e56]
- Updated dependencies [768642a]
- Updated dependencies [abeb2ef]
- Updated dependencies [b84577f]
  - @getmunin/inspector-app@4.66.0
  - @getmunin/mcp-toolkit@4.66.0
  - @getmunin/core@4.66.0
  - @getmunin/db@4.66.0
  - @getmunin/types@4.66.0
  - @getmunin/agent-runtime@4.66.0
  - @getmunin/emails@4.66.0

## 4.65.0

### Patch Changes

- 07f1d6e: analytics-tracker: expose a readiness signal. Once the tracker's public API is installed it sets `window.mn.ready = true` and dispatches a `munin:ready` CustomEvent on `document`, so consumers can run identify round trips (or any `window.mn.*` call) as soon as the async script is ready — no polling, no dependence on the loader's own readiness callback:

  ```js
  window.mn?.ready ? go() : document.addEventListener('munin:ready', go, { once: true });
  ```

  `skill://analytics/identify-visitors`, the frontend-integration playbook, and the dashboard embed snippet now show this pattern.
  - @getmunin/core@4.65.0
  - @getmunin/db@4.65.0
  - @getmunin/types@4.65.0
  - @getmunin/mcp-toolkit@4.65.0
  - @getmunin/agent-runtime@4.65.0
  - @getmunin/emails@4.65.0

## 4.64.0

### Minor Changes

- 1823364: Security hardening from a full audit.

  - **Voice tool bridges (Vapi, Threll):** enforce tenancy on every self-service tool call. The bridges previously disabled RLS without setting `app.org_id` and granted wildcard scope, allowing cross-tenant reads/writes; they now apply the standard tenancy GUCs and the restricted self-service scope set.
  - **OAuth JWT verification:** pin verification to the algorithm bound to the trusted JWKS key and reject symmetric algorithms, closing an algorithm-confusion gap.
  - **Analytics `identify` (BREAKING):** the identity hash now signs `${externalId}:${visitorId}` so a leaked hash can't link a different visitor. Compute `HMAC(secret, "<externalId>:<visitorId>")` where `visitorId` comes from the new `window.mn.getVisitorId()`. The server-rendered `data-external-id`/`data-user-hash` auto-identify is removed — do the read-visitor-id → sign → `window.mn.identify()` round trip instead.
  - **Webhook replay guidance:** documented that receivers should reject deliveries whose signed `createdAt` is outside a freshness window (in addition to the existing `x-munin-delivery-id` idempotency). No wire-format change — the signature scheme is unchanged.
  - **MCP scopes:** `webhooks_*`, `feedback_*`, and `system_alerts_*` tools now require real `webhooks:*` / `feedback:*` / `system_alerts:*` scopes instead of being gated by audience alone.
  - **Capability tokens:** view, unsubscribe, and email-open tokens now enforce a max age (and reject future-dated tokens), preventing indefinite replay of leaked links.
  - **Tool hints:** `conv_test_channel` and `conv_test_email_channel` are marked destructive (they open outbound vendor connections) so they prompt before running.
  - **Input validation:** a caller-supplied `endUserId` is validated against the caller's org in delegated-token minting and `crm_create_contact`.

### Patch Changes

- 3387922: Fix `crm_apply_merge_proposal` crashing with a bare 500 when the proposal's `recommendedPatch` carries a timestamp field (e.g. `consentGivenAt`) as an ISO string. Drizzle's timestamp encoder calls `value.toISOString()` during query build, which throws on a string. The patch is now normalized before the keeper update: values for timestamp columns are coerced from ISO strings (or epoch numbers) to `Date`, and keys that aren't real, patchable contact columns are dropped instead of being passed through to `.set()`.
- Updated dependencies [1823364]
  - @getmunin/core@4.64.0
  - @getmunin/agent-runtime@4.64.0
  - @getmunin/mcp-toolkit@4.64.0
  - @getmunin/db@4.64.0
  - @getmunin/types@4.64.0
  - @getmunin/emails@4.64.0

## 4.63.1

### Patch Changes

- 8c8b89c: conv: strip signatures that are a trailing contact block with no closing greeting

  Inbound emails whose signature is a bare contact block (e.g. an Outlook/Apple Mail HTML-table signature with no "Best regards" sign-off) could survive the cleanup pass when the real reply was short. Both the `strip-email-signature` curator skill and the `conv_strip_message_signature` tool refused to remove a block that was more than half the body, so a one-line reply followed by a large signature kept the signature.

  `conv_strip_message_signature` now allows a cut past the 50% guard when the caller supplies a `signatureText` that matches the removed trailing portion and carries two or more contact-info hints (email, phone, address, URL). The skill is updated to recognise greeting-less contact blocks and to always pass `signatureText` when the signature dominates the body.
  - @getmunin/core@4.63.1
  - @getmunin/db@4.63.1
  - @getmunin/types@4.63.1
  - @getmunin/mcp-toolkit@4.63.1
  - @getmunin/agent-runtime@4.63.1
  - @getmunin/emails@4.63.1

## 4.63.0

### Minor Changes

- cadc2c8: CMS: block types can carry an optional `description`. Each entry in a `blocks` field's `options.blockTypes` now accepts a `description` (≤500 chars) alongside `name` and `label`, so a collection can tell the agent what a block is for and when to use it while authoring (e.g. "Highlights a warning the reader must not miss; not for ordinary body text"). Optional and additive — existing collections and block content are unaffected.
- 5902396: Show who a conversation is with in the inbox drawer instead of a bare end-user id.

  `GET /v1/conversations/:id` (and the `ConversationDetail` it returns) now carries
  the resolved counterpart identity — `contactEmail`, `contactName`, `contactPhone`
  — preferring the linked `conv_contacts` row and falling back to the `end_users`
  row. Both the full and simplified conversation drawers render the email (then
  name) in the header rather than the raw end-user id.

  Also tightens the queue row layout so long titles truncate and the row actions
  swap in on hover without overlapping the timestamp.

- 834138e: outreach: stop re-drafting already-contacted prospects + add per-campaign automation switches

  - `outreach_propose_initial` now refuses a fresh first-touch when the contact already has a `sent` or `approved` initial proposal in that campaign (previously dedup only covered pending drafts, so the weekly curator could re-draft someone who was already emailed). `dismissed`/`failed` proposals still allow a re-draft.
  - New `outreach_campaigns` columns `auto_draft_initial` (default `false`) and `auto_draft_replies` (default `true`), exposed on `outreach_create_campaign` / `outreach_update_campaign` / `outreach_list_campaigns`. The weekly first-touch curator only drafts for campaigns with `autoDraftInitial = true`, and inbound prospect replies are auto-drafted only when `autoDraftReplies = true`. Existing campaigns keep auto-replies but must opt in to automated first-touch.

### Patch Changes

- Updated dependencies [834138e]
  - @getmunin/db@4.63.0
  - @getmunin/core@4.63.0
  - @getmunin/agent-runtime@4.63.0
  - @getmunin/mcp-toolkit@4.63.0
  - @getmunin/types@4.63.0
  - @getmunin/emails@4.63.0

## 4.62.1

### Patch Changes

- Updated dependencies [81e91ae]
  - @getmunin/db@4.62.1
  - @getmunin/core@4.62.1
  - @getmunin/agent-runtime@4.62.1
  - @getmunin/mcp-toolkit@4.62.1
  - @getmunin/types@4.62.1
  - @getmunin/emails@4.62.1

## 4.62.0

### Minor Changes

- 73491b2: CMS: first-class blocks for rich in-article content. A new `blocks` field type holds an ordered list of typed components (callouts, galleries, product cards, …), each block type being a named set of fields declared in `options.blockTypes`. Assets and entry references embedded inside blocks — typed props and inline `asset://` tokens in block prose — are validated on write, expanded on read (with the `_assets` sidecar), indexed for search, and tracked for deletion safety, exactly like top-level fields.

  Adds opt-in reference expansion: pass `?include=references` on the delivery API or `include: ["references"]` to `cms_get_entry` / `cms_list_entries` to resolve `reference` fields (top-level and inside blocks) one level deep into `{ id, slug, collection, locale, data }`; the default still returns raw ids.

  `json` is now scoped to opaque, non-renderable data: the server rejects `asset://` tokens and block-shaped arrays inside a `json` field, pointing authors at `blocks` instead. New skill `skill://cms/author-with-blocks`.

- 398077b: CMS: inline entry references (`ref://<entryId>`). Authors can link or embed another entry from within prose (a markdown/rich_text field or a block prop) with a `ref://<entryId>` token. Under `?include=references` (delivery API) or `include: ["references"]` (`cms_get_entry` / `cms_list_entries`), the response carries a `_refs` map keyed by entry id → `{ id, slug, collection, locale, data }`. Unlike `asset://`, the token is intentionally left in place (the server doesn't know the consumer's routing); the frontend resolves it via `_refs` to build its own link or embed.
- 4d7d83a: CMS: support inline images in entry bodies. Embed an `asset://<assetId>` reference inside a `markdown`/`rich_text` field and the delivery API, `cms_get_entry`, and `cms_search` resolve it to the asset's `publicUrl` plus an `_assets` sidecar map. Inline references are validated on write (an unknown or unconfirmed asset is rejected). Asset references — inline and typed fields alike — are now tracked, so `cms_delete_asset` refuses to delete an asset still in use, and a new `cms_list_asset_usage` tool reports which entries reference an asset.
- 5f7319d: CMS: `cms_search` reference expansion. Pass `include: ["references"]` to `cms_search` (or `?include=references` on the public delivery search endpoint) to resolve `reference` fields and inline `ref://` tokens on search hits — reference fields expand in place to `{ id, slug, collection, locale, data }` and inline tokens are surfaced in a `_refs` sidecar, matching the behavior of `cms_get_entry` / `cms_list_entries` and the entry delivery endpoints. Default search behavior (raw ids, no `_refs`) is unchanged.

### Patch Changes

- Updated dependencies [4d7d83a]
  - @getmunin/db@4.62.0
  - @getmunin/core@4.62.0
  - @getmunin/agent-runtime@4.62.0
  - @getmunin/mcp-toolkit@4.62.0
  - @getmunin/types@4.62.0
  - @getmunin/emails@4.62.0

## 4.61.1

### Patch Changes

- @getmunin/core@4.61.1
- @getmunin/db@4.61.1
- @getmunin/types@4.61.1
- @getmunin/mcp-toolkit@4.61.1
- @getmunin/agent-runtime@4.61.1
- @getmunin/emails@4.61.1

## 4.61.0

### Minor Changes

- 86bf3d0: Add `analytics_get_funnel`: an admin MCP tool that computes ordered conversion funnels (per-step visitor counts, conversion and drop-off rates) from page-view events. Steps match by `subjectType`/`subjectId` and/or a `pathLike` pattern, are strictly ordered, and support an optional per-step time budget (`stepWindowHours`). Visitors are grouped by their identified end-user when known (else their anonymous `visitor_id`), so a journey crossing the anonymous → identified boundary isn't double-counted.

  `analytics_get_contact_journey` now resolves the `visitor_id → end_user` link at read time, so a contact's page-views and searches recorded _before_ they identified are included retroactively (no backfill).

  Adds an `analytics_view_events (org_id, visitor_id, created_at)` index to back visitor-grouped scans.

### Patch Changes

- f92d186: Fix MCP tools that returned a bare `500 Internal server error` or an invalid result on otherwise-valid input. Database constraint violations are now caught before they fire and surface as actionable tool errors:

  - `crm_create_segment` — duplicate segment name now returns `crm_conflict` instead of a 500.
  - `conv_create_topic` — duplicate slug now returns `conv_topic_slug_conflict` instead of a 500.
  - `cms_create_locale` — duplicate locale code now returns `cms_locale_conflict` instead of a 500.
  - `crm_delete_segment` — deleting a segment referenced by an outreach campaign now explains the conflict (and how to resolve it) instead of a 500.
  - `conv_assign_conversation` — assigning to a user who is not a member of the org now returns a clear `conv_invalid` error instead of a 500.
  - `webhooks_delete` — now returns `{ deleted, id }` instead of nothing; a void return serialized to `undefined` content and tripped the MCP `CallToolResult` schema (`-32602`).

  The MCP dispatch layer also coalesces a void tool return to a valid `null` text result so a future void-returning tool can't produce a transport-level error.

- 8e0d50e: Tidy the MCP tools layer for consistency. No tool names, input schemas, or output shapes change.

  - Analytics: moved tracker CRUD and all reporting queries out of `AnalyticsAdminTools` into `AnalyticsService`, leaving the tool methods as thin delegators (matching every other module). Inline Zod schemas are now named consts inferred with `z.infer`, dropping the hand-maintained arg types.
  - Widget: extracted channel/key logic from `WidgetAdminTools` into a new `WidgetChannelAdminService`; the tool class now delegates.
  - Shared the duplicated API-key minting and origin-allowlist checks (analytics + widget) into `common/` helpers.
  - Renamed the vendor channel-admin files/classes that carried no `@McpTool` from `*.tools.ts`/`*AdminTools` to `*-admin.service.ts`/`*AdminService` (Twilio, MessageBird, Vapi, Threll).
  - Standardized empty-input schemas on the shared `EmptyInput`, set both `readOnlyHint` and `destructiveHint` on every feedback/system-alerts tool, and fixed `system_alerts_*` title casing.

- Updated dependencies [86bf3d0]
- Updated dependencies [f92d186]
  - @getmunin/db@4.61.0
  - @getmunin/mcp-toolkit@4.61.0
  - @getmunin/core@4.61.0
  - @getmunin/agent-runtime@4.61.0
  - @getmunin/types@4.61.0
  - @getmunin/emails@4.61.0

## 4.60.0

### Minor Changes

- c713b77: feat(conv): reopen on reply across channels + auto-close conversations waiting on the user

  Inbound replies now reopen a `closed`/`snoozed` conversation on every channel, not just the chat widget. A shared `reopenClosedConversation` helper is wired into the email adapter's threaded-reply path (and the widget path now reuses it), emitting `conversation.status_changed` when a conversation actually transitions back to `open`.

  A new deterministic backend sweep (`ConvSchedulerService`, hourly by default) auto-closes non-voice conversations that have been waiting on the end-user: open, last public message from an AI agent or human teammate, and idle past a threshold (default 2 days). Closing reuses the existing `changeStatus` path, so it clears human-attention flags, releases the runner lease, emits the status webhook, and enqueues CRM contact extraction — identical to an operator close. Configurable via `MUNIN_CONV_AUTO_CLOSE_CRON`, `MUNIN_CONV_AUTO_CLOSE_DAYS`, and `MUNIN_CONV_AUTO_CLOSE_DISABLED`.

### Patch Changes

- 84ee716: feat(access): show the authorizing member on each flock row

  The flock (Settings → Agents) groups OAuth connections by client _and_ the org member who authorized them, but only the client name was shown — so two members who each connected, say, Claude produced two visually identical rows with no way to tell whose access a revoke would cut off.

  `GET /v1/tokens` now joins the authorizing user and returns `user: { name, email }` per row. The Agents page shows that member inline after the client name ("Claude · Kjell Rune Monsø", with the email on hover and as the fallback when no name is set), replacing the "· N connections" count — which only reflected dynamic-client-registration reconnects and wasn't actionable, since a row already represents one member's access to one client and revoke cuts off that whole group.

- a393617: fix(outreach): correct fresh-email subject, unsubscribe domain, and link rendering

  - Only prepend `Re:` to outbound email subjects when the message is an actual reply (the conversation has prior messages or an `In-Reply-To` header); fresh outreach sends keep their subject verbatim.
  - Build the unsubscribe URL from the API domain (`MUNIN_API_URL`) like other transactional emails, instead of the MCP domain.
  - Render the unsubscribe footer as a markdown link (`[Unsubscribe](…)`) so it shows as an "Unsubscribe" link in the HTML email instead of a full URL.

- 6719043: Dashboard: replace the single "last conversation" widget with "Last open conversations" — the 20 most recently active open conversations, newest first, with closed/snoozed/spam filtered out.

  Conversations: add a snooze-wake worker that reopens snoozed conversations once their `snoozeUntil` elapses, flagging them as needing human attention so they resurface in the inbox. Previously `snoozeUntil` was stored but never honored, so timed snoozes never woke on their own.
  - @getmunin/core@4.60.0
  - @getmunin/db@4.60.0
  - @getmunin/types@4.60.0
  - @getmunin/mcp-toolkit@4.60.0
  - @getmunin/agent-runtime@4.60.0
  - @getmunin/emails@4.60.0

## 4.59.2

### Patch Changes

- 0d4aef1: fix(control): scope the API keys list to admin keys only

  The dashboard "API keys" page is labelled "Admin keys for the Munin API", but `GET /v1/api-keys` returned every non-revoked key for the org regardless of type — so widget (`mn_widget_*`) and tracker (`mn_track_*`) keys leaked into the list.

  `list()` now filters on `type = 'admin'`, and `revoke()` carries the same guard so this route can't revoke a widget/tracker key by id and bypass their dedicated rotation/cleanup flows (`analytics_revoke_tracker`, `conv_widget_rotate_key`). Revoking a non-admin key here now returns 404.

- 39443cb: fix(oauth): retire the `mcp:self_service` OAuth scope

  `mcp:self_service` was advertised in the OAuth discovery metadata (`scopes_supported`), so MCP clients like Claude — which request the full advertised set — were granted it on connect, cluttering every agent's scope list. It was inert (an admin-eligible OAuth agent always resolves to the `admin` audience via `deriveMcpAudience`), and nothing server-side ever used it: the self-service audience is granted directly to server-minted delegated end-user tokens (`audiences: ['self_service']`), not through an OAuth scope.

  Removed `mcp:self_service` from `SUPPORTED_SCOPES` (so it's no longer advertised or accepted) and dropped its now-orphaned branch in `deriveAudiencesFromScopes`. Existing tokens keep the scope until they reconnect; behavior is unchanged either way.

- 6f941e1: feat(access): OAuth-only flock with client identity; tidy end-user display

  **The flock (Settings → Agents)** now lists only OAuth-authorized agents. Delegated end-user tokens are no longer mixed in — they're managed on the End-users page. Each row leads with the OAuth client's name (e.g. "Claude · 3 connections") and a small client icon/glyph (matching the consent screen) instead of a generic "OAuth refresh token" label, the Origin column is dropped (its info moved into the primary label), and the table uses a fixed layout so the scopes list wraps inside the Token column instead of squeezing the other columns. `GET /v1/tokens` returns only OAuth agents (with `iconUrl`) and no longer merges the `tokens` table.

  **The End-users page** now shows a single identity line (name, else email, else phone, else "—") with an avatar of initials derived from the name ("Jens Pettersen" → "JP") or the email's first letter ("kjell@apps.no" → "K").

- Updated dependencies [39443cb]
- Updated dependencies [e5f7d98]
  - @getmunin/core@4.59.2
  - @getmunin/db@4.59.2
  - @getmunin/agent-runtime@4.59.2
  - @getmunin/mcp-toolkit@4.59.2
  - @getmunin/types@4.59.2
  - @getmunin/emails@4.59.2

## 4.59.1

### Patch Changes

- 7c3fa39: Refresh stale product copy: drop the hardcoded "~80 tools" count from the MCP server instructions (the surface has long since outgrown it) and replace the old "agent-native business apps" tagline with "the customer platform for the agentic era" in the dashboard metadata titles.
- 1940b63: fix(control): list OAuth agents from refresh tokens, not access tokens

  The previous fix read `oauth_access_token`, but MCP clients (Claude Code, Cursor, …) send a `resource` parameter per RFC 8707, so BetterAuth issues them **stateless JWT access tokens that are never persisted** — that table is empty in practice, so the flock still showed "Agents · 0".

  `GET /v1/tokens` now lists live (non-expired, non-revoked) **refresh tokens** — the durable record of a connected OAuth agent. Because dynamic client registration mints a fresh `client_id` on every connect, grants are collapsed into one row per (client name, user) with a connection count. Revoking a row soft-revokes (`revoked = now()`) every live refresh token in that group, so the agent can't refresh back in once its short-lived JWT expires.

- b8c162b: feat(oauth): pin OAuth/MCP agent connections to an organization

  OAuth agents used to float to the user's current default org, resolved live on every request — so the flock listed an agent under whichever org happened to be default, switching the default silently retargeted live agents, and revoke was user-global.

  Connections are now pinned to a specific org at consent time via BetterAuth's `consentReferenceId`, which persists the org as `reference_id` on the refresh token and as an `org_id` claim on the issued JWT access token (carried forward on refresh). The credential resolvers read that pinned org and require the user to still be a member of it — removing someone from an org now kills their agents there. Tokens issued before this change fall back to the default org and are backfilled by a migration.

  As a result the flock is truthful per-org (lists only agents pinned to the calling org) and revoke is org-scoped (only revokes grants pinned to the caller's org, leaving the same user's other-org agents alone). Which org an agent binds to is the user's active org at consent time, set with the existing topbar org switcher.

- Updated dependencies [b8c162b]
  - @getmunin/core@4.59.1
  - @getmunin/db@4.59.1
  - @getmunin/agent-runtime@4.59.1
  - @getmunin/mcp-toolkit@4.59.1
  - @getmunin/types@4.59.1
  - @getmunin/emails@4.59.1

## 4.59.0

### Minor Changes

- 2e3b87a: feat(conv): per-channel default agent mode

  Add `defaultAgentMode` (`auto` | `draft_only` | `off`) to conversation channels. New conversations inherit the channel's mode when no explicit mode is passed — including inbound replies that fail threading and open a fresh conversation. Set an outreach-only inbox to `draft_only` so prospect replies are always drafted for human approval and never auto-sent, even when threading can't link the reply to its originating conversation. Configurable via `conv_setup_email_channel` and the email channel dialog.

### Patch Changes

- 0fb358d: fix(control): show OAuth-authorized agents in the flock

  The Settings → Agents page ("The flock") read only the `tokens` table, which is populated solely by delegated end-user tokens. OAuth-authorized MCP clients (Claude Code, Cursor, Claude Desktop, …) have their access/refresh tokens persisted by BetterAuth in the separate `oauth_*` tables, so a fully-connected agent always showed up as "Agents · 0 / No connected agents yet".

  `GET /v1/tokens` now also lists live (non-expired) OAuth access tokens — one row per (client, user), scoped to the calling org via `org_members` — with the OAuth client name as the origin. Revoking such a row (`DELETE /v1/tokens/:id` for an `oat_*` id) deletes both the access and refresh tokens so the agent can't silently refresh back in.

- Updated dependencies [2e3b87a]
  - @getmunin/types@4.59.0
  - @getmunin/db@4.59.0
  - @getmunin/core@4.59.0
  - @getmunin/mcp-toolkit@4.59.0
  - @getmunin/agent-runtime@4.59.0
  - @getmunin/emails@4.59.0

## 4.58.0

### Minor Changes

- cd6b338: feat(auth): optional Cloudflare Turnstile captcha on email auth endpoints

  Adds opt-in captcha protection to the BetterAuth email flows (`/sign-up/email`, `/sign-in/email`, `/request-password-reset`). It is disabled by default and turns on only when both `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY` are set — the server verifies the token via the captcha plugin, and the shared login / signup / forgot-password forms render the Turnstile widget using the public site key exposed through `/v1/auth/providers`. Requiring both keys avoids a lockout where the server enforces a captcha the client cannot produce. Self-hosters who set neither key see no change.

### Patch Changes

- Updated dependencies [3d91858]
  - @getmunin/types@4.58.0
  - @getmunin/core@4.58.0
  - @getmunin/db@4.58.0
  - @getmunin/mcp-toolkit@4.58.0
  - @getmunin/agent-runtime@4.58.0
  - @getmunin/emails@4.58.0

## 4.57.1

### Patch Changes

- Updated dependencies [f23f7e3]
  - @getmunin/agent-runtime@4.57.1
  - @getmunin/core@4.57.1
  - @getmunin/mcp-toolkit@4.57.1
  - @getmunin/db@4.57.1
  - @getmunin/types@4.57.1
  - @getmunin/emails@4.57.1

## 4.57.0

### Minor Changes

- 3ce6c5d: Show AI token usage per operation in the audit log. The `audit_log` table gains a
  `total_tokens` column, populated for token-spending operations — curator/background jobs
  (skills, web import) via the acknowledge call, and chat/conversation agent replies — and
  left blank for everything else. The audit-log API and dashboard page now expose a Tokens
  column.

### Patch Changes

- 4c3a9f7: Stop the staff handover draft from just repeating the bot's public deferral.

  When the self-service bot escalated a conversation it couldn't answer, it often filled `suggestedReply` with the same "a teammate will follow up" message it sent the end user, so the dashboard draft ("Your answer") just parroted the public reply. The handover tool descriptions now tell the model to pass `suggestedReply` only when it has a substantive answer (and to omit it otherwise), and the conversation runner deletes the draft when it merely repeats the public reply via a new `POST /v1/conversations/:id/clear-draft` route (`ConvService.clearDraftReply` / `MuninRestClient.clearDraftReply`).

- Updated dependencies [4c3a9f7]
  - @getmunin/agent-runtime@4.57.0
  - @getmunin/core@4.57.0
  - @getmunin/db@4.57.0
  - @getmunin/types@4.57.0
  - @getmunin/mcp-toolkit@4.57.0
  - @getmunin/emails@4.57.0

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
