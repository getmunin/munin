---
'@getmunin/dashboard-pages': patch
---

Fix two URL regressions in the dashboard.

- **OAuth sign-in landed on the API host.** `LoginForm` and `SignupForm` were passing a path-only `callbackURL: '/dashboard'` to `authClient.signIn.social({ provider: ... })`. BetterAuth's backend resolves a relative callback against its own baseURL, so post-OAuth users were redirected to `<auth-host>/dashboard` (404) instead of the dashboard host they signed in from. Both forms now wrap `redirectTo` with `absoluteCallbackUrl(...)` so the value sent to the backend is fully qualified against `window.location.origin`.

- **"View prompt" on the dashboard home pointed at the dashboard host.** The recipe links in `GetStarted` used a relative `href` of `/docs/guides/recipe-<id>`, which the browser resolved against the dashboard host instead of the docs host. They now prepend `process.env.NEXT_PUBLIC_DOCS_URL` (already read for the MCP-setup `docsHref`), matching how the MCP `docsHref` is constructed.

Both regressions were latent until 4.25/4.26 (when the recipes moved to docs and the auth pages consolidated into this package); the first deploy of either path against a backend-on-a-different-host surfaced them.
