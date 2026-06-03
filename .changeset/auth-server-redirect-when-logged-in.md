---
'@getmunin/dashboard-pages': minor
---

Auth pages now redirect already-signed-in users away from `/login` and `/signup` on the server, before any UI renders. Adds a new `@getmunin/dashboard-pages/server` subpath export with `getServerSession()` and `redirectIfAuthenticated({ locale, redirectParam })`, which forward the request cookies to the BetterAuth `/auth/get-session` endpoint and call the i18n-aware `redirect()` to `safeRedirect(redirectParam)` (defaults to `/dashboard`). The OSS `apps/web` login and signup pages adopt the helper. The server-only entry is kept off the main barrel export so client bundles aren't pulled into the `next/headers` graph.
