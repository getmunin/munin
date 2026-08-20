# @getmunin/types

## 5.8.0

## 5.7.0

## 5.6.0

## 5.5.0

## 5.4.0

## 5.3.0

## 5.2.2

## 5.2.1

## 5.2.0

## 5.1.0

### Patch Changes

- be67821: fix(agent): reconcile the model against the provider in one save

  Switching provider in the dashboard was a client-orchestrated two-step: PUT
  `/v1/agent-config` with the new base URL and key, GET `/v1/agent-config/models`,
  then a second PUT to fix the model. The first PUT already emits
  `agent.config.updated`, and the runner respawns on it, so for the length of the
  models round trip (18 s in the incident that surfaced this) a live runner held
  the new provider with the previous provider's model id. Anthropic 404'd a model
  name it had never heard of, and every curator job draining in that window
  hard-failed.

  The reconcile now happens server-side inside the single upsert, before the row is
  written and before the webhook fires: when the base URL or key changes, the
  provider's model list is fetched and a `fastModel` it doesn't offer is replaced
  with that provider's default (or the first model it does offer), while an unknown
  `smartModel` is cleared. The runner can no longer observe a mismatched pair. The
  same check guards the other direction — an explicitly supplied model the provider
  doesn't offer is now rejected with an `agent_config_invalid_model` code instead of
  being persisted into a config that can only 404, translated in both locales for
  the one path a dashboard user can hit it on (a model dropped from the provider's
  catalog while the page held a cached list). Providers without an OpenAI-compatible
  `/models` endpoint are left alone, so bring-your-own gateways still work.

  Provider failures also stop spending a job's retry budget. `attempts` is
  incremented at claim and was never given back when a provider error parked the
  job as `failed_retryable`, so a job that came back through the recovery sweep had
  already burned attempts and the next genuine failure sent it straight to `dead`.
  Parking now refunds the attempt. Provider alerts additionally carry the model id
  and base URL, so a mismatch reads as one instead of a bare 404.

- be67821: refactor: one shared trailing-slash trim instead of 50 copies of a polynomial regex

  `replace(/\/+$/, '')` appeared at ~50 base-URL call sites. The pattern is
  quadratic on a long run of slashes — the engine retries the match from every
  start position — which CodeQL flags wherever the input can come from outside
  the process. Most sites read an env var and were never reachable, but the
  connector base URLs (`magento.adapter.ts`, `gastroplanner.adapter.ts`), the
  agent provider base URL, the SDK's `baseUrl` and the tracker's `data-api`
  attribute all take theirs from a request or a customer's config.

  `stripTrailingSlashes` now lives in `@getmunin/types` — the one package
  everything already depends on — and walks back from the end of the string in
  linear time. `@getmunin/sdk` and `@getmunin/analytics-tracker` ship standalone
  bundles with no workspace dependencies, so they keep a local copy of the same
  four lines rather than take one. Behavior is unchanged at every site, which
  `packages/types/src/url.test.ts` pins against the old regex case by case.

## 5.0.2

## 5.0.1

## 5.0.0

### Minor Changes

- ace185f: Give email open tracking a read surface.

  Opens have been recorded since the tracking pixel landed — `conv_message_deliveries`
  carries `first_opened_at`, `last_opened_at` and `open_count` — but nothing read them
  back. The pixel controller was the table's only reader, so the data was write-only:
  unreachable from MCP, the control plane and the dashboard alike.

  Three changes close that:

  - `conv_get_conversation` now returns `firstOpenedAt`, `lastOpenedAt` and `openCount`
    per message, mirroring how the widget's `seenAt` read receipt is already surfaced.
    `openCount` is `null` when the message has no delivery row at all (inbound, internal,
    or a non-email channel) and `0` when it was emailed but never opened — the two cases
    mean different things when reporting, so they stay distinguishable.
  - New `conv_get_email_open_stats` tool aggregates deliveries per email channel over a
    window (default 30 days): messages sent, how many were opened at least once, total
    opens, and the open rate, plus org-wide totals. Each row carries the channel's
    `trackOpens` flag, because a channel with tracking off reports a 0% rate that would
    otherwise read as "nobody opened these".
  - `conversation.message.opened` is added to the event-type catalog. The pixel has been
    emitting it all along, but it was absent from `webhooks_list_event_types` and the
    `skill://webhooks/subscribe-to-events` docs, so the only way to subscribe was to guess
    the string. `conversation.message.read` (widget read receipts, emitted by the realtime
    gateway) and `cms.entry.archived` (emitted alongside the already-listed `unpublished`
    and `scheduled` transitions) were missing for the same reason and are now listed too.

  Also adds `skill://conv/track-email-opens`, which documents enabling `trackOpens`,
  reading both surfaces, and the under- and over-counting that pixel tracking carries
  (blocked images, Apple Mail Privacy Protection pre-fetch) — those caveats belong next to
  the numbers, not in a commit message.

## 4.81.0

## 4.80.1

## 4.80.0

## 4.79.0

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

## 4.75.0

### Minor Changes

- c5a05c5: SMS channels can set how the agent handles inbound texts

  `defaultAgentMode` has always been a `conv_channels` column, but only the email path could write it — the vendor-backed path that creates every SMS channel had no way to set it, and neither did the dashboard. Every SMS number was stuck on `auto`, replying to inbound texts automatically.

  It is now settable on SMS channels through `conv_configure_channel`, the vendor tools, the `/v1` SMS endpoints, and a control in the Twilio and MessageBird dialogs alongside the one email already had. Set `draft_only` on a number you only run campaigns from and inbound replies are drafted for approval instead of auto-answered.

  Voice channels reject it with an explanation rather than accepting a value that would do nothing: an inbound call is run by the vendor's assistant, not by the Munin agent, so there is no reply for the mode to govern.

  Also corrects `conv_create_channel`'s description, which claimed "the `voice` and `sms` channel types are reserved and not yet wired to an adapter". Both SMS vendors and both voice vendors have shipped adapters; those channels are created with `conv_configure_channel`, which the description now says.

### Patch Changes

- c5a05c5: SMS channel dialogs: agent-reply select on create, sender switching actually clears

  The "Agent replies" select is now on the SMS create dialog, not just edit — a new channel no longer silently starts on `auto` until someone goes back and changes it. Renamed from "Default agent mode" / "Inbound replies" to a shared "Agent replies" across email and SMS dialogs, since "agent mode" is the database column name, not something an operator configuring a phone number has a mental model for.

  Twilio's From-number and Messaging-Service-SID fields are now a single "Send from" choice instead of two always-visible inputs with an "either, both is also OK" caveat. Switching the choice on an existing channel now actually clears the field you switched away from — `updateChannel` previously merged with `?? prev`, so the old value survived a switch and both were sent on every message.

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

## 4.73.0

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

## 4.72.0

## 4.71.0

### Minor Changes

- 426a66e: CMS: keep the master, serve derivatives. Image assets now carry a ladder of WebP renditions and the delivery API hands out the light one.

  Until now an asset was delivered exactly as uploaded. The dashboard downscaled client-side before upload, but every other path — `cms_upload_asset_from_base64`, `cms_upload_asset_from_url`, presigned uploads, and generated images — stored whatever bytes arrived and served them verbatim. A 2.2MB PNG hero and a 99KB hand-uploaded JPEG could sit in the same library with no policy between them.

  - `cms_assets` gains `width`, `height`, `variants`, and `variants_version`. Variants are derived state: the original upload is always preserved as the master at `public_url`.
  - Uploads derive renditions at 320/640/1024/1536/2048px plus one full-size recompress (capped at 2560px), skipping any width at or above the source so nothing is ever upscaled. WebP at quality 80. For a 1536×1024 master the whole ladder costs ~10% of the master's bytes.
  - The delivery API rewrites inline `asset://` tokens to the widest variant instead of the master, and `AssetSummary` (typed asset fields and the `_assets` sidecar) now carries `width`, `height`, and the full variant list so consumers can build a `srcset`. Assets without variants keep resolving to the master, so nothing breaks while the library converges.
  - Generation is not a one-shot backfill. The existing CMS worker reconciles any asset below the current ladder version, which covers assets that predate this change, presigned uploads whose bytes arrived late, and generation that failed on the upload path. Changing the ladder later is a version bump rather than a new migration script, and generation on upload is therefore an optimisation rather than a correctness requirement.
  - Non-images and undecodable bytes are settled once so the worker stops reclaiming them. Batch size is tunable with `MUNIN_CMS_VARIANT_BATCH` (default 10 per tick).

## 4.70.1

## 4.70.0

### Minor Changes

- e123820: Add `outreach_revise_proposal` and `outreach_withdraw_proposal`, the two agent-side corrections to a pending outreach draft.

  `outreach_revise_proposal` rewrites the draft in place on the same proposal id — the contact and campaign are fixed, since a different recipient is a different proposal. A `reason` is required and the revision is recorded (`revisionCount`, `lastRevisedAt`, `lastRevisionReason`, revising actor), so an edit can never be silent. Proposals now also record the first time a human opens them for review; when a revision lands after someone else has already read the draft, `revisedAfterReviewAt` is stamped and both the dashboard review drawer and the MCP Apps inspector panel warn the reviewer that Wednesday's text is not the text they read on Monday.

  `outreach_withdraw_proposal` lets a curator retract its own pending draft — a duplicate, a prospect who turned out not to qualify, a bounced address — under a new terminal `withdrawn` status. Withdrawal is deliberately neutral: it does not suppress the contact, does not touch consent, and does not stop a campaign sequence, so a withdrawn follow-up leaves that step eligible again where a dismissed one ends the sequence for good. Slack approval cards resolve as withdrawn, and `skill://outreach/review-proposals` documents when each of the four verbs applies.

## 4.69.3

## 4.69.2

## 4.69.1

## 4.69.0

### Minor Changes

- 18dc6a6: Slack approval notifications: pending CRM merge proposals, outreach drafts, and KB curation candidates now post to Slack with approve/dismiss buttons, and the message updates in place once the item is decided anywhere. New optional `approvals` channel route (`slack_set_routing` with `purpose: "approvals"`), falling back to escalations, then default. KB curation now emits `kb.curation_candidate.proposed/published/dismissed` events, and the CRM merge events `crm.merge_proposal.applied/dismissed` join the public event catalog. Adds the `slack_notification_links` table and a `subject_key` ordering column on `slack_deliveries` (migration 0055).
- 6f31549: Slack thread parents now headline the conversation subject once it is set. `conv_set_subject` emits a new `conversation.subject_changed` event, the Slack bridge mirrors it by refreshing the thread root in place (no thread reply), and the parent headline switches from "New conversation #N" to the subject.

  Resolved conversations are now unmistakable in Slack: the parent's status line becomes a ":white*check_mark: \_Conversation is resolved.*" banner (":no*entry_sign: \_Marked as spam.*" for spam), and status-change thread replies use human phrasing ("Conversation is resolved.", "Conversation reopened", "Conversation snoozed") instead of "Status changed to _closed_".

## 4.68.0

### Minor Changes

- 491186c: Multi-step outreach sequences. Campaigns can define ordered `sequenceSteps` (wait period + drafting brief per step, email campaigns only); a daily curator sweep (`skill://outreach/draft-followup-email`, `MUNIN_CURATOR_OUTREACH_FOLLOWUP_CRON`) finds conversations whose next step is due via the new `outreach_list_due_followups` tool and files `kind: 'followup'` proposals with `outreach_propose_followup` into the existing human review queue. Any inbound reply permanently stops a sequence (the reply flow takes over), as does unsubscribe/suppression or dismissing a follow-up draft. Follow-ups thread into the initial's conversation with no subject or unsubscribe footer, and export/import round-trips sequences.

## 4.67.2

## 4.67.1

## 4.67.0

## 4.66.1

## 4.66.0

## 4.65.0

## 4.64.0

## 4.63.1

## 4.63.0

## 4.62.1

## 4.62.0

## 4.61.1

## 4.61.0

## 4.60.0

## 4.59.2

## 4.59.1

## 4.59.0

### Minor Changes

- 2e3b87a: feat(conv): per-channel default agent mode

  Add `defaultAgentMode` (`auto` | `draft_only` | `off`) to conversation channels. New conversations inherit the channel's mode when no explicit mode is passed — including inbound replies that fail threading and open a fresh conversation. Set an outreach-only inbox to `draft_only` so prospect replies are always drafted for human approval and never auto-sent, even when threading can't link the reply to its originating conversation. Configurable via `conv_setup_email_channel` and the email channel dialog.

## 4.58.0

### Patch Changes

- 3d91858: Reduce curator token usage: tighter per-skill tool allowlists and a lower iteration cap.

  - **Tighter tool allowlists.** `TOOL_PREFIXES_BY_URI` in the job catalog gated each curator skill by broad module prefixes (`conv_`, `kb_`, `crm_`, `outreach_`), which loaded 10–30 tool schemas into the model context on every turn of the tool loop — re-sent on each iteration. Each scheduled/event-driven skill now allowlists only the exact tools its procedure actually calls (e.g. `set-topic-and-title` drops from all `conv_*` to 5 tools; `clean-contact-data` drops the unused `conv_` prefix entirely; `review-stale-entries` drops every mutating `cms_*` tool, enforcing its propose-only invariant at the runtime layer). Behavior is unchanged — the dropped tools were either operator-review-loop tools or ones the skills never call.
  - **Lower iteration cap.** Curator skill passes now stop after `CURATOR_MAX_TOOL_ITERATIONS` (16) tool-loop iterations instead of 24. Since the full prompt prefix is re-sent on every iteration, this clips the worst-case per-job token spend; batch sweeps that don't finish in one pass resume on the next scheduled run (dedupe keeps them idempotent).

## 4.57.1

## 4.57.0

## 4.56.1

## 4.56.0

## 4.55.0

## 4.54.0

## 4.53.0

### Minor Changes

- 95f2983: Prioritize interactive onboarding work over background curator jobs. Curator jobs now carry a `priority` (default `0`), and the claim path orders by `priority DESC, next_attempt_at ASC` so a user-initiated website import (`task://web/scrape-website`, priority `100`) is claimed ahead of a backlog of older scheduled `skill://` sweeps instead of waiting behind them. Priority is derived centrally via `priorityFor(uri)` and can be overridden per-enqueue; a partial index keeps the claim path index-served.
- 82fef68: Redesign the onboarding "Lift-off" summary's website-import section into three real states — importing, failed, and succeeded — driven by live crawl progress.

  The web crawler now emits incremental progress (`{ total, done, recentPaths }`) as it reads pages; the runner persists it to a new nullable `curator_jobs.progress` column (throttled, best-effort), and the curator-job DTO surfaces it via `GET /v1/curator/jobs/:id`. The summary screen polls that to show a live `done / total` counter, a progress bar, and the paths being read while importing; the imported page count and duration on success; and the failure reason plus an inline **Retry import** on failure. A new internal `POST /v1/curator/jobs/:id/progress` endpoint backs the out-of-process runner path.

  Also align the full-screen loading screens with the page background: `AuthLoading` (and the root route loader) now paint `bg-bone` so the loader no longer flashes the lighter paper surface before the bone-backed page resolves.

## 4.52.1

## 4.52.0

## 4.51.4

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

## 4.51.2

## 4.51.1

## 4.51.0

## 4.50.1

## 4.50.0

### Minor Changes

- 3f034de: Auto-provision the Threll webhook subscription when creating a Threll voice channel.

  Munin now uses the Threll API key to register the webhook subscription with Threll (`POST /accounts/{accountId}/webhook-subscriptions`, `eventType: "*"`) and stores the signing secret Threll returns — the admin no longer generates a secret and pastes it into Threll. Provisioning happens atomically during channel create: the channel id is minted up front and the Threll call runs before the row is inserted, so if provisioning fails nothing is persisted and the dashboard shows a retry-only error. The webhook URL is built from the canonical server-side API base (`readApiBaseUrl()` / `MUNIN_API_URL`). The webhook signing secret is now Threll-owned and immutable, so the manual webhook-secret field is removed from the Threll create and edit dialogs. `ConfigureThrellBody` and the Threll MCP configure tool no longer accept `webhookSecret` on create. The Vapi flow is unchanged.

## 4.49.0

## 4.48.0

### Minor Changes

- dc70c67: Automatically triage new inbound conversations with a topic and a title.
  - New `skill://conv/set-topic-and-title` curator skill (fast tier, `conv_` tools): reads a freshly-created conversation, tags it with the best-fitting topic (creating one only when confident none fit), and gives it a short title when it has no subject yet.
  - New `conv_set_subject` MCP tool (admin, `conv:write`) so the skill can title conversations that arrive without a subject (chat, SMS, voice). Email subjects are left untouched.
  - The job is enqueued on the first inbound end-user message across every channel: email (new thread), generic webhook channels, the chat widget, and `conv_*`/control-plane conversation creation. A per-conversation dedupe key keeps it idempotent.

## 4.47.0

## 4.46.0

## 4.45.1

## 4.45.0

## 4.44.1

## 4.44.0

## 4.43.2

## 4.43.1

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

## 4.42.0

## 4.41.1

## 4.41.0

## 4.40.4

## 4.40.3

## 4.40.2

## 4.40.1

## 4.40.0

## 4.39.0

## 4.38.0

## 4.37.0

## 4.36.0

## 4.35.0

## 4.34.0

## 4.33.0

## 4.32.0

### Minor Changes

- 03d62af: Webhook management is now available to AI agents via MCP. Adds seven `webhooks_*` tools (`list`, `create`, `update`, `delete`, `rotate_secret`, `list_deliveries`, `list_event_types`) backed by a new `WebhooksService` that the existing REST controller at `/v1/webhooks` also delegates to. The controller gains `POST :id/rotate-secret`, `GET :id/deliveries`, and `GET event-types` endpoints. Tools follow the system-alerts convention (`audiences: ['admin']`, `scopes: []`) — no new OAuth scopes were introduced.

  Adds `cms_upload_asset_from_url`: server-side fetches an HTTPS asset and stores it as a CMS asset in one call. Bypasses the presigned-PUT + base64 round-trips that some agent sandboxes (e.g. ChatGPT/Claude workspaces) cannot complete. Guarded by `safeFetch` (SSRF, redirect cap, 15s timeout), a 50 MB streamed size cap (Content-Length is not trusted), and a MIME allowlist (`image/*`, `video/*`, `audio/*`, `application/pdf`; SVG remains rejected). The original URL is recorded in `metadata.sourceUrl`.

  Consolidates webhook event-type strings in `@getmunin/types`: new exports `CMS_EVENT_TYPES`, `CRM_EVENT_TYPES`, `KB_EVENT_TYPES`, `CONVERSATION_EVENT_TYPES`, `OUTREACH_EVENT_TYPES`, `SYSTEM_EVENT_TYPES`, `EVENT_TYPES_BY_MODULE`, `KNOWN_EVENT_TYPES`, and `isKnownEventType`. The dispatcher's `emit({ type })` still accepts arbitrary strings; the catalog is the source of truth for `webhooks_list_event_types` and is available for typed consumers going forward.

  Realtime gateway now sends `{ type: 'read_ack', conversationId, messageIds }` to the originating socket after a `read` frame's `conv_message_reads` INSERT commits. All existing WebSocket consumers (chat-widget, dashboard, agent-runtime) silently ignore unknown frame types, so this is additive. The widget integration test for `conv_message_reads` waits for the ack instead of `setTimeout(200)`, eliminating a CI flake.

## 4.31.0

## 4.30.0

## 4.29.2

## 4.29.1

## 4.29.0

## 4.28.0

## 4.27.1

## 4.27.0

## 4.26.0

## 4.25.0

## 4.24.3

## 4.24.2

## 4.24.1

## 4.24.0

## 4.23.5

## 4.23.4

## 4.23.3

## 4.23.2

### Patch Changes

- f0e5389: Security: close widget→admin escalation, SSRF in website-import, upload signing weaknesses, and control-plane authorization gaps.
  - Public `mn_widget_*` keys now resolve as a new `widget_agent` actor (not `admin_agent`), with audience forced to `self_service` and scopes narrowed to `conv:widget:write`. New `ControlPlaneGuard` rejects widget/end-user/partner actors and scoped admin keys (must have `*`) on `/v1/*` admin routes, so embedded widget keys can no longer mint, list, or revoke admin API keys, configure channels, or enqueue curator jobs.
  - Website-import enqueue and the underlying crawler validate URLs against private/loopback/link-local/cloud-metadata ranges. A new `safeFetch` helper enforces an undici dispatcher that re-validates the resolved IP at connect time (DNS-rebinding-safe) and walks redirects manually.
  - Local-storage upload signing switched from plain SHA-256 to HMAC-SHA256; `LocalFsStorage` throws on startup if `MUNIN_STORAGE_LOCAL_SECRET` is missing under `NODE_ENV=production`. Static asset serving sets `X-Content-Type-Options: nosniff`.
  - S3 uploads switched from presigned PUT to presigned POST with a `content-length-range` policy condition pinned to the declared size, so an oversized body is rejected by S3 itself. `cms_complete_asset_upload` HEADs the object and rejects (deleting the storage object) on size mismatch. `AssetStorage.presignedUpload` now returns `{ uploadUrl, uploadMethod, uploadFields, … }`; `AssetStorage.statBytes` is now required on the interface.

## 4.23.1

## 4.23.0

## 4.22.0

## 4.21.0

## 4.20.0

## 4.19.4

## 4.19.3

## 4.19.2

## 4.19.1

## 4.19.0

## 4.18.0

## 4.17.0

## 4.16.0

## 4.15.0

## 4.14.0

## 4.13.0

## 4.12.0

## 4.11.0

## 4.10.0

## 4.9.0

## 4.8.0

## 4.7.1

## 4.7.0

## 4.6.1

## 4.6.0

## 4.5.1

## 4.5.0

## 4.4.1

## 4.4.0

## 4.3.0

## 4.2.0

## 4.1.1

## 4.1.0

## 4.0.0

## 3.9.1

## 3.9.0

### Minor Changes

- ed2bb6b: Add generic `SmtpMailer` provider to `@getmunin/core`.

  Covers any SMTP-speaking transactional email service (Scaleway TEM, Postmark,
  Mailgun, Postmark, etc.) via a single implementation. Activated by setting
  `MUNIN_MAIL_PROVIDER=smtp` along with `MUNIN_SMTP_HOST`, `MUNIN_SMTP_PORT`,
  `MUNIN_SMTP_USER`, `MUNIN_SMTP_PASSWORD` (optional `MUNIN_SMTP_SECURE=1` for
  implicit-TLS on port 465). `nodemailer` is the underlying transport.

## 3.8.0

### Minor Changes

- a3f532e: Onboarding cleanup, agent-config hot-reload, provider auth validation.
  - Dropped the chatbot-name field from the onboarding form; new orgs seed with an empty name so step 1 is shown until the user names their bot.
  - Removed the unused `orgs.slug` column (migration 0027); CMS delivery routes (`/api/v1/cms/:orgId/...`) and the matching SDK clients now key on `orgId` rather than the slug.
  - `AgentConfigService` validates provider credentials _before_ persisting — OpenRouter is probed via `/auth/key` (since its `/models` endpoint is public), Anthropic/OpenAI rely on `/models` 401. Bad keys no longer silently overwrite a working config.
  - Saving agent config emits `agent.config.updated` via the WebhookDispatcher; the realtime gateway broadcasts it and `AgentHostRunner` respawns the affected runner — model/provider changes apply without a backend restart.
  - Models picker reconciles a stale stored model slug against the fetched model list at render time, so the dropdown can't round-trip an unknown id back to the server.
  - Chat widget no longer filters the current session's conversation out of the past-conversation list — going back from a fresh conversation shows it.

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

## 0.23.3

## 0.23.2

## 0.23.1

## 0.23.0

## 0.22.0

## 0.21.0

## 0.20.0

## 0.19.0

## 0.18.0

## 0.17.0

## 0.16.1

## 0.16.0

## 0.15.0

## 0.14.0

## 0.13.0

## 0.12.0

## 0.11.0

## 0.10.0

## 0.9.1

## 0.9.0

## 0.8.0

## 0.7.0

## 0.6.0

## 0.5.0

## 0.4.0

## 0.3.1

### Patch Changes

- fe8fd21: TenancyInterceptor: bypass RLS for `actor.type === 'partner'`.

  Partner actors (in a downstream package) operate across multiple orgs they
  provisioned. Their controllers filter manually by `partner_id`. OSS
  never produces `'partner'` actors, so this branch is dead code there.

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

## 0.2.0

### Minor Changes

- f3abef4: Add cross-org switcher endpoint + UI.
  - New `GET /api/orgs/me/memberships` — list every org the caller is a member of (id, name, slug, role, isDefault).
  - New `PATCH /api/orgs/me/memberships/active` — flip `is_default` so the next session-cookie request resolves to the chosen org.
  - New `<OrgSwitcher />` component in `@getmunin/dashboard-pages` that wraps both endpoints. Cloud's dashboard layout renders it in the header.

  OSS (single-tenant) installs see exactly one membership and don't render a switcher.
