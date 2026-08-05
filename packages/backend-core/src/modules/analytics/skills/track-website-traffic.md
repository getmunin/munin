---
title: Analytics: Track website traffic
description: Mint a public `mn_track_*` API key, drop the one-line tracker script into your site, and query view events to understand what readers engage with.
audiences: [admin]
---

# Track website traffic

Add page-view tracking to a landing page, marketing site, docs site, or app shell. The integration is one line of HTML — same ergonomics as the chat widget. Events land in `analytics_view_events` keyed by `subject_type='page'` and a `subject_id` you control (typically the URL path).

Use this when you want to answer questions like:
- Which pages do readers actually spend time on?
- Where is traffic coming from (referrer, UTM)?
- What's the difference between the 100 readers who bounce and the 10 who scroll all the way?

For tracking individual CMS entries you fetch from Munin's delivery API and render in your own host, see `skill://analytics/track-cms-views` instead — every entry response ships a pre-signed `_tracking` block, no key minting needed, events are keyed by stable entry id. Use *this* skill for traffic-level analytics on the host (homepage, landing pages, anything that isn't a CMS entry) — URL-keyed events from the tracker bundle.

## 1. Mint a tracker key

```jsonc
{
  "name": "analytics_create_tracker",
  "arguments": {
    "name": "example.com landing",
    "allowedOrigins": ["https://example.com"]
  }
}
```

Response includes `trackerKey: "mn_track_…"` — shown once. The key is **public** — safe to embed in HTML, mobile clients, anything browsers can see. It can only write view events scoped to your org, never read them.

**`allowedOrigins`** is required — the ingest endpoints reject any request whose `Origin` header doesn't match one of the listed full origins (scheme + host + port, exact match — no wildcards or path prefixes). Multi-environment? List each one (`https://example.com`, `https://dev.example.com`, `http://localhost:3000`).

The `Origin` header is browser-set and trivially spoofable via curl — origin allowlisting stops casual JS-from-another-site abuse but is not a security boundary on its own. The real defences are key rotation (`analytics_revoke_tracker`) and per-IP rate-limiting at the ingest layer.

Edit later with `analytics_update_tracker({trackerId, allowedOrigins})`. Rotate with `analytics_revoke_tracker` + a fresh `analytics_create_tracker`. List with `analytics_list_trackers`.

## 2. Drop the script tag

```html
<script async
  src="https://api.your-munin.example/tracker.js"
  data-key="mn_track_…">
</script>
```

That's it. The script auto-fires a page view on `DOMContentLoaded` and writes **one** row to `analytics_view_events` with:

- `subject_type='page'`, `subject_id=<location.pathname>`
- `path=<location.pathname + location.search>`
- `referrer=<document.referrer>` (initial entry only)
- `visitor_id=<random uuid stored in localStorage>`
- `utm_source` / `utm_medium` / `utm_campaign` (parsed from `?utm_*` query params)
- `locale=<html lang>`
- `source='tracker'`
- `dwell_ms` — time the page was *visible*, added when it's hidden or unloaded
- `read_depth` — the deepest 25/50/75/100 scroll milestone reached, added on the same exit beacon
- `country` — ISO 3166-1 alpha-2 derived server-side from the client IP via a local MaxMind-format GeoIP DB. Only populated when `MUNIN_GEOIP_DB_PATH` points at a valid `.mmdb` file (e.g. `GeoLite2-Country.mmdb` or DB-IP-Lite); otherwise stays NULL. The IP is consumed only at lookup time and is never persisted.

`Cache-Control: public, max-age=3600` on `tracker.js` so the CDN serves the bundle without hitting your backend per request.

### One row per page view

The tracker mints a `viewId` (uuid) per page view and sends it on both the initial view and the exit beacon; ingest upserts on `(org_id, client_view_id)`. So dwell time and read depth *enrich the existing row* instead of adding a second one — `views` counts page views, not beacons.

A fresh `viewId` is minted for each SPA route change and each bfcache restore (`pageshow` with `persisted: true`), since both start a new dwell clock. Enrichment is fill-if-null for attribution (`referrer`, `utm_*`, `path`, `locale`, `country`, `metadata`) and max-wins for `dwell_ms` / `read_depth`, so out-of-order beacons — `sendBeacon` guarantees no ordering — can't overwrite the real referrer.

Calls you make yourself (`mn.track`, `mn.trackOnce`, declarative events) carry no `viewId` and always insert their own row.

> **Deploy seam:** before this landed, every page load wrote ≥2 rows (one per beacon). Tracker-sourced `views` therefore drops roughly 50% on the day you upgrade, and `visitors` is unchanged. History is not repairable — old rows carry no `viewId` — so don't compare `views` across the upgrade date.

### What you get without configuring anything

- **Read depth.** Passive `scroll` + `resize` listeners, rAF-throttled, tracking the deepest 25/50/75/100 milestone reached; a page that fits the viewport reports 100. Sent on the exit beacon, so it costs no extra row. Surfaces as `avgReadDepth` in `analytics_get_subject_engagement`.
- **Exit reporting on two triggers.** Dwell and read depth are sent on `visibilitychange` → hidden *and* on `pagehide`. A `pagehide`-only beacon is the classic reason engagement data is sparse — mobile app-switch and tab-kill often fire only `visibilitychange` — and reporting on both is free here because enrichment is idempotent: same `viewId`, and `dwell_ms` / `read_depth` are max-wins server-side. The usual hidden-then-`pagehide` pair sends once; a reader who returns and leaves again reports a second, larger value. `dwell_ms` accumulates visible time only, so that second report adds the time they actually came back for, not the hours the tab sat in the background.
- **Route changes.** The script patches `history.pushState` / `replaceState` and listens for `popstate`, closing the previous view (dwell + read depth) and opening a new one per route transition. Changes that don't change `location.pathname` are ignored, so query-param filter and tab state costs nothing — which is why this needs no SPA flag: a classic multi-page site never triggers it.
- **Canonical subject ids.** See below.

### Optional data attributes

- `data-subject-type="docs"` — override the default `'page'` subject type. Useful when you have multiple surfaces sharing one tracker key.
- `data-api="https://api.your-munin.example"` — override the API base. Defaults to the origin the script was loaded from.

### Declarative events — no JS file needed

Any element with `data-mn-event` fires a view event when clicked (one delegated capture-phase listener, so it works for elements added later):

```html
<button
  data-mn-event="signup-cta-click"
  data-mn-subject-type="funnel"
  data-mn-metadata='{"plan":"pro"}'
  data-mn-once="session"
>Start free</button>
```

- `data-mn-event` — the `subject_id`. Required.
- `data-mn-subject-type` — defaults to `'event'`. Use `'funnel'` for steps you want to feed `analytics_get_funnel`.
- `data-mn-metadata` — a JSON **object**; anything else is dropped with a console warning rather than sent. This is the zero-JS way to populate `metadata`.
- `data-mn-once` — fire at most once per browser session (sessionStorage-guarded). For funnel steps that would otherwise re-fire on every navigation.

### Canonical subject ids (automatic)

`subject_id` is `location.pathname`, which on a localized site would report `/en/pricing` and `/nb/pricing` as two different pages, and split the homepage in two the moment `/` redirects to `/en/`. Ingest folds both cases with no configuration:

- **Trailing slashes** are always dropped: `/pricing/` → `/pricing`.
- **A leading locale segment** is dropped when it matches the locale the page itself reports (`<html lang>`, which every beacon already carries): `/en/pricing` on a page declaring `lang="en-US"` → `/pricing`; `/en/` → `/`. The match is exact against the full tag or its language subtag, so `/enterprise/pricing` and `/uk/pricing` (on `lang="en-GB"`) are left alone.

Ids that don't start with `/` — declarative events, funnel steps, entity ids — are never rewritten, and the raw URL is always preserved in `path`, so nothing is lost.

Two cases the inference can't cover: pages that set no `lang` at all, and a URL prefix that disagrees with the tag — `/no/priser` on pages declaring `lang="nb-NO"` is the classic one. Name those prefixes explicitly:

```jsonc
{ "name": "analytics_update_tracker",
  "arguments": { "trackerId": "atr_…", "canonicalLocales": ["no"] } }
```

It applies from the next event with no site redeploy — which is why this lives on the tracker rather than in your markup. Past rows keep the ids they were written with.

## 3. Custom events from JavaScript

`mn.track(subjectId, attrs?)` records anything beyond an auto-fired page view — funnel steps, CTA clicks, modal opens, SPA route changes. Same row schema as a page view (`analytics_view_events`); each call inherits `visitorId`, the script tag's key, and the initial referrer, so attribution stays consistent without you passing it every time.

The first argument is `subjectId`, the second an optional attribute bag:
- `subjectType` — defaults to `data-subject-type` on the script tag (typically `'page'`). Override per call if a single tracker handles multiple surfaces (e.g. `'funnel'`, `'cta'`, `'docs'`).
- `path`, `referrer` — default to the current location and the initial document referrer; pass to override.
- `dwellMs`, `readDepth`, `metadata` — pass through unchanged.
- `utm` — falls back to URL `?utm_*` params if not provided.

The full API on `window.mn`:

| Call | What it does |
|---|---|
| `mn.track(subjectId, attrs?)` | One view event. |
| `mn.trackOnce(subjectId, attrs?)` | Same, but at most once per browser session (sessionStorage-guarded) — the JS twin of `data-mn-once`. |
| `mn.trackPageView()` | Re-fire the auto page view, minting a fresh `viewId`. |
| `mn.trackSearch(query, resultCount, opts?)` | A search event (see below). |
| `mn.trackEntry(token, attrs?)` | A CMS entry view — see `skill://analytics/track-cms-views`. |
| `mn.getVisitorId()` | The `visitor_id` this browser is sending. |
| `mn.identify(externalId, userHash)` | Link the visitor to a known user — see `skill://analytics/identify-visitors`. |

## 3b. Search events from any search box

`analytics_list_zero_result_searches` is the best "what should we write next" signal you have, but it only sees searches Munin itself ran (the CMS delivery `/search` endpoint). If your site search is Pagefind, Algolia, Typesense, or hand-rolled, report it yourself:

```javascript
const hits = await mySearch(query);
window.mn.trackSearch(query, hits.length);
```

Writes to `analytics_search_events` with `subject_type='site'` (override with `opts.subjectType`, e.g. `'docs'`), the visitor's `visitor_id`, and `locale` from `<html lang>` unless you pass `opts.locale`. Fire it once per completed search — debounce keystrokes on your side, or the zero-result list fills with prefixes of real queries.

Server-side or non-JS callers can post the same thing directly:

```bash
curl -X POST https://api.your-munin.example/v1/a/s \
  -H "Content-Type: application/json" \
  -d '{"key":"mn_track_…","query":"refund policy","resultCount":0,"subjectType":"docs"}'
```

Same tracker key, same origin allowlist, same bot filter and per-IP throttle as `/v1/a/t`.

### Patterns

**Funnel step** — instrument a multi-step flow so you can compute conversion in `analytics_get_subject_engagement` or a custom query. Clicks need no JS at all (`data-mn-event="signup-cta-click" data-mn-subject-type="funnel"`); use the API for steps that aren't clicks:

```javascript
window.mn.trackOnce('checkout-step-2-reached', {
  subjectType: 'funnel',
  metadata: { cartValue: 49 },
});

window.mn.track('checkout-complete', {
  subjectType: 'funnel',
  metadata: { orderId: 'ord_abc', amount: 49 },
});
```

`trackOnce` for "reached this step" milestones — a plain `track` re-fires every time the component remounts, which inflates the step and flattens the funnel. Use `track` for genuinely repeatable actions like a completed checkout.

Then compute true *ordered* drop-off with `analytics_get_funnel` — it counts distinct visitors who reached each step in sequence, not just raw per-step volumes:

```jsonc
{ "name": "analytics_get_funnel",
  "arguments": {
    "steps": [
      { "subjectType": "funnel", "subjectId": "signup-cta-click" },
      { "subjectType": "funnel", "subjectId": "checkout-step-2-reached" },
      { "subjectType": "funnel", "subjectId": "checkout-complete" }
    ],
    "sinceDays": 7,
    "stepWindowHours": 24
  } }
```

`analytics_list_top_subjects({ subjectType: 'funnel' })` still gives the raw per-step counts if you only want volumes.

**SPA route change with dwell** — handled automatically for any router that goes through `history.pushState` / `replaceState` / `popstate`. If yours doesn't, do it manually — pass the same `viewId` to the pair of calls so the second enriches the first instead of adding a row:

```javascript
let routeEnter = Date.now();
let lastRoute = location.pathname;
let viewId = crypto.randomUUID();
router.afterEach((to) => {
  window.mn.track(lastRoute, {
    viewId,
    dwellMs: Date.now() - routeEnter,
    referrer: null,
  });
  routeEnter = Date.now();
  lastRoute = to.path;
  viewId = crypto.randomUUID();
  window.mn.track(to.path, { viewId, referrer: null });
});
```

**Scroll milestones** — already handled: the bundle reports the deepest milestone once, on the exit beacon, enriching the page-view row. Don't hand-roll one event per milestone: that's up to four extra rows per page load, and it inflates `views`.

For a bespoke measure (words read, video watched, a custom "engaged" heuristic), pass your own number and it lands in the same column:

```javascript
window.mn.track(location.pathname, { readDepth: myOwnScore(), subjectType: 'page' });
```

## 4. Query the data

Four admin-only MCP tools cover the questions you'll ask first:

```jsonc
// Which pages get the most traffic?
{ "name": "analytics_list_top_subjects",
  "arguments": { "subjectType": "page", "source": "tracker", "sinceDays": 7, "limit": 50 } }
```

Returns `[{ subjectType, subjectId, views, visitors }]` ordered by view count.

```jsonc
// How is one specific page performing?
{ "name": "analytics_get_subject_engagement",
  "arguments": { "subjectType": "page", "subjectId": "/pricing", "sinceDays": 30 } }
```

Returns `{ views, visitors, avgDwellMs, avgReadDepth, lastViewAt }` — combine views (volume) with dwell + depth (quality) to separate "lots of bounces" from "fewer but engaged readers."

```jsonc
// What were people searching for that we don't have content for?
{ "name": "analytics_list_zero_result_searches",
  "arguments": { "sinceDays": 30, "limit": 50 } }
```

Returns `[{ query, occurrences, lastSeenAt }]`. The single best signal for "what should we write next" — readers asked and nothing came back. It covers Munin's own CMS delivery search plus anything you report through `mn.trackSearch` / `POST /v1/a/s`; if your site search never reports, this list is empty no matter how much searching happens.

```jsonc
// Where are visitors coming from? (requires MUNIN_GEOIP_DB_PATH set; otherwise everything rolls into `country: null`)
{ "name": "analytics_list_top_countries",
  "arguments": { "subjectType": "page", "source": "tracker", "sinceDays": 30, "limit": 50 } }
```

Returns `[{ country, views, visitors }]`. A row with `country: null` is the unknown bucket — bot IPs filtered upstream don't reach here; this is private/unmappable IPs (loopback, link-local, ranges absent from the mmdb).

```jsonc
// Which campaigns/channels drive traffic?
{ "name": "analytics_list_traffic_sources",
  "arguments": { "subjectType": "page", "sinceDays": 30, "limit": 50 } }
```

Returns `[{ utmSource, utmMedium, utmCampaign, views, visitors }]`. The row with all three NULL is the "direct/organic" bucket — visits with no UTM params. Compare named-campaign rows against the direct bucket to gauge campaign lift.

```jsonc
// Which external sites send us traffic?
{ "name": "analytics_list_referrer_hosts",
  "arguments": { "excludeHost": "example.com", "sinceDays": 30, "limit": 50 } }
```

Returns `[{ host, views, visitors }]`. Pass `excludeHost` set to your production host to filter out internal navigations; the `host: null` row is direct/bookmark traffic and `rel=noreferrer` clicks.

```jsonc
// Daily traffic trend — spot weekly patterns, campaign spikes, content launch lift.
{ "name": "analytics_get_views_over_time",
  "arguments": { "subjectType": "page", "sinceDays": 30 } }
```

Returns `[{ day: '2026-05-09', views, visitors }, …]` zero-filled per UTC day, oldest first. Pin to a single page by passing `subjectId`.

```jsonc
// Where do people drop off in a multi-step flow?
{ "name": "analytics_get_funnel",
  "arguments": {
    "steps": [
      { "subjectType": "page", "subjectId": "/pricing" },
      { "subjectType": "page", "subjectId": "/signup" },
      { "pathLike": "/onboarding/%" }
    ],
    "sinceDays": 30 } }
```

Returns per-step `{ index, label, actors, conversionFromPrev, dropFromPrev, conversionFromStart }` plus `overallConversion`. Steps are strictly ordered — a visitor counts at a step only if they reached it *after* the previous one. Each step matches by `subjectType`/`subjectId` and/or a `pathLike` SQL `LIKE` pattern. Visitors are grouped by their identified end-user when known (else the anonymous `visitor_id`), so the anonymous → identified transition isn't double-counted. Add `stepWindowHours` to require each step within a time budget of the previous.

For anything more bespoke (multi-dimension cohorts, session-windowed paths), the events sit in `analytics_view_events` and `analytics_search_events`; query them directly from a DB client. The MCP tools cover the common questions; the table covers the long tail.

## 5. Server-side / SDK ingestion

For surfaces that can't run JS (server-rendered emails, mobile native, IoT), call the beacon endpoint directly:

```bash
curl -X POST https://api.your-munin.example/v1/a/t \
  -H "Content-Type: application/json" \
  -d '{
    "key": "mn_track_…",
    "subjectType": "page",
    "subjectId": "/pricing",
    "referrer": "https://news.ycombinator.com/",
    "visitorId": "v-xyz",
    "utm": { "source": "hn" }
  }'
```

Or for a 1×1 pixel embedded in HTML emails / image tags:

```html
<img src="https://api.your-munin.example/v1/a/t/mn_track_…?s=/pricing&v=v-xyz" alt="" width="1" height="1">
```

The pixel path takes `s` (subjectId, required), `t` (subjectType, defaults to `'page'`), `v` (visitorId, optional). Both routes filter known bot user-agents and rate-limit per IP.

The beacon also accepts `viewId` — send the same value twice to enrich one row (e.g. an initial call plus a later `dwellMs`) instead of writing two. It is a per-view dedup key, not portable identity: mint a fresh uuid per view and never reuse one across visitors. Omit it and every call inserts its own row, exactly as before.

## 6. Operations

| Task | How |
|---|---|
| Rotate a key | `analytics_revoke_tracker({trackerId})` then `analytics_create_tracker({name})`. Old key 401s immediately. |
| Audit which keys exist | `analytics_list_trackers({})`. Returns id, name, prefix, last-used, revoked-at. |
| Disable a single page from tracking | Remove the script tag from that page. The script is per-page-load opt-in. |
| Delete a visitor's data | `DELETE FROM analytics_view_events WHERE visitor_id = $1`. No PII is stored beyond the random uuid — but if a regulator-grade deletion is needed, this is the path. |
| Fold a locale prefix the page's `lang` doesn't match | `analytics_update_tracker({trackerId, canonicalLocales: ["no"]})`. Applies from the next event; no redeploy. Matching prefixes are already folded automatically. |
| Enable country resolution | Set `MUNIN_GEOIP_DB_PATH=/abs/path/to/GeoLite2-Country.mmdb` (or any MaxMind-format country DB) on the backend before starting. The reader memory-maps the file once at boot; no network calls per request. Disable by unsetting and restarting — the column simply stays NULL for new rows. |

## What NOT to do

- **Don't ship the key as `NEXT_PUBLIC_…` and pretend it's a secret.** It's public by design. Treat it like a Google Analytics measurement id — visible in the page source is normal. The org-scoped write-only authorization is the entire safety story.
- **Don't reuse the same key across orgs.** Each customer org mints its own. Cross-org leakage isn't possible because the key resolves to one `org_id`.
- **Don't rely on `dwell_ms` for anything precision-critical.** It's best-effort. Reporting on both `visibilitychange` and `pagehide` catches far more exits than unload alone, but ad-blockers and hard kills still swallow beacons, which leaves the row with `dwell_ms = NULL` (the view itself still counts). It counts only the time the page was visible — a tab backgrounded for an hour contributes nothing — so it approximates attention rather than elapsed time, but a page left open and stared past still counts. Use it for relative ranking, not exact dwell times.
- **Don't reuse one `viewId` across page views, and don't send it on custom events.** It is an ingest dedup key: a second event carrying an existing `viewId` enriches that row instead of creating its own, so a shared id silently collapses distinct events into one. The bundle handles this for you — this only matters if you post to `/v1/a/t` yourself.
- **Don't fire one event per scroll milestone.** The bundle reports the deepest milestone once, on exit. Four events per page load is four rows, and `views` becomes meaningless.
- **Don't put PII in `subject_id` or `metadata`.** Treat them as URL-shaped and tag-shaped respectively. Anything you embed there will sit in an analytics table you'll later query without auth context.

## Related

- `skill://analytics/track-cms-views` — sibling flow for content served by Munin's CMS. Per-entry token-signed pixel + beacon, no key to mint.
- `skill://cms/review-stale-entries` — periodic curator pass that consults view data to decide whether stale published entries should be refreshed or archived.
- `skill://conv/setup-chat-widget` — sibling drop-in script (chat widget); identical key-rotation ergonomics.
