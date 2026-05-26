---
'@getmunin/dashboard-pages': minor
'@getmunin/docs-pages': minor
'@getmunin/ui': patch
---

Update Next.js to 16.2.6, React to 19.2.6, next-intl to 4.12.0, move
`apps/web` fully to Turbopack, and clear the `pnpm audit` finding for `qs`
via a workspace override.

Notes on the Next 16 upgrade:

- The root layout now lives at `app/[locale]/layout.tsx` (the empty
  `app/layout.tsx` shim is gone). The locale layout retains the standard
  `setRequestLocale` + `NextIntlClientProvider` setup; `force-dynamic` is
  set at the locale layout so every route SSRs at request time.
- Cache Components / `experimental.rootParams` are **not** enabled. The
  Next 16 cacheComponents model interacts badly with next-intl's client
  hooks (open tracker amannn/next-intl#1493) — once next-intl supports it
  natively, the locale layout can switch to `await connection()` inside a
  `<Suspense>` boundary and recover Partial Prerender.
- `middleware.ts` → `proxy.ts` (Next 16 rename).
- `next.config.mjs` swaps the custom `webpack:` hook for a `turbopack:`
  block. Both `next dev` and `next build` run on Turbopack. The
  `resolveAlias` entry redirects `tw-animate-css` to its concrete CSS
  file because the package only declares the `style` export condition,
  which Turbopack does not honour.
- TypeScript source across the workspace now uses `.ts`/`.tsx`
  extensions in relative imports (replacing the previous NodeNext
  `.js` convention). The `packages/tsconfig/base.json` enables
  `allowImportingTsExtensions` + `rewriteRelativeImportExtensions`, so
  tsc still emits `.js` extensions in compiled `dist/` output for Node
  ESM consumers. This closes the Turbopack gap from
  vercel/next.js#82945 without waiting on an upstream extensionAlias
  implementation.
- `packages/dashboard-pages` and `packages/docs-pages` set
  `declaration: false` in their tsconfigs to silence TS2742 portability
  warnings from next-intl's destructured re-exports — these packages ship
  source (`"main": "./src/index.ts"`), so declarations were never emitted
  anyway.
- Root `package.json` adds two `pnpm.overrides` entries:
  - `qs >= 6.15.2` — clears the moderate transitive vulnerability that
    reached the workspace through `supertest → superagent → qs`.
  - `next-intl ^4.12.0` — forces a single resolved version across the
    workspace. Without this, the loose peer-dep range (`^4.0.0`) on
    `@getmunin/dashboard-pages` and `@getmunin/docs-pages` let pnpm keep
    older copies of next-intl alongside the bumped one in `apps/web`,
    producing two distinct React contexts so `useTranslations` in
    dashboard/docs client components could not find the
    `NextIntlClientProvider` set up by the locale layout.
