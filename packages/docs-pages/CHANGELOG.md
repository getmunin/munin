# @getmunin/docs-pages

## 4.51.0

### Patch Changes

- Updated dependencies [7ea516e]
  - @getmunin/backend-core@4.51.0

## 4.50.1

### Patch Changes

- Updated dependencies [d612e6a]
  - @getmunin/backend-core@4.50.1

## 4.50.0

### Patch Changes

- Updated dependencies [3dafe87]
- Updated dependencies [3f034de]
  - @getmunin/backend-core@4.50.0

## 4.49.0

### Patch Changes

- Updated dependencies [2b8fd7d]
- Updated dependencies [38f4775]
- Updated dependencies [f13f5c5]
  - @getmunin/backend-core@4.49.0

## 4.48.0

### Patch Changes

- Updated dependencies [dc70c67]
  - @getmunin/backend-core@4.48.0

## 4.47.0

### Patch Changes

- Updated dependencies [4b889cf]
- Updated dependencies [448953f]
  - @getmunin/backend-core@4.47.0

## 4.46.0

### Patch Changes

- Updated dependencies [bfb850e]
- Updated dependencies [1892d75]
  - @getmunin/backend-core@4.46.0

## 4.45.1

### Patch Changes

- @getmunin/backend-core@4.45.1

## 4.45.0

### Patch Changes

- Updated dependencies [c1b4b58]
  - @getmunin/backend-core@4.45.0

## 4.44.1

### Patch Changes

- Updated dependencies [ea18794]
  - @getmunin/backend-core@4.44.1

## 4.44.0

### Patch Changes

- Updated dependencies [10ae30e]
- Updated dependencies [10ae30e]
- Updated dependencies [70d50ed]
  - @getmunin/backend-core@4.44.0

## 4.43.2

### Patch Changes

- @getmunin/backend-core@4.43.2

## 4.43.1

### Patch Changes

- @getmunin/backend-core@4.43.1

## 4.43.0

### Minor Changes

- d3c5d6f: Three new skill markdown surfaces aimed at coding agents wiring a fresh frontend (Lovable, Bolt, Replit, v0, Cursor, Claude Code) to a Munin tenant:
  - **`skill://playbooks/frontend-integration`** — end-to-end playbook covering the chat widget embed, analytics tracker embed, and live CMS delivery in one pass. Codifies the failures every coding agent currently hits cold: wrong API host (`munin.app` vs `api.getmunin.com`), legacy `/embed/widget.js` path, missing `data-munin-host` / `data-widget-key` / `data-channel-id` attributes, `originAllowlist` mis-set for preview origins, and the `Access to fetch … blocked by CORS policy` on `/v1/cms/*` that only resolves via server-side proxying. Resolves the host via `NEXT_PUBLIC_API_URL` / `VITE_API_URL` / etc. with per-framework table; explicit about empty-allowlist semantics under `MUNIN_WIDGET_REQUIRE_ALLOWLIST` / `MUNIN_TRACKER_REQUIRE_ALLOWLIST` (open-by-default in OSS dev, fail-closed in prod when set).
  - **`skill://webhooks/subscribe-to-events`** — first markdown skill for the webhooks module. Walks through event-type selection, signed receiver implementation (HMAC-SHA256 verification with constant-time compare, raw-body capture per framework), idempotency via `x-munin-delivery-id`, 15s ack budget, and `webhooks_list_deliveries` for audit. Common patterns include forwarding `conversation.message.sent` into a widget UI over your own SSE/WebSocket, rebuilding a static site on `cms.entry.published`, and Slack-on-`crm.deal.stage_changed`.
  - **`skill://cms/design-collection`** — the missing prequel to `migrate-content` and `publish-entry`. Catalogues all 14 field types with editor/storage shapes, walks through localization decisions, field-order-as-render-order, the two-pass setup for circular references, and the lossy semantics of `cms_update_collection` (drop = data orphaned but preserved in jsonb; rename = catastrophic without manual migration). Includes archetype sketches for blog, author, product, FAQ, and landing-page section collections.

  Docs renderer (`@getmunin/docs-pages`):
  - Enable `remark-gfm` so skill markdown tables and other GitHub-flavored syntax render correctly. Previously pipe-tables in `track-website-traffic.md` and the new skills collapsed into single paragraphs.
  - New `renderSkillContent` helper substitutes `{{API_URL}}` in skill markdown with `NEXT_PUBLIC_API_URL` (falls back to `http://localhost:3001` for OSS dev). Lets prose show the live host while preserving `${API_URL}` inside real JS template literals in code samples.

### Patch Changes

- Updated dependencies [3858d3e]
- Updated dependencies [d3c5d6f]
  - @getmunin/backend-core@4.43.0

## 4.42.0

### Patch Changes

- Updated dependencies [15d6ed4]
  - @getmunin/backend-core@4.42.0

## 4.41.1

### Patch Changes

- Updated dependencies [360b7d4]
- Updated dependencies [e9ec27d]
  - @getmunin/backend-core@4.41.1

## 4.41.0

### Patch Changes

- Updated dependencies [145dbd9]
  - @getmunin/backend-core@4.41.0

## 4.40.4

### Patch Changes

- Updated dependencies [335d67f]
- Updated dependencies [ed2161a]
  - @getmunin/backend-core@4.40.4

## 4.40.3

### Patch Changes

- Updated dependencies [1fe3019]
- Updated dependencies [1fe3019]
  - @getmunin/backend-core@4.40.3

## 4.40.2

### Patch Changes

- @getmunin/backend-core@4.40.2

## 4.40.1

### Patch Changes

- Updated dependencies [706d8c9]
- Updated dependencies [09c75ea]
  - @getmunin/backend-core@4.40.1

## 4.40.0

### Patch Changes

- Updated dependencies [547a97b]
- Updated dependencies [e166c78]
- Updated dependencies [8e4dee8]
- Updated dependencies [f8e82f2]
- Updated dependencies [67c91c3]
- Updated dependencies [014b431]
  - @getmunin/backend-core@4.40.0

## 4.39.0

### Patch Changes

- dcd8a6b: Restore list bullets inside `.docs .markdown` (Tailwind preflight in `apps/web` was zeroing out `list-style` on every `<ul>`/`<ol>`, leaving skill articles' list items as a mysteriously indented block with no marker). Now `disc` for unordered and `decimal` for ordered.

  Also moves inline `<code>` and `<pre>` backgrounds from `--docs-page` (the bone/beige page background) to `--docs-card` (paper white), so code reads distinctly against the article body in both light and dark mode.

- Updated dependencies [1b757bc]
  - @getmunin/backend-core@4.39.0

## 4.38.0

### Patch Changes

- Updated dependencies [0110a7e]
  - @getmunin/backend-core@4.38.0

## 4.37.0

### Patch Changes

- Updated dependencies [bb39ece]
- Updated dependencies [8e88ac1]
  - @getmunin/backend-core@4.37.0

## 4.36.0

### Patch Changes

- Updated dependencies [c3feb08]
- Updated dependencies [15796b9]
- Updated dependencies [584420d]
- Updated dependencies [c10c12e]
- Updated dependencies [de1b520]
  - @getmunin/backend-core@4.36.0

## 4.35.0

### Patch Changes

- Updated dependencies [73320e2]
- Updated dependencies [b502fe6]
  - @getmunin/backend-core@4.35.0

## 4.34.0

### Patch Changes

- Updated dependencies [290472e]
  - @getmunin/backend-core@4.34.0

## 4.33.0

### Patch Changes

- Updated dependencies [9042f0e]
  - @getmunin/backend-core@4.33.0

## 4.32.0

### Patch Changes

- Updated dependencies [bd8cd79]
- Updated dependencies [03d62af]
  - @getmunin/backend-core@4.32.0

## 4.31.0

### Patch Changes

- Updated dependencies [8b270d4]
  - @getmunin/backend-core@4.31.0

## 4.30.0

### Patch Changes

- @getmunin/backend-core@4.30.0

## 4.29.2

### Patch Changes

- @getmunin/backend-core@4.29.2

## 4.29.1

### Patch Changes

- Updated dependencies [84b988d]
- Updated dependencies [84b988d]
  - @getmunin/backend-core@4.29.1

## 4.29.0

### Patch Changes

- Updated dependencies [bc0d601]
  - @getmunin/backend-core@4.29.0

## 4.28.0

### Patch Changes

- Updated dependencies [7436b8c]
- Updated dependencies [4e09934]
  - @getmunin/backend-core@4.28.0

## 4.27.1

### Patch Changes

- @getmunin/backend-core@4.27.1

## 4.27.0

### Minor Changes

- b46a41c: Rename agent recipes to role/task-shaped names that match how teams already describe the work: Lead Enricher → **Lead Research**, Lead Scorer → **Lead Scoring**, Bug Spotter → **Bug Triage**, Renewal Watcher → **Renewal Watch**, Win-Back Agent → **Win-Back**, Outreach Drafter → **SDR**. Recipe slugs in `packages/docs-pages/src/guides/` follow (e.g. `recipe-bug-spotter` → `recipe-bug-triage`, `recipe-outreach-drafter` → `recipe-sdr`); `dashboard-pages` `RECIPES` data updated to match. Cloud-side dependants need a coordinated bump of `@getmunin/docs-pages` to pick up the new exports.

  Add two client guides: **Connect Hermes Agent** (Nous Research) and **Connect OpenClaw**, each with config snippets verified against the upstream MCP reference docs and the standard mint-key / verify / scope flow. Sort the Recipes and Clients categories alphabetically in `guidesByCategory()` so the sidebar and overview grid stay predictable as the library grows.

  Tighten cloud landing-page copy and tool chips to match the actual recipes: drop the non-existent `task://web/scrape-website` chip from Lead Research; fix Bug Triage's italic ("hiding in conversations", not "tickets") and body (filed as internal notes via `conv_send_message`, not "structured proposals"); soften Renewal Watch's body ("account signals" rather than a fabricated "usage + sentiment + open issues"); fill in tool chips that were omitted (Lead Scoring, Renewal Watch, Event Follow-up, SDR, Conversation Distiller).

  When the AI provider is unreachable on a brand-new conversation, the runtime now posts a generic hardcoded greeting (`"Hi, what can we do for you?"`) instead of escalating to a human — there is nothing for an operator to reply to before the visitor has said anything. The handover fallback path is unchanged for visitor replies: those still escalate with `"I'm having trouble responding right now. A teammate will follow up shortly."` (the trailing `"Thanks for your message —"` opener was dropped — the lead-in doesn't fit a turn where the visitor hasn't messaged us yet).

### Patch Changes

- Updated dependencies [ee1098c]
- Updated dependencies [489b65c]
- Updated dependencies [2605e0f]
- Updated dependencies [524a812]
- Updated dependencies [6c585ba]
  - @getmunin/backend-core@4.27.0

## 4.26.0

### Minor Changes

- 5d27a9b: docs: refresh agent-recipe library

  Replace recipes that the built-in curator already runs automatically (KB Curator → `skill://kb/review-content` weekly; CRM Deduper → `skill://crm/clean-contact-data` weekly) with four BYO-agent recipes that don't overlap with the auto-scheduler: Lead Enricher (event-driven), Lead Scorer (weekly), Win-Back Agent (weekly), and Event Follow-up (on-demand). Rename Content Marketer → Conversation Distiller and broaden its scope beyond FAQs to cover any recurring theme in conversations (questions, complaints, feature asks).

  Surfaces affected: `guides/_lib/guides.ts` registry, new `guides/recipe-{lead-enricher,lead-scorer,conversation-distiller,win-back,event-followup}/page.tsx`, and exports in `index.ts`. Orphan source pages for kb-curator / crm-deduper / content-marketer are removed.

### Patch Changes

- @getmunin/backend-core@4.26.0

## 4.25.0

### Patch Changes

- Updated dependencies [33b6613]
- Updated dependencies [7ddf932]
  - @getmunin/backend-core@4.25.0

## 4.24.3

### Patch Changes

- Updated dependencies [622745a]
  - @getmunin/backend-core@4.24.3

## 4.24.2

### Patch Changes

- Updated dependencies [b8da5b6]
  - @getmunin/backend-core@4.24.2

## 4.24.1

### Patch Changes

- @getmunin/backend-core@4.24.1

## 4.24.0

### Patch Changes

- Updated dependencies [e095d61]
- Updated dependencies [bbfc677]
  - @getmunin/backend-core@4.24.0

## 4.23.5

### Patch Changes

- @getmunin/backend-core@4.23.5

## 4.23.4

### Patch Changes

- Updated dependencies [6dfabd2]
  - @getmunin/backend-core@4.23.4

## 4.23.3

### Patch Changes

- @getmunin/backend-core@4.23.3

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
