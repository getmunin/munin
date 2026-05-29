# @getmunin/docs-pages

## 4.23.2

### Patch Changes

- Updated dependencies [377e87d]
- Updated dependencies [f0e5389]
  - @getmunin/backend-core@4.23.2

## 4.23.1

### Patch Changes

- Updated dependencies [1f1a139]
  - @getmunin/backend-core@4.23.1

## 4.23.0

### Patch Changes

- Updated dependencies [2dd56ef]
- Updated dependencies [31f5346]
  - @getmunin/backend-core@4.23.0

## 4.22.0

### Patch Changes

- Updated dependencies [6b4276d]
  - @getmunin/backend-core@4.22.0

## 4.21.0

### Patch Changes

- Updated dependencies [cc45f6c]
  - @getmunin/backend-core@4.21.0

## 4.20.0

### Patch Changes

- Updated dependencies [cedba8d]
- Updated dependencies [75ad065]
  - @getmunin/backend-core@4.20.0

## 4.19.4

### Patch Changes

- Updated dependencies [aa30308]
  - @getmunin/backend-core@4.19.4

## 4.19.3

### Patch Changes

- @getmunin/backend-core@4.19.3

## 4.19.2

### Patch Changes

- dfae814: Align `@getmunin/docs-pages` version with the rest of the fixed-group public packages and add it to the changesets `fixed` set so future releases keep all OSS package versions in lockstep.
  - @getmunin/backend-core@4.19.2

## 1.3.2

### Patch Changes

- @getmunin/backend-core@4.19.1

## 1.3.1

### Patch Changes

- Updated dependencies [0501880]
  - @getmunin/backend-core@4.19.0

## 1.3.0

### Minor Changes

- a0d31d7: Collapse the public URL surface to three vars, drop the path rewriter,
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

### Patch Changes

- Updated dependencies [a0d31d7]
  - @getmunin/backend-core@4.18.0

## 1.2.0

### Minor Changes

- f1cff47: Update Next.js to 16.2.6, React to 19.2.6, next-intl to 4.12.0, move
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

### Patch Changes

- @getmunin/backend-core@4.17.0

## 1.1.2

### Patch Changes

- Updated dependencies [7e16468]
  - @getmunin/backend-core@4.16.0

## 1.1.1

### Patch Changes

- Updated dependencies [d8ed4f6]
  - @getmunin/backend-core@4.15.0

## 1.1.0

### Minor Changes

- 1fe1031: Make public-facing URLs configurable instead of hardcoding `api.munin.eu` / `docs.getmunin.com`.
  - `packages/docs-pages/src/page.tsx` and `_components/rest-endpoint.tsx`: the example `curl` URL is built from `process.env.NEXT_PUBLIC_API_URL` (defaulting to `http://localhost:3001`), matching the existing pattern in `guides/chat-widget/page.tsx`.
  - `packages/backend-core/scripts/generate-openapi.ts`: the OpenAPI spec's `servers[0]` is built from `MUNIN_OPENAPI_SERVER_URL` / `MUNIN_OPENAPI_SERVER_DESCRIPTION` (defaulting to `http://localhost:3001` / `local dev`). Cloud deploys set these at build time to render docs against the right host.
  - `packages/dashboard-pages/src/data/mcp-setups.ts`: `buildMcpSetups` takes an optional second `docsHost` argument; `MCP_SETUPS` keeps using the cloud-prod default. `get-started.tsx` reads `process.env.NEXT_PUBLIC_DOCS_URL` so dev points at `docs.dev.getmunin.com` and prod at `docs.getmunin.com`.

  Brand-attribution links (`getmunin.com` in the chat-widget "Powered by" footer, the web-crawler User-Agent) stay hardcoded — they identify Munin itself, not the deployment.

### Patch Changes

- Updated dependencies [1fe1031]
  - @getmunin/backend-core@4.14.0

## 1.0.14

### Patch Changes

- Updated dependencies [7977f92]
  - @getmunin/backend-core@4.13.0

## 1.0.13

### Patch Changes

- Updated dependencies [458b548]
  - @getmunin/backend-core@4.12.0

## 1.0.12

### Patch Changes

- Updated dependencies [2f2eff8]
  - @getmunin/backend-core@4.11.0

## 1.0.11

### Patch Changes

- Updated dependencies [024a314]
  - @getmunin/backend-core@4.10.0

## 1.0.10

### Patch Changes

- @getmunin/backend-core@4.9.0

## 1.0.9

### Patch Changes

- Updated dependencies [7c9a3d3]
- Updated dependencies [0a0e2a1]
  - @getmunin/backend-core@4.8.0

## 1.0.8

### Patch Changes

- Updated dependencies [8c79922]
  - @getmunin/backend-core@4.7.1

## 1.0.7

### Patch Changes

- Updated dependencies [5108510]
  - @getmunin/backend-core@4.7.0

## 1.0.6

### Patch Changes

- Updated dependencies [04edb03]
- Updated dependencies [afcf3a1]
  - @getmunin/backend-core@4.6.1

## 1.0.5

### Patch Changes

- Updated dependencies [b770bce]
  - @getmunin/backend-core@4.6.0

## 1.0.4

### Patch Changes

- Updated dependencies [8d6b8b9]
  - @getmunin/backend-core@4.5.1

## 1.0.3

### Patch Changes

- Updated dependencies [9367ac8]
  - @getmunin/backend-core@4.5.0

## 1.0.2

### Patch Changes

- @getmunin/backend-core@4.4.1

## 1.0.1

### Patch Changes

- @getmunin/backend-core@4.4.0

## 1.0.0

### Major Changes

- 21a8189: Introduce `@getmunin/docs-pages`: lifts the developer-portal routes (`/docs`, `/docs/rest`, `/docs/mcp`, `/docs/skills`, `/docs/guides`) out of `apps/web` into a shared package so munin-cloud can mount the same docs under its own auth/header chrome. The OSS `apps/web/app/[locale]/docs/*` routes are now thin one-liner shells that re-export from the package.

  `@getmunin/backend-core` now publishes the OpenAPI spec and docs fixtures (mcp-tools.json, skills.json) via package subpath exports (`@getmunin/backend-core/openapi.json`, `@getmunin/backend-core/docs-fixtures/*`) so downstream consumers can read them at build time.

  Dashboard: removes the CONV pill from the Last conversations rows — the conversation rows in that section are conversations by definition; the pill was redundant.

### Patch Changes

- Updated dependencies [21a8189]
- Updated dependencies [21a8189]
  - @getmunin/backend-core@4.3.0
