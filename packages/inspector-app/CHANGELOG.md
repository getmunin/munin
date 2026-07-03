# @getmunin/inspector-app

## 4.66.0

### Minor Changes

- 44a9d34: Munin Inspector MCP App: new `@getmunin/inspector-app` package builds the `ui://munin/inspector` panel (React, single self-contained HTML, SDK bundled — no CDN) with an outreach proposal review view and the hello diagnostics view. New `outreach_approve_proposal` / `outreach_dismiss_proposal` admin tools expose the existing decision surface over MCP (declared panel-only via `_meta.ui.visibility: ["app"]` so MCP App hosts hide them from the model — sends require a human click); `outreach_list_proposals` and `inspector_hello` now declare `_meta.ui.resourceUri` so supporting hosts render the panel inline, with approve/dismiss round-tripping over the widget channel. Adds `skill://outreach/review-proposals`.
- 768642a: Localize the inspector panel from the MCP App host locale.

  - The panel reads `getHostContext()?.locale` after connect (falling back to `navigator.language`, then `en`) and re-renders on `onhostcontextchanged`, so it follows the user's Claude language setting rather than the iframe's browser default.
  - Strings live in a new `inspector.*` namespace in `@getmunin/dashboard-pages`' message catalogs (English + Norwegian), now exposed via a `./messages/*.json` export; the panel bundles only that namespace (~1 kB per locale) through a small `t(key, params)` helper.
  - Ages in the proposal ledger format through `Intl.RelativeTimeFormat` with the host locale instead of hardcoded English abbreviations.

  Server-originated strings (tool error messages) remain English.

### Patch Changes

- 45f0e56: Stop MCP App hosts' rounded iframe clipping from slicing the panel border. The panel applies the host's style variables and rounds itself with `--border-radius-lg` where available; on `platform: 'mobile'` hosts (which draw their own rounded card around the embed) it drops its outer border entirely and lets the host frame it. Hosts that send no style tokens keep the square Munin look.
- b84577f: Package the Tailwind theme and brand fonts in @getmunin/ui.

  - New `@getmunin/ui/tailwind-preset` export carries the whole Munin theme (token-mapped palette, semantic shadcn colors, radii, fonts, motion). Consumers shrink their Tailwind config to `presets: [muninPreset]` plus their own `content` globs; the OSS web app now does exactly that.
  - `styles/fonts.css` now resolves the woff2 files shipped inside the package (`src/fonts/`) via relative URLs instead of assuming the consumer hosts them at `/fonts/…`. Next emits them as hashed static assets; Vite (singlefile) inlines them. `apps/web/public/fonts` and the inspector-app's private font copies are gone.
  - The inspector-app build now compiles Tailwind (preset + PostCSS), so future panel views can use @getmunin/ui components directly; importing them through the barrel is tree-shaking-safe (`sideEffects` is now declared) and does not pull next-themes or sonner into the iframe bundle.

- Updated dependencies [fb104ce]
- Updated dependencies [768642a]
- Updated dependencies [04cab6d]
- Updated dependencies [b84577f]
  - @getmunin/dashboard-pages@4.66.0
  - @getmunin/ui@4.66.0
