---
'@getmunin/dashboard-pages': patch
---

Fix prerender failure in consumer apps that statically render `/setup`.

`AgentSetupWizard`'s `ReadyCard` calls `useSearchParams()` to detect a resumed OAuth-authorize flow. In Next.js 16, that hook bails out of SSG and requires a `<Suspense>` boundary; without one, consumers that prerender the wizard page fail their build with `useSearchParams() should be wrapped in a suspense boundary`.

The OSS test app (`apps/web`) hides this by setting `export const dynamic = 'force-dynamic'` in `[locale]/layout.tsx`, so it never exercises the SSG path. Consumer apps that don't opt out of static rendering hit the failure as soon as they upgrade to the version where `useSearchParams` was introduced.

Wrap the `ReadyCard` instance in a `<Suspense fallback={null}>` so the wizard works regardless of the consumer's static/dynamic configuration.
