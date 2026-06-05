---
'@getmunin/backend-core': minor
'@getmunin/dashboard-pages': minor
---

OAuth consent page redesigned end-to-end. Three concrete changes:

1. **Backend — enriched client lookup.** `GET /v1/oauth/clients/:id` now returns `{ client_id, name, uri, icon_url, redirect_uri_host, created_at }`. `name` falls back to a host-derived label when the client's DCR didn't include `client_name` (well-known hosts like `claude.ai`/`chatgpt.com`/`cursor.sh` get a branded label; anything else falls back to the bare host). `redirect_uri_host` is the host portion of the first registered redirect URI — the full URI stays off the wire.

2. **Backend — favicon proxy.** New `GET /v1/oauth/clients/:id/icon` route. Server-side fetches `oauth_client.icon` if present, otherwise `https://<redirect_uri_host>/favicon.ico` using `safeFetch` (SSRF-guarded). Validates MIME (`image/*` only), caps response size, falls back to a generic SVG on any failure. Served from our origin with a 24h browser cache — keeps the user's IP off third-party hosts pre-authorization.

3. **Frontend — SSR refactor + new layout.** The page is now an async server component (`apps/web/.../consent/page.tsx`) that fetches the enriched client info before render. The fixed CORS bug along the way: cookies are no longer sent on the lookup (closes the `Access-Control-Allow-Credentials` failure path that was leaving the page stuck on the raw `client_id`). New three-state machine (`new` / `granted` / `denied`) with intermediate result panes — instead of redirecting immediately on Authorize/Deny, the page shows a brief "Access granted/denied · Returning to claude.ai…" panel with spinner, then redirects. Layout matches the editorial design: serif headline that shifts copy per state, identity card with app icon, trust-timeline strip, grouped per-module permissions with `Read`/`Write` pills, reassurance block, and an actions footer.

Also adds an `anonymous: true` opt-out on the `api()` helper for callers of `@PublicController` endpoints that shouldn't send the BetterAuth session cookie.

i18n strings in `en.json` and `nb.json` updated to match the new copy; the keys are different from before (`title`, `lede`, `scopesLabel`, etc. reshaped — see the keys under `dashboard.oauthConsent`).
