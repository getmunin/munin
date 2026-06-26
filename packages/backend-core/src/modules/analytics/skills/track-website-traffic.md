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
    "name": "getmunin.com landing",
    "allowedOrigins": ["https://getmunin.com"]
  }
}
```

Response includes `trackerKey: "mn_track_…"` — shown once. The key is **public** — safe to embed in HTML, mobile clients, anything browsers can see. It can only write view events scoped to your org, never read them.

**`allowedOrigins`** is required — the ingest endpoints reject any request whose `Origin` header doesn't match one of the listed full origins (scheme + host + port, exact match — no wildcards or path prefixes). Multi-environment? List each one (`https://getmunin.com`, `https://dev.getmunin.com`, `http://localhost:3000`).

The `Origin` header is browser-set and trivially spoofable via curl — origin allowlisting stops casual JS-from-another-site abuse but is not a security boundary on its own. The real defences are key rotation (`analytics_revoke_tracker`) and per-IP rate-limiting at the ingest layer.

Edit later with `analytics_update_tracker({trackerId, allowedOrigins})`. Rotate with `analytics_revoke_tracker` + a fresh `analytics_create_tracker`. List with `analytics_list_trackers`.

## 2. Drop the script tag

```html
<script async
  src="https://api.your-munin.example/tracker.js"
  data-key="mn_track_…">
</script>
```

That's it. The script auto-fires a page view on `DOMContentLoaded` and writes a row to `analytics_view_events` with:

- `subject_type='page'`, `subject_id=<location.pathname>`
- `path=<location.pathname + location.search>`
- `referrer=<document.referrer>` (initial entry only)
- `visitor_id=<random uuid stored in localStorage>`
- `utm_source` / `utm_medium` / `utm_campaign` (parsed from `?utm_*` query params)
- `locale=<html lang>`
- `source='tracker'`
- `dwell_ms` (best-effort, fired on `pagehide`)
- `country` — ISO 3166-1 alpha-2 derived server-side from the client IP via a local MaxMind-format GeoIP DB. Only populated when `MUNIN_GEOIP_DB_PATH` points at a valid `.mmdb` file (e.g. `GeoLite2-Country.mmdb` or DB-IP-Lite); otherwise stays NULL. The IP is consumed only at lookup time and is never persisted.

`Cache-Control: public, max-age=3600` on `tracker.js` so the CDN serves the bundle without hitting your backend per request.

### Optional data attributes

- `data-subject-type="docs"` — override the default `'page'` subject type. Useful when you have multiple surfaces sharing one tracker key.
- `data-spa="true"` — auto-track route changes in single-page apps. The script monkey-patches `history.pushState` / `replaceState` and fires a view per route transition (with a `dwell_ms` for the previous route).
- `data-api="https://api.your-munin.example"` — override the API base. Defaults to the origin the script was loaded from.

## 3. Custom events from JavaScript

`mn.track(subjectId, attrs?)` records anything beyond an auto-fired page view — funnel steps, CTA clicks, modal opens, SPA route changes. Same row schema as a page view (`analytics_view_events`); each call inherits `visitorId`, the script tag's key, and the initial referrer, so attribution stays consistent without you passing it every time.

The first argument is `subjectId`, the second an optional attribute bag:
- `subjectType` — defaults to `data-subject-type` on the script tag (typically `'page'`). Override per call if a single tracker handles multiple surfaces (e.g. `'funnel'`, `'cta'`, `'docs'`).
- `path`, `referrer` — default to the current location and the initial document referrer; pass to override.
- `dwellMs`, `readDepth`, `metadata` — pass through unchanged.
- `utm` — falls back to URL `?utm_*` params if not provided.

### Patterns

**Funnel step** — instrument a multi-step flow so you can compute conversion in `analytics_get_subject_engagement` or a custom query:

```javascript
document.querySelector('#signup-cta').addEventListener('click', () => {
  window.mn.track('signup-cta-click', { subjectType: 'funnel' });
});

window.mn.track('checkout-step-2-reached', {
  subjectType: 'funnel',
  metadata: { cartValue: 49 },
});

window.mn.track('checkout-complete', {
  subjectType: 'funnel',
  metadata: { orderId: 'ord_abc', amount: 49 },
});
```

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

**SPA route change with dwell** — if you're not using `data-spa="true"` (or want manual control), fire `mn.track` on route transitions with the previous-route dwell:

```javascript
let routeEnter = Date.now();
let lastRoute = location.pathname;
router.afterEach((to) => {
  window.mn.track(lastRoute, {
    dwellMs: Date.now() - routeEnter,
    referrer: null,
  });
  routeEnter = Date.now();
  lastRoute = to.path;
  window.mn.track(to.path);
});
```

**Scroll milestones** — measure read depth on long-form content:

```javascript
['25', '50', '75', '100'].forEach((pct) => {
  observeScrollPercent(Number(pct), () => {
    window.mn.track(location.pathname, {
      readDepth: Number(pct),
      subjectType: 'page',
    });
  });
});
```

`mn.trackPageView()` is also exposed for the rare case where you want to re-fire the auto page view manually (e.g. after a soft route reload).

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

Returns `[{ query, occurrences, lastSeenAt }]`. The single best signal for "what should we write next" — readers asked and Munin had nothing to show them.

```jsonc
// Where are visitors coming from? (requires MUNIN_GEOIP_DB_PATH set; otherwise everything rolls into `country: null`)
{ "name": "analytics_list_top_countries",
  "arguments": { "subjectType": "page", "source": "tracker", "sinceDays": 30, "limit": 50 } }
```

Returns `[{ country, views, visitors }]`. A row with `country: null` is the unknown bucket — bot IPs filtered upstream don't reach here; this is private/unmappable IPs (loopback, link-local, ranges absent from the mmdb).

```jsonc
// Which campaigns/channels drive traffic?
{ "name": "analytics_get_traffic_by_source",
  "arguments": { "subjectType": "page", "sinceDays": 30, "limit": 50 } }
```

Returns `[{ utmSource, utmMedium, utmCampaign, views, visitors }]`. The row with all three NULL is the "direct/organic" bucket — visits with no UTM params. Compare named-campaign rows against the direct bucket to gauge campaign lift.

```jsonc
// Which external sites send us traffic?
{ "name": "analytics_list_referrer_hosts",
  "arguments": { "excludeHost": "getmunin.com", "sinceDays": 30, "limit": 50 } }
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

## 6. Operations

| Task | How |
|---|---|
| Rotate a key | `analytics_revoke_tracker({trackerId})` then `analytics_create_tracker({name})`. Old key 401s immediately. |
| Audit which keys exist | `analytics_list_trackers({})`. Returns id, name, prefix, last-used, revoked-at. |
| Disable a single page from tracking | Remove the script tag from that page. The script is per-page-load opt-in. |
| Delete a visitor's data | `DELETE FROM analytics_view_events WHERE visitor_id = $1`. No PII is stored beyond the random uuid — but if a regulator-grade deletion is needed, this is the path. |
| Enable country resolution | Set `MUNIN_GEOIP_DB_PATH=/abs/path/to/GeoLite2-Country.mmdb` (or any MaxMind-format country DB) on the backend before starting. The reader memory-maps the file once at boot; no network calls per request. Disable by unsetting and restarting — the column simply stays NULL for new rows. |

## What NOT to do

- **Don't ship the key as `NEXT_PUBLIC_…` and pretend it's a secret.** It's public by design. Treat it like a Google Analytics measurement id — visible in the page source is normal. The org-scoped write-only authorization is the entire safety story.
- **Don't reuse the same key across orgs.** Each customer org mints its own. Cross-org leakage isn't possible because the key resolves to one `org_id`.
- **Don't rely on `dwell_ms` for anything precision-critical.** It's best-effort, fired on `pagehide`. Mobile Safari and aggressive ad-blockers can swallow the unload beacon. Use it for relative ranking, not exact dwell times.
- **Don't put PII in `subject_id` or `metadata`.** Treat them as URL-shaped and tag-shaped respectively. Anything you embed there will sit in an analytics table you'll later query without auth context.

## Related

- `skill://analytics/track-cms-views` — sibling flow for content served by Munin's CMS. Per-entry token-signed pixel + beacon, no key to mint.
- `skill://cms/review-stale-entries` — periodic curator pass that consults view data to decide whether stale published entries should be refreshed or archived.
- `skill://conv/setup-chat-widget` — sibling drop-in script (chat widget); identical key-rotation ergonomics.
