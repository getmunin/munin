---
'@getmunin/backend-core': minor
'@getmunin/dashboard-pages': minor
'@getmunin/docs-pages': minor
---

Collapse the public URL surface to three vars, drop the path rewriter,
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
