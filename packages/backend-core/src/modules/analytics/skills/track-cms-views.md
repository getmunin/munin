---
title: 'Analytics: Track CMS entry views'
description: Use the `_tracking` block that every CMS delivery response already ships to record per-entry views, keyed by stable entry id, without minting any key.
audiences: [admin]
---

# Track CMS entry views

Munin is headless — you fetch published CMS entries from the public delivery API (`/v1/cms/<orgId>/<collection>/...`) and render them in your own host (Next.js, a static export, a native app, an email template). Every delivery response already includes a `_tracking` block with a pre-signed pixel and beacon URL. Drop them into your rendered page and reads land in `analytics_view_events` keyed by `subject_type='cms_entry'` and the stable `subject_id` — independent of the URL the entry happens to live at.

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

## Pixel embed (static pages, server-rendered HTML, emails)

The simplest integration — works in any static export, RSC, plain HTML email, etc. The pixel returns a 1×1 transparent GIF; the act of fetching it records the view.

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
window.addEventListener('pagehide', () => {
  const blob = new Blob(
    [
      JSON.stringify({
        token: entry._tracking.pixelUrl.split('/').at(-1).replace(/\.gif$/, ''),
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

Or pass the bare token through your component props instead of slicing it out of the URL — same effect, easier to read.

The beacon accepts the same `path`, `referrer`, `visitorId`, `locale`, `dwellMs`, `readDepth`, `utm`, `metadata` fields as the website tracker.

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

`source` distinguishes events by ingest path: `'pixel'` for the 1×1 GIF, `'beacon'` for the SPA beacon. Combine both for a complete read count; segment by `source` if you care about how readers were tracked (e.g., to compare static vs. SPA hits).

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
- **Don't try to mint your own view tokens.** The signing is server-side only. If you need a token for an entity that isn't a CMS entry, add a new mint site to the delivery layer rather than reproducing the signing in client code.
- **Don't rely on the pixel URL surviving a pepper rotation.** If you bake URLs into a long-lived static export, plan to rebuild after pepper rotations. Day-to-day this is a non-issue.

## Related

- `skill://analytics/track-website-traffic` — sibling flow for traffic-level analytics on the host (URL-keyed, `mn_track_*` key, per-org origin allowlist).
- `skill://cms/publish-entry` — how entries reach the `published` state where they show up in delivery responses.
- `skill://cms/review-stale-entries` — periodic pass that consults `cms_entry` view data to decide what to refresh or archive.
