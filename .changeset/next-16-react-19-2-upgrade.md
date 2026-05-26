---
'@getmunin/dashboard-pages': minor
'@getmunin/docs-pages': minor
'@getmunin/ui': patch
---

Update Next.js to 16.2.6, React to 19.2.6, next-intl to 4.12.0, and clear
the `pnpm audit` finding for `qs` via a workspace override.

The Next 16 upgrade adopts the modern app-router layout: `[locale]` is now a
root parameter (the old `app/layout.tsx` is gone — `app/[locale]/layout.tsx`
serves as the root layout), `experimental.rootParams` and `cacheComponents`
are enabled, and `i18n/request.ts` reads the locale via `next/root-params`
instead of `setRequestLocale`. The dynamic data fetch (`getMessages()` +
`await connection()`) is wrapped in a `<Suspense>` boundary so the static
shell prerenders at build time and the i18n-aware tree streams at request
time — all routes render as Partial Prerender (◐).

Other migration bits:

- `middleware.ts` → `proxy.ts` (Next 16 rename).
- `next.config.mjs` swaps the custom `webpack:` hook for `turbopack:` config;
  Turbopack is now the default for both `next dev` and `next build`. A
  `resolveAlias` entry redirects `tw-animate-css` to its concrete CSS file
  because Turbopack does not honour the package's `style` export condition.
- `packages/dashboard-pages` and `packages/docs-pages` set
  `declaration: false` in their tsconfigs to silence TS2742 portability
  warnings from next-intl's destructured re-exports — these packages ship
  source (`"main": "./src/index.ts"`), so declarations were never emitted
  anyway.
- Root `package.json` adds a `pnpm.overrides` entry pinning `qs >= 6.15.2`,
  clearing the moderate transitive vulnerability that reached the workspace
  through `supertest → superagent → qs`.
