---
'@getmunin/dashboard-pages': patch
---

Expose `safeRedirect` and `resumeOauthAuthorizeUrl` from `@getmunin/dashboard-pages` so OSS and cloud auth pages can share the same post-sign-in redirect logic instead of each inlining a copy.

`safeRedirect(raw, fallback?)` guards against open-redirects by only honoring same-origin paths (`/...`, not `//...`); defaults to `/dashboard`.

`resumeOauthAuthorizeUrl(params)` returns the upstream `auth/oauth2/authorize` URL when the user landed on sign-in/sign-up while resuming an OAuth flow (i.e. `response_type=code` + `client_id` are present in the query), or `null` otherwise. Reads the API base from `NEXT_PUBLIC_API_URL`.
