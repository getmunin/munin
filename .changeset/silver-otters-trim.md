---
"@getmunin/types": patch
"@getmunin/core": patch
"@getmunin/backend-core": patch
"@getmunin/agent-runtime": patch
"@getmunin/agent-host": patch
"@getmunin/dashboard-pages": patch
"@getmunin/docs-pages": patch
"@getmunin/sdk": patch
"@getmunin/analytics-tracker": patch
---

refactor: one shared trailing-slash trim instead of 50 copies of a polynomial regex

`replace(/\/+$/, '')` appeared at ~50 base-URL call sites. The pattern is
quadratic on a long run of slashes — the engine retries the match from every
start position — which CodeQL flags wherever the input can come from outside
the process. Most sites read an env var and were never reachable, but the
connector base URLs (`magento.adapter.ts`, `gastroplanner.adapter.ts`), the
agent provider base URL, the SDK's `baseUrl` and the tracker's `data-api`
attribute all take theirs from a request or a customer's config.

`stripTrailingSlashes` now lives in `@getmunin/types` — the one package
everything already depends on — and walks back from the end of the string in
linear time. `@getmunin/sdk` and `@getmunin/analytics-tracker` ship standalone
bundles with no workspace dependencies, so they keep a local copy of the same
four lines rather than take one. Behavior is unchanged at every site, which
`packages/types/src/url.test.ts` pins against the old regex case by case.
