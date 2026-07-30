# @getmunin/inspector-app

## 4.75.0

### Minor Changes

- cc87bb6: Outreach proposals say where they are going before you approve them

  A proposal DTO now carries `delivery`: the campaign channel's type and vendor, the destination the approval would actually reach (email address for email campaigns, phone number for voice and SMS), and whether Munin will append the campaign CTA link and unsubscribe footer at send time. `contact` gains `phone` alongside `email`.

  Both review surfaces use it. The MCP App panel and the dashboard drawer state the consequence in words — "Approving places a phone call to +1 415 555 9999", "Approving emails jane@acme.com. Munin appends the campaign CTA link, an unsubscribe footer" — and warn in red when the contact has no address or number on file, which is a send that would fail. A voice proposal's approve button reads "Approve & call" rather than "Approve & send", and its missing subject renders as "(spoken call — no subject)" instead of the bare "(no subject)" an email would show.

  This matters most for voice campaigns, where approving dials a real phone number and the panel previously showed nothing but a subject-less body and an Approve button. It is worth having for email too: a reviewer approving a first-touch could not see the recipient address unless the contact happened to have no name.

  The panel's `Proposal.kind` union was also missing `'followup'`, which every follow-up proposal has carried since sequences shipped.

- b98f618: Outbound calls and text messages are approved only by a person in the dashboard

  A proposal whose campaign runs on a voice or SMS channel can now only be approved by a signed-in dashboard user. `outreach_approve_proposal` refuses every other caller — an MCP agent, an unrestricted admin API key on the control plane, a curator, the Slack approval button — and the proposal stays `pending`. Email approval is unchanged, including by agents and admin keys.

  The check lives in `OutreachService.approveProposal`, so it holds regardless of which surface the call arrives through. It is not an MCP tool-visibility hint: hosts that don't implement MCP Apps still list the tool, and calling it on a voice proposal fails there too.

  Slack declines these in-thread with a pointer to the dashboard rather than surfacing a service error. The Inspector panel drops the approve button for voice and SMS proposals — Dismiss stays, since dismissing sends nothing — and says where the call is actually placed.

  Quiet hours and blackout dates are now enforced when a call or text is approved. They were previously stored on the campaign and consulted only when listing due follow-ups, so nothing stopped a call at 3am. `cadenceRules` gains an optional `quietHoursTimezone` (IANA, validated) that quiet hours and blackout dates are read in; without it they are read in UTC, which is not what a Norwegian campaign means by "no calls before 08:00".

### Patch Changes

- Updated dependencies [8e98f2d]
- Updated dependencies [cc87bb6]
- Updated dependencies [b98f618]
- Updated dependencies [862b055]
- Updated dependencies [c5a05c5]
- Updated dependencies [c5a05c5]
  - @getmunin/dashboard-pages@4.75.0
  - @getmunin/types@4.75.0
  - @getmunin/ui@4.75.0

## 4.74.0

### Patch Changes

- c7bf800: CMS: the `cms_list_assets` panel shows two rows and opens an asset in a dialog.

  The panel rendered every asset the tool returned — an org with 60 images got 60 thumbnails, and picking one appended a detail block below the fold, so the thing you clicked and the thing you wanted to read were never on screen together.

  - **Eight thumbnails, then a footer control.** The grid is pinned to four columns (two on narrow hosts) and cut at two rows. The footer carries the state and the action: `8 OF 16 ASSETS` alongside `SHOW ALL 16 ↓`, toggling back to `SHOW FEWER ↑`. Nothing is dropped silently — the count is always the full total, and the toggle only appears when there is something hidden.
  - **Clicking a thumbnail opens a modal over the grid**, not a block under it: scrim, viewport-centered card, image scaled to fit, then the name, mime and size, alt text, the public URL with a copy-to-clipboard button, and the usage line from `cms_list_asset_usage` (still fetched once per asset and cached). Escape, the ✕ and a scrim click all close it. Copy degrades quietly where the host iframe withholds clipboard access.
  - **The backdrop matches the shared dialog** (`packages/ui` `DialogBackdrop`): `ink/40`, no blur, no drop shadow. The design mock called for a blurred scrim and a 60px shadow, but nothing else in the system does that — none of the 21 UI components carry a shadow at all.

- Updated dependencies [cad7227]
- Updated dependencies [c7bf800]
  - @getmunin/types@4.74.0
  - @getmunin/dashboard-pages@4.74.0
  - @getmunin/ui@4.74.0

## 4.73.0

### Minor Changes

- 62776e2: CMS: `cms_get_entry` no longer renders an MCP Apps panel.

  An entry is a document — long prose, blocks, images, under a user-defined schema — which is the worst fit for a fixed card in a chat transcript. The panel rendered every field stacked at full height and dumped `blocks` fields as raw JSON into a `<pre>` with no height cap, so reading one article produced a screen-and-a-half of transcript.

  The decisive constraint is that the binding is per-tool, not per-call: hosts resolve `_meta.ui.resourceUri` from the tool definition, and neither the MCP Apps spec nor the ext-apps SDK defines a way to suppress rendering for a single call. So a panel that is mildly useful when reviewing one draft is unavoidably also rendered five times when an agent reads five entries for a research pass. There is no setting that makes it appear only when it helps.

  Nothing moves out of reach. `cms_publish_entry` / `cms_unpublish_entry` / `cms_schedule_publish` were never app-only — unlike the outreach and CRM proposal actions — and they carry `destructiveHint: true`, so the human confirmation lives in the host's destructive-tool prompt rather than in a panel button. The tool result is unchanged: the full entry JSON was always in `content`, which is what the model reads.

  The inspector app keeps its other six panel-bound tools (`cms_list_assets`, `kb_list_curation_candidates`, `crm_list_merge_proposals`, `outreach_list_proposals`, and the four analytics reads), all of which wrap bounded, actionable payloads. The entry view, its type guards, its `inspector.entry` translations, and its styles are deleted.

### Patch Changes

- 0ac33df: Commerce: a product search renders as a gallery instead of a wall of prose.

  `commerce_search_products` returns image, title, price range and a storefront link per product, and until now every one of those had to survive a round trip through the model's prose. This adds a rendered surface for that result on all three chat surfaces, over one payload contract.

  - **New `MessageComponent` contract** (`@getmunin/types`): a Zod-validated `product_list` payload with a `source` block naming the connection that produced it, capped at 8 items. Price formatting lives in a deliberately dependency-free `@getmunin/types/message-format` subpath so the browser bundles can import it without dragging zod along — `formatPriceRange` renders `priceMin`/`priceMax` through `Intl.NumberFormat` from the payload's own `currency`, collapsing an equal min/max to a single price and falling back to `<amount> <code>` when a vendor reports a currency `Intl` doesn't know.
  - **The payload is derived server-side from the typed tool result, never authored by the model.** `runAgent` already returns each turn's tool calls with their raw results, so the conversation handler maps the last successful `commerce_search_products` call of the turn into components and persists them on `conv_messages.metadata`. The model cannot invent a price, a stock claim or a spec line, because there is no field for one. A refined second search supersedes the first; an errored search falls back to an earlier successful one; a search with no matches attaches nothing.
  - **Insecure or malformed URLs are nulled rather than dropping the product**, so a vendor serving images over http yields a card with a placeholder instead of a missing product. The schema itself requires https, and non-JSON or unparseable results are ignored entirely.
  - **Widget exposure is a whitelist, not a spread.** `conv_messages.metadata` also carries runner state (session ids, provider message ids, claim holders), so the widget's message list reads only the `components` key and re-validates it against the schema on the way out. Components are only ever attached to, or rendered on, `agent`/`user` messages, and never on internal notes.
  - **Chat widget** renders the gallery natively: an edge-to-edge scroll-snap rail that bleeds into the panel's own padding so the next card is visibly cut, a placeholder for missing or blocked imagery, and the connection named in a provenance line. It costs **1 kB gzip**. Hosting the real MCP App panel here was measured and rejected: `AppBridge` alone is 33.5 kB gzip and the panel it renders is 324 kB gzip — roughly twice the entire widget — on a customer's own marketing page, and an anonymous visitor has no MCP session for the panel to call tools against.
  - **Agent inbox** renders the same payload with the same rules, below the bubble at full drawer width rather than inside the 85%-max bubble. Native rather than an `AppBridge` host because the inbox is a transcript: a conversation with five product searches would mean five 324 kB iframes, each fed a persisted snapshot into a panel built around a live `ontoolresult`.
  - **claude.ai and other MCP App hosts** get the gallery via a new `views/products.tsx` in the inspector panel, shape-routing on the `{ connection, products }` tool result the way the six existing views do, with `commerce_search_products` now declaring `_meta.ui.resourceUri`. The panel keeps its own shape guard rather than importing the schema, matching how every other view there works. An empty result falls through to the neutral view.
  - `cdn.shopify.com` joins the panel's CSP `resourceDomains` so Shopify imagery actually loads. Other vendors host product images on the merchant's own domain, which is per-connection and cannot be known when the resource is built — those cards show the placeholder. Making that allowlist org-aware is follow-up work.
  - The `skill://commerce/answer-product-questions` skill now tells the agent what the gallery already shows, so prose stops restating prices and links, stops promising a count it hasn't verified, and names missing specs (weights, materials) as absent from the product feed rather than inferring them.

  No migration: `conv_messages.metadata` is existing jsonb.

- Updated dependencies [62776e2]
- Updated dependencies [0ac33df]
- Updated dependencies [09a2eeb]
  - @getmunin/dashboard-pages@4.73.0
  - @getmunin/types@4.73.0
  - @getmunin/ui@4.73.0

## 4.72.0

### Minor Changes

- c81065d: Serve MCP protocol revision 2026-07-28 alongside 2025-11-25

  `/mcp` now speaks both protocol eras from the same endpoint. Modern clients get the
  stateless 2026-07-28 revision (no `initialize` handshake, no `Mcp-Session-Id`,
  `server/discover`, per-request `_meta` envelope, `Mcp-Method`/`Mcp-Name` header
  validation); existing 2025-era clients keep working unchanged.

  - Migrated from `@modelcontextprotocol/sdk` v1 to the v2 package split
    (`@modelcontextprotocol/{server,client,node}`). `createMcpServer` now returns a v2
    `Server`, and the HTTP entry is `createMcpHandler` + `toNodeHandler` instead of
    `StreamableHTTPServerTransport`. **Breaking for anyone embedding
    `@getmunin/mcp-toolkit` directly.**
  - `tools/list`, `resources/list` and `resources/read` advertise `ttlMs` /
    `cacheScope` on the 2026 revision, scoped `private` because listings are filtered
    per actor audience and scopes.
  - `tools/list` is now returned in a stable, name-sorted order so clients can cache it.
  - POSTs to `/mcp` whose `Content-Type` media type is not `application/json` are
    rejected with `415 Unsupported Media Type` (SDK v2 parses the header instead of
    substring-matching it). MCP SDK clients always send `application/json`; parameters
    like `charset=utf-8` continue to work.
  - The authorization server advertises
    `authorization_response_iss_parameter_supported` (RFC 9207 / SEP-2468), which
    BetterAuth already emits, and derives its BetterAuth `baseUrl` from
    `authorizationServerUrl()` so the advertised issuer and the emitted `iss` cannot
    drift apart.

### Patch Changes

- Updated dependencies [f7113e4]
- Updated dependencies [064cd7b]
- Updated dependencies [a567576]
  - @getmunin/dashboard-pages@4.72.0
  - @getmunin/ui@4.72.0

## 4.71.0

### Patch Changes

- @getmunin/dashboard-pages@4.71.0
- @getmunin/ui@4.71.0

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
