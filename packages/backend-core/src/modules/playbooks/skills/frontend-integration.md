---
title: Playbook: Frontend integration (Conv widget + Analytics + CMS)
description: Wire a freshly-scaffolded frontend (Lovable, Bolt, Replit, v0, Cursor, Claude Code, …) to a Munin tenant — chat widget, page-view tracker, and live CMS content — without rediscovering the same five gotchas every time.
audiences: [admin]
---

# Frontend integration (Conv widget + Analytics + CMS)

You're a coding agent setting up a frontend that talks to an existing Munin tenant: chat widget bubble, page-view tracker, and live blog/article content from the CMS. Every Munin-shaped surface in the page collapses into one of three integrations:

- **Chat widget** — drop-in `<script>` from `{{API_URL}}/widget.js`. Adds the bubble UI.
- **Analytics tracker** — drop-in `<script>` from `{{API_URL}}/tracker.js`. Records page views.
- **CMS delivery** — anonymous `GET {{API_URL}}/v1/cms/{{ORG_ID}}/{collectionSlug}` JSON for live content.

Each has a sibling skill with the canonical details:
- `skill://conv/setup-chat-widget`
- `skill://analytics/track-website-traffic`
- `skill://cms/migrate-content` (for authoring content; this playbook is about *fetching* it)

This playbook exists because coding-agent platforms (Lovable, Bolt, Replit, v0, Claude Code, Cursor, …) hit the same handful of misconfigurations every time. Read this once before scaffolding so you don't burn three turns guessing.

## Before you start — `API_URL`, org id, and preview origin(s)

You can mint widget keys and tracker keys yourself via MCP. `API_URL` and your org id are already known — only the preview origin must come from the operator.

### 1. `API_URL` — the Munin API origin

The same origin serves `/widget.js`, `/tracker.js`, `/v1/cms/*`, and `/mcp`. **The MCP server has already told you this value** — it's stated in the server instructions you received on connect, and every `{{API_URL}}` in this playbook has been substituted with it. Use it as-is; do not ask the operator and do not guess (the cloud default `https://api.getmunin.com` is only correct for cloud tenants — self-host and OSS dev differ).

If for some reason the value is still the literal `{{API_URL}}` (an old client that doesn't substitute), fall back to the operator's env (`MUNIN_API_URL`, `NEXT_PUBLIC_API_URL`, `VITE_API_URL`, `API_URL`) and only ask as a last resort.

**Write it into the frontend's env file** under the name the framework reads at build time, not hardcoded into source. Conventions by framework:

| Framework | Env var name | Read in code as |
|---|---|---|
| Next.js | `NEXT_PUBLIC_API_URL` | `process.env.NEXT_PUBLIC_API_URL` |
| Vite (React/Vue/Svelte) | `VITE_API_URL` | `import.meta.env.VITE_API_URL` |
| Remix / React Router | `API_URL` (server) + loader-pass to client | `process.env.API_URL` server-side |
| Astro | `PUBLIC_API_URL` | `import.meta.env.PUBLIC_API_URL` |
| Node / SvelteKit server | `API_URL` | `process.env.API_URL` |

Fail loudly at startup if the var is unset. Do not provide a fallback default — silent fallbacks hide misconfiguration.

### 2. Preview + production origins

For the widget and tracker allowlists below: the full origin(s) the running frontend will be served from. Coding-agent platforms generate subdomains like `https://*.lovable.app`, `https://*.lovableproject.com`, `https://*.replit.dev`, `https://*.vercel.app`, `https://*.netlify.app`. Ask the operator for the current preview URL and copy the origin **exactly** (scheme + host, no path, no wildcards — allowlists do exact-match comparison).

Also ask for the **production origin** so you can list both up front. Adding more later is one MCP call (`conv_widget_update_channel` / `analytics_update_tracker`) but you'll save a round-trip by getting them now.

If the operator already minted keys, ask for those instead and skip the create steps — they may have provisioned the channel for a different reason.

## Step 1 — chat widget

### 1a. Create the channel + mint a key

```jsonc
{
  "name": "conv_widget_create_channel",
  "arguments": {
    "name": "<customer site name>",
    "originAllowlist": [
      "https://abc123.lovable.app",
      "https://app.customer.example"
    ]
  }
}
```

Response includes `channelId` and `widgetKey: "mn_widget_…"`. Both go into the script tag — neither is secret (the widget key is meant to be in browser source); the origin allowlist is the security boundary, not the key.

`originAllowlist` is a list of **full origins** (scheme + host + port). No wildcards, no paths. `https://customer.example` and `https://customer.example/app` are not the same; `https://customer.example` and `http://customer.example` are not the same. Match the browser's `Origin` header exactly.

**Empty-allowlist behavior depends on `MUNIN_WIDGET_REQUIRE_ALLOWLIST`:**

- **OSS dev / not set / `0` / `false`** (the default) — empty `originAllowlist` accepts requests from **any** origin. Fine for local development and getting a preview running quickly; **not safe for production**.
- **`MUNIN_WIDGET_REQUIRE_ALLOWLIST=1`** (recommended for cloud / production) — empty allowlist fails closed: ingest returns `403 origin_allowlist_required` until at least one origin is configured.

If you don't have the preview URL yet, creating the channel with `originAllowlist: []` will work *in OSS dev* — but populate it as soon as you know the origin, both so the smoke test exercises the real path and so the channel is safe to promote to prod without changes.

### 1b. Embed the script

Read `API_URL` from env at render/build time and inject it into both the `src` and `data-munin-host` attributes. Example (Vite/React):

```tsx
const API_URL = import.meta.env.VITE_API_URL;

<script async
  src={`${API_URL}/widget.js`}
  data-munin-host={API_URL}
  data-widget-key="mn_widget_…"
  data-channel-id="cch_…"
/>
```

Plain HTML form (after string-substituting `API_URL` from env at build time):

```html
<script async
  src="{{API_URL}}/widget.js"
  data-munin-host="{{API_URL}}"
  data-widget-key="mn_widget_…"
  data-channel-id="cch_…">
</script>
```

All three `data-*` attributes are required. The script tag's `src` and the `data-munin-host` value should normally be the same origin.

Optional attributes (greeting text, theme color, identified-user HMAC, visitor metadata) are documented in `skill://conv/setup-chat-widget`. Don't add them unless the operator asked.

### 1c. SPA route changes

The widget itself doesn't care about route changes — it's a fixed-position bubble that overlays the page. Nothing extra to wire.

## Step 2 — analytics tracker

### 2a. Mint a tracker key

```jsonc
{
  "name": "analytics_create_tracker",
  "arguments": {
    "name": "<customer site name>",
    "allowedOrigins": [
      "https://abc123.lovable.app",
      "https://app.customer.example"
    ]
  }
}
```

Response includes `trackerKey: "mn_track_…"` (shown once — capture it). Same origin allowlisting story as the widget: empty `allowedOrigins` accepts any origin by default; setting `MUNIN_TRACKER_REQUIRE_ALLOWLIST=1` on the backend makes it fail closed instead. Cloud production should run with the env var on; OSS dev is open-by-default for ergonomics.

### 2b. Embed the script

```tsx
const API_URL = import.meta.env.VITE_API_URL;

<script async
  src={`${API_URL}/tracker.js`}
  data-key="mn_track_…"
  data-spa="true"
/>
```

The tracker only needs the API origin in its `src` — there's no separate `data-api` required unless you're serving the bundle from a different host than the API (uncommon; only set if you actually have a CDN-fronted `tracker.js`).

Required attribute: `data-key`. The script auto-fires a page view on `DOMContentLoaded`.

`data-spa="true"` enables auto-tracking of `history.pushState` / `replaceState` route changes — set this for any React/Vue/Svelte/etc. SPA. Without it you'll only get one page view at initial load and an empty funnel.

`data-api` is optional and defaults to the script's origin. Don't set it unless the API origin differs from where you loaded the bundle.

For custom events (CTA clicks, signup funnels, scroll depth), `window.mn.track(subjectId, attrs?)` is exposed once the bundle loads — see `skill://analytics/track-website-traffic`. Drop-off across those steps is then one call to `analytics_get_funnel`.

### 2c. Identify logged-in users (optional, but it's what makes journeys/funnels pay off)

Anonymous tracking works with zero extra setup. But if the site has signed-in users, link each one to a known identity so their page-views attach to a CRM contact and funnels stop double-counting the anonymous → signed-in transition.

Cheapest path: when your server renders the tracker tag for a signed-in user, add `data-external-id` (your stable user id) and `data-user-hash` (an HMAC of that id, signed server-side with the tracker's identity secret). The bundle auto-fires the identify on load — no client code:

```html
<script async
  src="{{API_URL}}/tracker.js"
  data-key="mn_track_…"
  data-spa="true"
  data-external-id="user_42"
  data-user-hash="<hex hmac, computed server-side>">
</script>
```

Render the two `data-` attributes only for signed-in users; omit them for anonymous visitors. Full recipe (minting the identity secret, signing the hash, the `window.mn.identify` alternative): `skill://analytics/identify-visitors`.

## Step 3 — CMS content (the CORS trap)

This is where every coding agent gets stuck. The CMS delivery API is public, anonymous, and intentionally has **no CORS headers**. Browsers will block direct fetches from your frontend's origin. You have two correct options; do not try a third.

### The endpoint

- List entries: `GET {{API_URL}}/v1/cms/{{ORG_ID}}/{collectionSlug}?locale=en&limit=20`
- Single entry by slug: `GET {{API_URL}}/v1/cms/{{ORG_ID}}/{collectionSlug}/{entrySlug}?locale=en`

Returns plain JSON: `{ data: [...] }` for the list, `{ data: {...} }` for one entry. No auth header.

`{{ORG_ID}}` above is your tenant's `org_…` id, already substituted from your authenticated session — no need to ask for it. Store it in env too — `MUNIN_ORG_ID` / `NEXT_PUBLIC_MUNIN_ORG_ID` / `VITE_MUNIN_ORG_ID` per the framework convention above.

### Option A — server-side fetch (recommended)

Do the `fetch()` from a server function / API route / loader / server component, **never** the browser. Bundle output is then plain HTML/JSON that the browser receives same-origin — no CORS check applies.

Framework-specific landing spots:
- **Next.js (app router)** — `fetch()` inside a server component or route handler.
- **Next.js (pages)** — `getServerSideProps` / `getStaticProps` / `pages/api/*`.
- **Remix / React Router** — a route `loader`.
- **TanStack Start** — `createServerFn`.
- **SvelteKit** — `+page.server.ts` `load`.
- **Astro** — top-level `await fetch()` in a `.astro` file.
- **Plain Vite/CRA SPA** — add a tiny Node/Cloudflare-Worker proxy; there is no client-only escape.

ISR / edge caching is fine and recommended (revalidate on the order of 60s). The endpoint is cheap and serves stable JSON.

### Option B — your own server-side proxy

If the frontend has no server runtime (static export, client-only SPA), stand up a one-line proxy endpoint on a Worker, Lambda, or Node server that forwards to the Munin delivery API and sets its own CORS headers. Same end result — the browser only ever talks to your origin.

### What NOT to do

- **Don't try to add the frontend's origin to a CORS allowlist on the Munin side.** There isn't one for the delivery API; this is by design. The endpoint is intended for server-to-server / CDN-edge consumers.
- **Don't paste the response into a `posts.ts` file and call it live.** A frequent failure mode: the agent generates a static fallback, then claims content is "live from Munin." Either it's actually fetched at request/build time, or the integration is incomplete — say so.
- **Don't add `mode: 'no-cors'` to the fetch.** It silently returns an opaque response your code can't read.

## Step 4 — authoring content (optional)

If the operator also wants demo/seed content in the CMS so the frontend has something to render:

1. `cms_list_collections` — find or create the relevant collection (e.g. `blog-posts`). If missing, `cms_create_collection` with the schema the frontend expects.
2. `cms_create_entry` per article, then `cms_publish_entry` for each one.

Confirm with `cms_list_entries({ collectionSlug, published: true })` before reporting done. Published entries appear in the delivery API within the cache TTL (~60s).

See `skill://cms/publish-entry` and `skill://cms/migrate-content` for the full authoring loop.

## End-to-end smoke test

Before reporting the integration complete, in a real browser on the preview origin:

1. **Widget** — the bubble renders, opens, and accepts a message. Confirm receipt from the admin side with `conv_list_conversations({ limit: 5 })` — the test message should appear within ~2s.
2. **Tracker** — load two pages, then `analytics_list_top_subjects({ subjectType: "page", sinceDays: 1, limit: 10 })`. Both `subjectId`s should be there (visits propagate within a few seconds).
3. **CMS** — the rendered list/detail pages show entries fetched live (not a stale build-time snapshot). Publish one new entry via MCP; within the cache TTL it should appear after a refresh.

If any of the three fails, the most likely cause is in this table:

| Symptom | Probable cause |
|---|---|
| `[munin-widget] data-munin-host: data-munin-host is required` (or `data-widget-key`, `data-channel-id`) | Missing or mis-named attribute on the `<script>` tag. They are all required; names are exact. |
| Widget loads but messages return 403 | `originAllowlist` doesn't include the *exact* origin shown in DevTools → Network → request headers → `Origin`. Update with `conv_widget_update_channel`. |
| Tracker loads, `mn` global exists, but no events appear in `analytics_list_top_subjects` | `allowedOrigins` mismatch — same fix as widget, via `analytics_update_tracker`. Or: SPA without `data-spa="true"` and you're only checking subpages. |
| `Access to fetch ... has been blocked by CORS policy` on `/v1/cms/...` | You're calling the CMS delivery API from the browser. Move the fetch server-side per step 3. |
| 404 on `{{API_URL}}/embed/widget.js` or `{{API_URL}}/embed/tracker.js` | Old path. Both bundles are served from the root: `/widget.js` and `/tracker.js`. |
| 404 on `/v1/cms/{orgId}/{slug}` | The collection slug or org id is wrong. `cms_list_collections` returns the canonical slugs. |

## What NOT to do

- **Don't guess `API_URL` or hardcode it in source.** It's been substituted into this playbook and stated in the server instructions — use that value and write it into the frontend's env (`NEXT_PUBLIC_API_URL` / `VITE_API_URL` / etc.). The cloud host is `https://api.getmunin.com`, but self-host and OSS dev differ, so don't assume.
- **Don't put the widget key or tracker key in a `.env` as a server-only secret.** Both are designed to be visible in browser source. The origin allowlist is what protects them.
- **Don't ship to production with an empty `originAllowlist` / `allowedOrigins`.** With `MUNIN_WIDGET_REQUIRE_ALLOWLIST` / `MUNIN_TRACKER_REQUIRE_ALLOWLIST` unset (OSS-dev default), empty means open-to-any-origin. Production deployments should both set the env var to `1` *and* configure the actual origins.
- **Don't skip the smoke test.** All three integrations have silent-failure modes (widget renders but ingest 403s; tracker loads but `allowedOrigins` blocks events; CMS fetch returns build-time data). Verify each in a real browser before reporting done.
- **Don't mix this playbook with the embedded chat widget for end-user agents** (`skill://conv/setup-chat-widget` step 4, "browser-direct integration"). That's a different threat model: this playbook is browser-embed; that one is agent-pushed transcripts.

## Related

- `skill://conv/setup-chat-widget` — full widget detail, identified users, server-to-server posting.
- `skill://analytics/track-website-traffic` — full tracker detail, custom events, querying the data.
- `skill://analytics/track-cms-views` — per-entry view tracking when serving CMS content yourself.
- `skill://cms/publish-entry` — authoring side.
- `skill://cms/migrate-content` — bulk content seeding.
