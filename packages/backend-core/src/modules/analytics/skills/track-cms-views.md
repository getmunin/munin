---
title: 'Analytics: Track CMS entry views'
description: Use the `_tracking` block that every CMS delivery response already ships to record per-entry views, keyed by stable entry id, without minting any key.
audiences: [admin]
---

# Track CMS entry views

Munin is headless — you fetch published CMS entries from the public delivery API (`/v1/cms/<orgId>/<collection>/...`) and render them in your own host (Next.js, a static export, a native app, an email template). Every delivery response already includes a `_tracking` block with a pre-signed token plus its pixel and beacon URL. Drop one into your rendered page and reads land in `analytics_view_events` keyed by `subject_type='cms_entry'` and the stable `subject_id` — independent of the URL the entry happens to live at.

Use this skill when you're rendering CMS entries and want per-entry analytics:

- Which entries get read?
- How does engagement (dwell, read-depth) compare across entries?
- Did renaming a slug, or moving an entry to a new path, change anything?

For traffic-level analytics on the host itself — homepage, landing pages, anything that isn't a CMS entry — use `skill://analytics/track-website-traffic` instead. That's a per-org `mn_track_*` key, keyed by URL path.

Run both side-by-side on CMS pages and you get two events per view: one `subject_type='page'` (URL-keyed, from the tracker bundle) and one `subject_type='cms_entry'` (id-keyed, from `_tracking`). They answer different questions — funnel vs. content engagement.

## How the `_tracking` block works

Every list and single-entry delivery response ships a `_tracking` field per item:

```jsonc
// GET /v1/cms/<orgId>/journal/my-post?locale=en
{
  "slug": "my-post",
  "locale": "en",
  "data": { /* projected fields */ },
  "version": 7,
  "publishedAt": "...",
  "updatedAt": "...",
  "_tracking": {
    "token":     "v1.<org>.cms_entry.<entryId>.<issuedAt>.<sig>",
    "pixelUrl":  "https://api.your-munin.example/v1/a/v/v1.<org>.cms_entry.<entryId>.<issuedAt>.<sig>.gif",
    "beaconUrl": "https://api.your-munin.example/v1/a/v"
  }
}
```

The token is an HMAC over `{orgId, subjectType:'cms_entry', subjectId:<entryId>, issuedAt}` signed with the backend's `MUNIN_KEY_PEPPER`. It is:

- **Bound to one entry.** No way to forge a view for an entry you didn't fetch.
- **Not time-limited.** A static export that bakes the URL at build time keeps working; the token only stops if the pepper rotates.
- **Safe to embed publicly.** It can write exactly one kind of event, for exactly one entry, in exactly one org. It cannot read events.

`_tracking` is included by default. It is omitted when:

- The backend has no `MUNIN_KEY_PEPPER` set (tokens cannot be signed).
- The caller passes `?tracking=0` (or `false`, `off`) on the request.

So if you ever see `_tracking` missing in production, check `MUNIN_KEY_PEPPER` first; only then look at query params.

## Which embed to use

| Situation | Use | You get |
|---|---|---|
| The page already loads `tracker.js` | `data-mn-entry-token` or `mn.trackEntry(token)` | `views`, `visitors`, `dwell_ms`, `read_depth` |
| No JS at all — email, RSS, plain HTML | `pixelUrl` | `views` only |

**The pixel cannot report `visitors`.** It takes no visitor parameter, so every pixel-only entry reports `visitors: 0` and raw `views` — no per-person dedupe. That isn't fixable in the pixel: the `visitor_id` lives in the browser's `localStorage`, and the obvious server-side workaround (a first-party cookie set on the pixel response) fails because the API is a different origin from your site, where ITP and third-party-cookie blocking kill it. Only JS can read the visitor id, so if the page can run the tracker, let the tracker do it.

## Tracker embed (recommended when `tracker.js` is on the page)

`tracker.js` (see `skill://analytics/track-website-traffic` for minting the key) exposes an entry-view call that carries the visitor id, a per-view `viewId`, `path` and `locale`:

```javascript
window.mn.trackEntry(entry._tracking.token);
```

For a static export or server-rendered page that ships no JS of its own, use the declarative form — the tracker fires one entry view per element on load:

```tsx
<article data-mn-entry-token={entry._tracking.token}>…</article>
```

**Put the token on the page that shows the entry, never on cards in a list.** A `cms_entry` view means "someone read this entry". Tag the cards on a journal index and every index load records a read for every entry on it, so your most-read list becomes whatever happens to sit on the homepage. This applies to the pixel too — delivery list responses ship a `_tracking` block per item, and rendering all of them has the same effect.

Want to know which cards get seen? That's a different question with a different answer: `window.mn.track(entryId, { subjectType: 'cms_entry_impression' })`, so impressions and reads stay separable at query time.

Either way the view is one row: on `visibilitychange` (hidden) and `pagehide`, and on route change, the tracker re-sends the same `viewId` with `dwellMs` and `readDepth`, which enriches that row instead of adding another. The **first 10** entry views on a page are registered for that enrichment; past 10 the view is still recorded, it just never gets dwell or read depth — the cap bounds exit-beacon fan-out on a big page, not the views themselves.

`mn.trackEntry(token, attrs?)` takes the same attribute bag as `mn.track` (`path`, `referrer`, `metadata`, `dwellMs`, `readDepth`, `viewId`).

## Pixel embed (static pages, server-rendered HTML, emails)

The no-JS fallback — works in any static export, RSC, plain HTML email, etc. The pixel returns a 1×1 transparent GIF; the act of fetching it records the view, with no visitor id (so `visitors: 0`) and no dwell or read depth.

```tsx
{entry._tracking ? (
  <img
    src={entry._tracking.pixelUrl}
    alt=""
    width={1}
    height={1}
    aria-hidden
    style={{ position: 'absolute', width: 1, height: 1, opacity: 0, pointerEvents: 'none' }}
  />
) : null}
```

Visually hidden but still requested by the browser. The view is attributed to the entry id baked into the token — slug renames, locale switches, and moving the entry under a new route are invisible to the analytics layer.

Bot user-agents and IPs over the per-IP rate limit are filtered server-side; you don't need to filter on the client.

## Beacon embed (SPAs, richer events)

For single-page apps, or anywhere you want to ship dwell time / read depth / metadata, post to `beaconUrl` instead. The shape mirrors the website-tracker beacon, with `token` in place of `key`:

```javascript
const viewId = crypto.randomUUID();
const visitorId = localStorage.getItem('mn.vid');

window.addEventListener('pagehide', () => {
  const blob = new Blob(
    [
      JSON.stringify({
        token: entry._tracking.token,
        viewId,
        visitorId,
        dwellMs: performance.now() - mountedAt,
        readDepth: computeReadDepth(),
        path: location.pathname + location.search,
        utm: parseUtm(location.search),
        metadata: { variant: 'b' },
      }),
    ],
    { type: 'application/json' },
  );
  navigator.sendBeacon(entry._tracking.beaconUrl, blob);
});
```

The beacon accepts the same `path`, `referrer`, `visitorId`, `locale`, `dwellMs`, `readDepth`, `viewId`, `utm`, `metadata` fields as the website tracker. Sending the same `viewId` twice enriches one row (fill-if-null attribution, max-wins dwell/read-depth) rather than writing two; omit it and every post is its own row.

If `tracker.js` is on the page, `mn.trackEntry` already does all of this — including reading the visitor id it shares with the chat widget under the `mn.vid` key.

## Querying entry views

The same admin-only MCP tools used for the website tracker work here — just filter on `subjectType: 'cms_entry'`:

```jsonc
// Which CMS entries got the most reads in the last week?
{
  "name": "analytics_list_top_subjects",
  "arguments": {
    "subjectType": "cms_entry",
    "source": "pixel",
    "sinceDays": 7,
    "limit": 20
  }
}
```

Returns `[{ subjectType, subjectId, views, visitors }]` — `subjectId` is the entry id. Join against `cms_entries` for slugs/titles.

```jsonc
// How is one entry performing?
{
  "name": "analytics_get_subject_engagement",
  "arguments": {
    "subjectType": "cms_entry",
    "subjectId": "<entryId>",
    "sinceDays": 30
  }
}
```

`source` distinguishes events by ingest path: `'pixel'` for the 1×1 GIF, `'beacon'` for `mn.trackEntry` and hand-rolled beacon posts. Combine both for a complete read count; segment by `source` if you care about how readers were tracked (e.g., to compare static vs. SPA hits).

## Operations

| Task | How |
|---|---|
| Disable tracking for a single response | Append `?tracking=0` to the delivery URL. `_tracking` is omitted from that response only. |
| Disable tracking server-wide | Unset `MUNIN_KEY_PEPPER`. All `_tracking` blocks drop out of every response. (You probably don't want this — the pepper also signs other things.) |
| Invalidate every outstanding pixel URL | Rotate `MUNIN_KEY_PEPPER`. All previously-signed tokens 401 on the next request. |
| Delete a reader's data | `DELETE FROM analytics_view_events WHERE visitor_id = $1`. Tokens carry no visitor identity — only what the client sends in the beacon body. |

## What NOT to do

- **Don't bake `mn_track_*` keys into a CMS-served page.** That's the website tracker's flow. CMS entries already get authenticated tracking for free via `_tracking`; using a tracker key in addition just buys you a second URL-keyed event and a key to rotate. Run both only if you want both URL-level and entry-level analytics (often you do — see top of skill).
- **Don't strip `_tracking` from your delivery client.** If you're mapping the JSON into typed objects, thread `_tracking` through. Discarding it is the single most common reason "we have no journal analytics" in cloud.
- **Don't slice the token out of `pixelUrl`.** `_tracking.token` ships the bare token; a regex over the URL breaks the moment the URL shape changes.
- **Don't reach for the pixel on a page that runs `tracker.js`.** You'd trade `visitors`, dwell and read depth for nothing.
- **Don't tag list cards with `data-mn-entry-token` (or their pixels).** `cms_entry` views answer "what got read"; firing one per card on every index load turns that into "what got listed" and quietly ranks your homepage highest. Use a separate `subjectType` for impressions.
- **Don't try to mint your own view tokens.** The signing is server-side only. If you need a token for an entity that isn't a CMS entry, add a new mint site to the delivery layer rather than reproducing the signing in client code.
- **Don't rely on the pixel URL surviving a pepper rotation.** If you bake URLs into a long-lived static export, plan to rebuild after pepper rotations. Day-to-day this is a non-issue.

## Related

- `skill://analytics/track-website-traffic` — sibling flow for traffic-level analytics on the host (URL-keyed, `mn_track_*` key, per-org origin allowlist).
- `skill://cms/publish-entry` — how entries reach the `published` state where they show up in delivery responses.
- `skill://cms/review-stale-entries` — periodic pass that consults `cms_entry` view data to decide what to refresh or archive.
