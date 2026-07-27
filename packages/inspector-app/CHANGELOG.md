# @getmunin/inspector-app

## 4.70.1

### Patch Changes

- @getmunin/ui@4.70.1
- @getmunin/dashboard-pages@4.70.1

## 4.70.0

### Minor Changes

- 4601314: Extend the inspector MCP App with five new views: CRM merge-proposal review (side-by-side contact comparison with app-only apply/dismiss), KB curation-candidate review (new `kb_list_curation_candidates` tool, app-only `kb_publish_curation_candidate`), analytics charts (views over time, funnel, traffic by source, contact journey), CMS entry preview with publish/unpublish/schedule actions, and a media-library thumbnail gallery. The panel resource now CSP-allows the asset-storage origin so thumbnails render inside the iframe.
- e123820: Add `outreach_revise_proposal` and `outreach_withdraw_proposal`, the two agent-side corrections to a pending outreach draft.

  `outreach_revise_proposal` rewrites the draft in place on the same proposal id — the contact and campaign are fixed, since a different recipient is a different proposal. A `reason` is required and the revision is recorded (`revisionCount`, `lastRevisedAt`, `lastRevisionReason`, revising actor), so an edit can never be silent. Proposals now also record the first time a human opens them for review; when a revision lands after someone else has already read the draft, `revisedAfterReviewAt` is stamped and both the dashboard review drawer and the MCP Apps inspector panel warn the reviewer that Wednesday's text is not the text they read on Monday.

  `outreach_withdraw_proposal` lets a curator retract its own pending draft — a duplicate, a prospect who turned out not to qualify, a bounced address — under a new terminal `withdrawn` status. Withdrawal is deliberately neutral: it does not suppress the contact, does not touch consent, and does not stop a campaign sequence, so a withdrawn follow-up leaves that step eligible again where a dismissed one ends the sequence for good. Slack approval cards resolve as withdrawn, and `skill://outreach/review-proposals` documents when each of the four verbs applies.

### Patch Changes

- Updated dependencies [5cb5ff3]
- Updated dependencies [4601314]
- Updated dependencies [e123820]
  - @getmunin/dashboard-pages@4.70.0
  - @getmunin/ui@4.70.0

## 4.69.3

### Patch Changes

- Updated dependencies [137fe87]
  - @getmunin/dashboard-pages@4.69.3
  - @getmunin/ui@4.69.3

## 4.69.2

### Patch Changes

- Updated dependencies [5b82be8]
  - @getmunin/dashboard-pages@4.69.2
  - @getmunin/ui@4.69.2

## 4.69.1

### Patch Changes

- @getmunin/ui@4.69.1
- @getmunin/dashboard-pages@4.69.1

## 4.69.0

### Patch Changes

- Updated dependencies [7078b30]
  - @getmunin/dashboard-pages@4.69.0
  - @getmunin/ui@4.69.0

## 4.68.0

### Patch Changes

- Updated dependencies [8da0e90]
- Updated dependencies [d4bfeb7]
- Updated dependencies [a66d454]
- Updated dependencies [cdff1ad]
- Updated dependencies [ed38e6c]
- Updated dependencies [47f509d]
- Updated dependencies [491186c]
- Updated dependencies [8037e74]
- Updated dependencies [3677620]
- Updated dependencies [8788bd4]
  - @getmunin/dashboard-pages@4.68.0
  - @getmunin/ui@4.68.0

## 4.67.2

### Patch Changes

- @getmunin/ui@4.67.2
- @getmunin/dashboard-pages@4.67.2

## 4.67.1

### Patch Changes

- @getmunin/ui@4.67.1
- @getmunin/dashboard-pages@4.67.1

## 4.67.0

### Patch Changes

- @getmunin/ui@4.67.0
- @getmunin/dashboard-pages@4.67.0

## 4.66.1

### Patch Changes

- Updated dependencies [3e0b921]
  - @getmunin/dashboard-pages@4.66.1
  - @getmunin/ui@4.66.1

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
