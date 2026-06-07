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

`Cache-Control: public, max-age=3600` on `tracker.js` so the CDN serves the bundle without hitting your backend per request.

### Optional data attributes

- `data-subject-type="docs"` — override the default `'page'` subject type. Useful when you have multiple surfaces sharing one tracker key.
- `data-spa="true"` — auto-track route changes in single-page apps. The script monkey-patches `history.pushState` / `replaceState` and fires a view per route transition (with a `dwell_ms` for the previous route).
- `data-api="https://api.your-munin.example"` — override the API base. Defaults to the origin the script was loaded from.

## 3. Custom events from JavaScript

For SPA route changes or arbitrary "this thing happened on the page" events, the script exposes a global:

```javascript
window.mn.track('checkout-step-2', {
  dwellMs: 12_000,
  readDepth: 80,
  metadata: { variant: 'b' },
});
```

The first argument is `subjectId`. The second is an attribute bag:
- `subjectType` — defaults to the `data-subject-type` on the script tag.
- `path`, `referrer` — defaults to the current location and the initial referrer.
- `dwellMs`, `readDepth`, `metadata` — pass through unchanged.
- `utm` — falls back to URL `?utm_*` params if not provided.

`mn.trackPageView()` is also exposed for the rare case where you want to re-fire the page view manually.

## 4. Query the data

Three admin-only MCP tools cover the questions you'll ask first:

```jsonc
// Which pages get the most traffic?
{ "name": "analytics_top_subjects",
  "arguments": { "subjectType": "page", "source": "tracker", "sinceDays": 7, "limit": 50 } }
```

Returns `[{ subjectType, subjectId, views, visitors }]` ordered by view count.

```jsonc
// How is one specific page performing?
{ "name": "analytics_subject_engagement",
  "arguments": { "subjectType": "page", "subjectId": "/pricing", "sinceDays": 30 } }
```

Returns `{ views, visitors, avgDwellMs, avgReadDepth, lastViewAt }` — combine views (volume) with dwell + depth (quality) to separate "lots of bounces" from "fewer but engaged readers."

```jsonc
// What were people searching for that we don't have content for?
{ "name": "analytics_zero_result_searches",
  "arguments": { "sinceDays": 30, "limit": 50 } }
```

Returns `[{ query, occurrences, lastSeenAt }]`. The single best signal for "what should we write next" — readers asked and Munin had nothing to show them.

For anything more bespoke (UTM-source breakdowns, custom funnels, time-series), the events sit in `analytics_view_events` and `analytics_search_events`; query them directly from a DB client. The MCP tools cover the common questions; the table covers the long tail.

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

## What NOT to do

- **Don't ship the key as `NEXT_PUBLIC_…` and pretend it's a secret.** It's public by design. Treat it like a Google Analytics measurement id — visible in the page source is normal. The org-scoped write-only authorization is the entire safety story.
- **Don't reuse the same key across orgs.** Each customer org mints its own. Cross-org leakage isn't possible because the key resolves to one `org_id`.
- **Don't rely on `dwell_ms` for anything precision-critical.** It's best-effort, fired on `pagehide`. Mobile Safari and aggressive ad-blockers can swallow the unload beacon. Use it for relative ranking, not exact dwell times.
- **Don't put PII in `subject_id` or `metadata`.** Treat them as URL-shaped and tag-shaped respectively. Anything you embed there will sit in an analytics table you'll later query without auth context.

## Related

- `skill://analytics/track-cms-views` — sibling flow for content served by Munin's CMS. Per-entry token-signed pixel + beacon, no key to mint.
- `skill://cms/review-stale-entries` — periodic curator pass that consults view data to decide whether stale published entries should be refreshed or archived.
- `skill://conv/setup-chat-widget` — sibling drop-in script (chat widget); identical key-rotation ergonomics.
