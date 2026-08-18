# @getmunin/analytics-tracker

## 5.2.0

## 5.1.0

### Patch Changes

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

### Major Changes

- 68748a3: Namespace the browser API: `window.mn.analytics.*` and `window.mn.widget.*`

  **Breaking.** Both bundles used to install onto `window.mn` — the tracker owned the root, the widget owned `mn.widget` _and_ leaked `identify` onto the root. Since each also chained to whatever `identify` was already there, a page running both sent one hash to two verifiers that check different payloads against different secrets, so one always rejected. That failure was lopsided and the bad half was silent: the widget logs to the console, the tracker fires `sendBeacon` and never looks at the response, leaving only `identify.rejected: hmac_mismatch` in a server log an integrator can't see. An empty contact journey with no client-side error was the only symptom.

  Each surface now owns a namespace, and the chaining is gone:

  | Before                                | After                                  |
  | ------------------------------------- | -------------------------------------- |
  | `window.mn.track(...)`                | `window.mn.analytics.track(...)`       |
  | `window.mn.trackOnce(...)`            | `window.mn.analytics.trackOnce(...)`   |
  | `window.mn.trackPageView()`           | `window.mn.analytics.trackPageView()`  |
  | `window.mn.trackSearch(...)`          | `window.mn.analytics.trackSearch(...)` |
  | `window.mn.trackEntry(...)`           | `window.mn.analytics.trackEntry(...)`  |
  | `window.mn.getVisitorId()`            | `window.mn.analytics.getVisitorId()`   |
  | `window.mn.identify(...)` _(tracker)_ | `window.mn.analytics.identify(...)`    |
  | `window.mn.identify(...)` _(widget)_  | `window.mn.widget.identify(...)`       |
  | `window.mn.ready`                     | `window.mn.analytics.ready`            |
  | `munin:ready` event                   | `munin:analytics-ready` event          |

  `window.mn.widget.open/close/toggle/isOpen` are unchanged. The widget gains `ready` and a `munin:widget-ready` event, which it never had — needed now that `identify` lives behind a namespace that only exists once the widget mounts.

  **Declarative embeds need no changes.** Every `data-*` attribute — `data-key`, `data-subject-type`, `data-mn-event`, `data-mn-once`, `data-external-id`, `data-user-hash`, `data-mn-entry-token` — works exactly as before. This is a JS-API change only, so a site that never calls `window.mn` from its own code is unaffected by the upgrade.

  **Where the break lands is unusual.** Nothing fails at deploy: the backend starts, the API is unchanged, and the new bundles serve normally. What breaks is JavaScript on the _customer's_ pages, the moment the upgraded bundle is served. Anyone calling `window.mn.*` from their own code updates the calls above; the failure is a loud `TypeError` rather than silent wrong behaviour.

  **A rejected identify is no longer silent.** `POST /v1/a/identify` used to answer `204` for every outcome, and the tracker sent it with `sendBeacon` and never read the response — so a hash signed with the wrong secret produced no client-side signal at all, only a server log the integrator couldn't see. The endpoint now answers `400 identity_invalid` / `identity_secret_missing` / `identity_hash_mismatch` and `403 identity_origin_not_allowed`, the tracker posts with `fetch(..., { keepalive: true })` and logs a console warning naming the status. An unrecognized tracker key still answers `204`, so the endpoint doesn't confirm which keys exist. Direct callers of this endpoint that assumed "always 204" should expect real status codes now.

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

## 4.81.0

## 4.80.1

## 4.80.0

## 4.79.0

## 4.78.0

## 4.77.0

## 4.76.0

## 4.75.0

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

## 4.72.0

## 4.71.0

## 4.70.1

## 4.70.0

## 4.69.3

## 4.69.2

## 4.69.1

## 4.69.0

## 4.68.0

## 4.67.2

## 4.67.1

## 4.67.0

## 4.66.1

## 4.66.0

## 4.65.0

### Minor Changes

- 07f1d6e: analytics-tracker: expose a readiness signal. Once the tracker's public API is installed it sets `window.mn.ready = true` and dispatches a `munin:ready` CustomEvent on `document`, so consumers can run identify round trips (or any `window.mn.*` call) as soon as the async script is ready — no polling, no dependence on the loader's own readiness callback:

  ```js
  window.mn?.ready ? go() : document.addEventListener('munin:ready', go, { once: true });
  ```

  `skill://analytics/identify-visitors`, the frontend-integration playbook, and the dashboard embed snippet now show this pattern.

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

## 4.58.0

## 4.57.1

## 4.57.0

## 4.56.1

## 4.56.0

## 4.55.0

## 4.54.0

## 4.53.0

## 4.52.1

## 4.52.0

## 4.51.4

## 4.51.3

## 4.51.2

## 4.51.1

## 4.51.0

## 4.50.1

## 4.50.0

## 4.49.0

## 4.48.0

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

### Patch Changes

- 15d6ed4: When `localStorage` throws (private windows, embedded WebViews, locked-down enterprise browsers, storage quota), the tracker bundle now generates a page-scoped UUID as the visitor id instead of sending `null`. Previously every pageview from a storage-disabled session read as a new visitor, so unique-visitor counts and within-session dedup were broken for that traffic — and SPA route changes from one user looked like N separate visitors.

  The fallback id only survives the page lifetime (no persistent storage to fall back on), so the same user reloading the page still gets counted twice. That's the inherent cost of having no storage; this fix just keeps at least intra-session dedup working. Privacy story is unchanged — the id is a random UUID, never linked to PII.

## 4.41.1

## 4.41.0

## 4.40.4

## 4.40.3

### Patch Changes

- 1fe3019: Fix the analytics tracker beacon failing with `ERR_FAILED` / `Access-Control-Allow-Credentials` errors in production browsers.

  `navigator.sendBeacon` always sends with `credentials: 'include'` (no opt-out), and the previous bundle wrapped its JSON body in a `Blob` with type `application/json`. Since `application/json` is not in the CORS-safelisted Content-Type set, the browser issued a CORS preflight. The beacon endpoint sits under `/v1/a/*`, which `bootstrap-app.ts` treats as a public-CORS path — those echo the request `Origin` but deliberately omit `Access-Control-Allow-Credentials: true` (per CORS spec: wildcard-style origin handling is incompatible with credentials). The preflight therefore failed, and the actual POST never happened. The pixel route (`GET /v1/a/t/:key.gif`) was unaffected because GETs without custom headers don't preflight.

  Coupled fix:
  - **Bundle (`apps/analytics-tracker/src/tracker.ts`)**: emit the body as `text/plain;charset=UTF-8`. That's CORS-safelisted, so `navigator.sendBeacon` (and the `fetch` no-cors fallback) send the request without a preflight, while cookies still come along — the server doesn't read them anyway.
  - **Server (`packages/backend-core/src/bootstrap-app.ts`)**: widen the JSON body parser to also accept `text/plain` bodies. The parser still does `JSON.parse`, so the controller's `@Body() rawBody: unknown` keeps the same shape and the existing Zod schema does the rest. No other endpoints rely on receiving raw `text/plain` today, so the wider type list is a safe extension.

  Integration test updated to use `text/plain;charset=UTF-8` so it exercises the production code path; the `beaconDenied` test still uses `application/json` to keep that path covered.

## 4.40.2

### Patch Changes

- 38e00cd: Tidy up the changesets configuration to cover every workspace package:
  - Add `@getmunin/analytics-tracker` to the `fixed` group so it bumps in lockstep with the rest of the publishable `@getmunin/*` suite. The package was introduced at `4.33.0` and never re-versioned, leaving downstream consumers unable to pin `^4.x` against the same range as `@getmunin/backend-core`. `apps/analytics-tracker/package.json` is manually aligned to `4.40.1` so this release moves the group together.
  - Add `@getmunin/widget-voice` to the `ignore` list. It's `private: true` and already excluded from publishing, but every other private package in the workspace is explicitly ignored — adding it here keeps the config consistent and prevents accidental version-bump noise.
