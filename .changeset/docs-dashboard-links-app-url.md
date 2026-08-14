---
'@getmunin/docs-pages': patch
---

fix(docs-pages): resolve dashboard links against `NEXT_PUBLIC_APP_URL` instead of assuming same-origin

The six links into `/dashboard/settings/api-keys` — the "Get a key →" button in the docs topbar plus the inline "Settings → API keys" links in the five `connect-*` guides — used the next-intl `Link`, which localizes the href against the *current* app. In OSS that is correct: `apps/web` serves `/[locale]/docs` and `/[locale]/dashboard` from one origin. On the cloud marketing site it is not — there is no dashboard route there, so every one of the 66 built docs pages carried a dead `/en/dashboard/settings/api-keys`, the topbar button included.

New `DashboardLink` component keeps the relative, locale-prefixed `Link` when `NEXT_PUBLIC_APP_URL` is unset (OSS, same-origin) and emits a plain `<a>` at `${NEXT_PUBLIC_APP_URL}${href}` when it is set. It has to be a plain anchor in that case: next-intl's `Link` would localize an absolute cross-origin href rather than pass it through. The unprefixed target is fine on the app side — `apps/web/proxy.ts` runs the next-intl middleware with `localePrefix: 'always'`, so `/dashboard/...` redirects to the visitor's negotiated locale.

`NEXT_PUBLIC_APP_URL` is the existing convention on the consuming side (`marketing-cloud/lib/links.ts`, already baked into the marketing deploy for dev and prod), so no new configuration is needed — only the dependency bump.
