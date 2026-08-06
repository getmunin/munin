# @getmunin/docs-pages

## 4.80.0

### Patch Changes

- Updated dependencies [556e620]
- Updated dependencies [12dce01]
  - @getmunin/backend-core@4.80.0

## 4.79.0

### Minor Changes

- dfd3327: chat widget: `data-munin-fonts="inherit"` really adopts the page's typography, and the launcher bubble is themeable

  `data-munin-fonts` used to accept `"system"`, which did nothing to the type stack: `buildWidgetCss()`
  discarded its argument, so the only effect was skipping the `@font-face` injection and letting
  `'Munin Serif'` / `'Munin Mono'` fall through to `ui-serif` / `ui-monospace`. The widget still rendered
  serif headings and mono labels, and never picked up the host page's font — `all: initial` on the shadow
  host plus `font-family: var(--munin-sans)` on `:host` made that impossible.

  `"system"` is replaced by `"inherit"`, which does what the name says: no webfonts are downloaded and
  every string in the panel renders in the `font-family` the page applies to `<body>`. Sizes, weights and
  italics are unchanged. `"bundled"` remains the default and the designed look. An embed still passing
  `data-munin-fonts="system"` logs the usual console warning and falls back to `"bundled"`.

  The launcher bubble was hardcoded to the near-black ink of the panel header, with `data-munin-theme-color`
  only reaching the badge, links, send button and visitor bubbles. Two new attributes fix that:
  `data-munin-launcher-color` fills the bubble and `data-munin-launcher-icon-color` overrides the glyph.
  Given only a bubble color, the glyph picks whichever of ink/paper contrasts better — the same pick now
  also drives `--munin-theme-fg`, so a light `data-munin-theme-color` no longer paints near-white text on
  visitor bubbles.

  Three more gaps closed in the same pass:

  - **`data-munin-header-color`** themes the panel's top bar (org name + close button) the same way
    `data-munin-launcher-color` themes the bubble — auto-contrast text/icon, defaults to the same fixed
    chrome tone.
  - **`data-munin-color-scheme`** (`auto` default, `light`, `dark`) gives the panel a real dark mode.
    `auto` follows `prefers-color-scheme` live; `light`/`dark` pin it regardless of the visitor's OS
    setting. Only the panel body (welcome/chat/composer/cards/bubbles) inverts — the launcher, header bar
    and voice-call screen keep their fixed near-black chrome in every mode (introduced `--munin-chrome`/
    `--munin-chrome-fg`, decoupled from the `--munin-ink`/`--munin-paper` pair that now flips per scheme)
    so brand-color and dark-mode customization don't fight each other.
  - **`window.mn.widget`** exposes `open()`/`close()`/`toggle()`/`isOpen()` once the script has run, so a
    site's own "Chat with us" link (or a proactive prompt) can drive the panel instead of requiring a click
    on the launcher bubble. It's one global, so with two embeds on a page it stays bound to whichever
    mounted first and the second warns instead of silently stealing an already-wired control surface.

  Two latent bugs found while reviewing the above, both verified in a browser rather than from the source:

  - `color-scheme` was declared on `:host`, where the shadow host's inline `style="all: initial"` outranks
    it — so it computed to `normal` and every UA-rendered surface inside the panel (scrollbar track/thumb
    where scrollbars aren't overlay-style, autofill styling) stayed in light mode even with the panel fully
    dark. It now sits on `.root`, which the inline reset can't reach. The pre-existing `color-scheme: light`
    was inert for the same reason.
  - `HEX_COLOR` accepted `{3,8}` hex digits, including the 5- and 7-digit lengths CSS rejects. A typo'd
    `data-munin-header-color="#12345"` passed validation without a warning, reached CSS as an invalid token,
    and resolved to a _transparent_ header — near-white auto-contrast text on the near-white panel, so the
    org name and close button both became invisible. Now `{3,4}|{6}|{8}` only, so a bad value warns and
    falls back like every other malformed attribute.

  The panel's edge also moved to a `--munin-edge` token that inverts to a light hairline in dark mode; the
  only edge treatment was an `inset … rgba(15, 20, 25, 0.08)` hairline plus dark drop shadows, which made
  the panel dissolve entirely into a host page whose background was near `#1B1D22`. Light mode is
  byte-identical.

  Two more hardcoded colors became tokens, on opposite sides of the chrome/body split:

  - The two voice `[data-state='error']` dots used `#B91C1C` on the always-dark chrome — 2.8:1 against
    `#0F1419`, too weak for a 7px status dot. They now use a `--munin-chrome-danger` that is deliberately
    _not_ scheme-flipped (`#F87171`, ~6.6:1) because the surface under them never flips. Body-scoped
    `--munin-danger` still inverts per scheme for `.counter.over`.
  - `.pcard-shot` hardcoded `background: #fff`, a blinding tile in a dark panel. It's now `--munin-shot`:
    `#FFFFFF` in light, `#E8E4DC` in dark. It stays a _light_ tile in both because `object-fit: contain`
    letterboxes product photography that overwhelmingly assumes white — a dark tile would make
    transparent-PNG product art disappear and leave white-background JPEGs sitting in a bright rectangle.
    The `.pcard-shot-empty` placeholder is unaffected and still follows the scheme.

### Patch Changes

- Updated dependencies [a699168]
- Updated dependencies [ef55960]
- Updated dependencies [48ddaba]
- Updated dependencies [068fb46]
- Updated dependencies [dfd3327]
  - @getmunin/backend-core@4.79.0

## 4.78.0

### Patch Changes

- Updated dependencies [f3db6e6]
- Updated dependencies [fdf6734]
- Updated dependencies [1974c11]
- Updated dependencies [59634b2]
- Updated dependencies [5b4fb1a]
- Updated dependencies [992f78a]
- Updated dependencies [f5b2992]
- Updated dependencies [d78ff2a]
- Updated dependencies [f9f4d11]
- Updated dependencies [5802b45]
- Updated dependencies [180727a]
- Updated dependencies [cfa0241]
- Updated dependencies [144a49c]
  - @getmunin/backend-core@4.78.0

## 4.77.0

### Minor Changes

- cfa7b4f: refactor(outreach): first-touch replaces "initial" on the public surface

  `outreach_propose_initial_message` is now `outreach_propose_first_touch`, the campaign flag `autoDraftInitial` is now `autoDraftFirstTouch` (column `auto_draft_initial` → `auto_draft_first_touch`), and the three skills `skill://outreach/draft-initial-{email,sms,call}` are now `skill://outreach/draft-first-touch-{email,sms,call}`.

  The three propose tools file the three proposal kinds (`initial`, `reply`, `followup`), but only the first carried a medium in its name — `_message` was filler to make `outreach_propose_initial` grammatical, and inaccurate besides: the tool also files the script for an outbound voice call, which is not a message. Its description now says "first-touch outreach draft", the neutral term the input schema already uses (`draftSubject` / `draftBody`). The campaign flag had the same defect: `autoDraftInitial` paired with `autoDraftReplies` put a bare adjective next to a noun, while the surrounding descriptions had already switched to saying "first-touch".

  The weekly scheduled sweep follows: it is now `curator-outreach-first-touch`, reads `MUNIN_CURATOR_OUTREACH_FIRST_TOUCH_CRON`, and enqueues under the dedupe key `outreach-first-touch:scheduled`.

  Internals that track the stored kind keep `initial`: the `outreach_proposals.kind` value and `OutreachService.proposeInitial`.

  Breaking, with no aliases published:

  - callers that hardcode `outreach_propose_initial_message`
  - callers that send or read `autoDraftInitial` on `outreach_create_campaign` / `outreach_update_campaign` / `outreach_list_campaigns`
  - callers that read the old `skill://outreach/draft-initial-*` URIs via `skills_read` / `resources/read`
  - self-hosters who set `MUNIN_CURATOR_OUTREACH_INITIAL_CRON` — the old name is ignored and the sweep silently reverts to its weekly default, so rename it
  - campaign JSON exported before this release fails `outreach_import` validation on the renamed field

  Migration `0059_outreach_first_touch_rename` renames the column in place, so stored per-campaign values survive, and carries the persisted curator queue across. `job_uri`, `dedupe_key` and `source_event_type` are rewritten on every row — they point at things that were renamed, so history stays queryable and a pending row still dedupes against the next scheduled enqueue. `user_prompt` is rewritten only for `status = 'pending'` rows: the scheduler persists its prompt verbatim at enqueue time, so a queued job would otherwise wake up naming a tool and a skill that no longer exist, while a finished job's prompt is the record of what it was actually told. Every step is guarded and safe to re-run.

### Patch Changes

- 688db03: Dim the page behind the open mobile section-nav dropdown in the developer portal, and close it on a tap outside — the panel previously floated over undimmed content, unlike every dialog in the product.
- Updated dependencies [2d14917]
- Updated dependencies [cfa7b4f]
- Updated dependencies [d0d3d28]
  - @getmunin/backend-core@4.77.0

## 4.76.0

### Minor Changes

- 1461e0e: Rename MCP tools so a tool's name says which surface it acts on, and add a test that keeps names and titles in agreement

  The channel tools were the worst offenders: `conv_test_channel` and `conv_send_channel_test` sounded universal but only resolve vendors in the voice/SMS adapter registry, so calling either on an email channel failed with `unknown channel vendor 'smtp'`. Meanwhile `conv_create_channel` sounded universal but only handles email and chat. The unqualified names were the narrow ones, and three verbs (`create` / `setup` / `configure`) meant the same action across three channel families. Renames:

  - `conv_setup_email_channel` → `conv_configure_email_channel`
  - `conv_send_email_test` → `conv_send_email_channel_test`
  - `conv_widget_create_channel` → `conv_create_widget_channel`
  - `conv_widget_update_channel` → `conv_update_widget_channel`
  - `conv_widget_rotate_key` → `conv_rotate_widget_key`
  - `conv_widget_rotate_identity_secret` → `conv_rotate_widget_identity_secret`
  - `conv_configure_channel` → `conv_configure_voice_sms_channel`
  - `conv_test_channel` → `conv_test_voice_sms_channel`
  - `conv_send_channel_test` → `conv_send_voice_sms_channel_test`
  - `conv_list_channel_vendors` → `conv_list_voice_sms_vendors`

  `conv_create_channel` now rejects `voice` and `sms` at the schema instead of asking the model not to pass them. Taking that path used to insert a row with `active: true`, no adapter binding and no credential link — a channel that looked configured and could not send. `conv_import` still accepts all four types, since importing historical conversations is not the same as provisioning transport.

  Elsewhere the same operation carried different verbs, and four singular/plural pairs were distinguished by one letter where the rest of the surface uses `get_X` / `list_Xs`:

  - `crm_find_contact` → `crm_lookup_contact` (matches the connector modules' `lookup` for keyed-by-email reads)
  - `bookings_lookup_bookings` → `bookings_list_guest_bookings`
  - `bookings_get_my_bookings` → `bookings_list_my_bookings`
  - `commerce_lookup_orders` → `commerce_list_customer_orders`
  - `commerce_get_my_orders` → `commerce_list_my_orders`
  - `crm_change_stage` → `crm_change_deal_stage`
  - `cms_search` → `cms_search_entries`
  - `slack_test` → `slack_send_test_message`
  - `kb_import_website_status` → `kb_get_website_import_status`
  - `outreach_propose_initial` → `outreach_propose_initial_message`
  - `analytics_get_traffic_by_source` → `analytics_list_traffic_sources`
  - `feedback_get` → `feedback_get_item`, `feedback_create` → `feedback_create_item`, `feedback_list` → `feedback_list_pending_items`, `feedback_search` → `feedback_search_roadmap`, `feedback_vote` → `feedback_vote_on_roadmap_item`

  The `feedback_*` prefix covered two unrelated corpora with nothing in the names to say so: `feedback_list` reads the local outbox awaiting admin action, while `feedback_search` queries the public Munin roadmap.

  Descriptions that no longer matched behaviour are corrected. `outreach_propose_initial_message` and `outreach_approve_proposal` still described email-only sends after SMS and voice campaigns shipped; approving now documents an email, an SMS, or an outbound call, and `outreach_propose_followup` states that sequences are email-only. `conv_list_channels` claimed `voice` and `sms` were "reserved for upcoming adapters" — both have shipped. `conv_request_channel_credentials` is generically named and generically implemented but claimed to be email-only, so an agent holding a pending Twilio channel would have skipped the one tool that mints its credential link.

  Titles now restate their tool's name rather than drifting from it — they are what a host shows in a permission prompt. Analytics titles were noun phrases ("Top referrer hosts") where the rest of the surface is imperative, and the bookings titles said "Book a table" for a vendor-agnostic bookings contract that also serves non-restaurant venues.

  `tool-naming.test.ts` boots the registry and asserts, across every registered tool, that names carry a known module prefix, that titles start with that module's display prefix, that a title's leading word matches the verb in its name, that a title mentions the object its name acts on, and that no two tools share a title. It caught three tools this pass that the manual review missed: `conv_widget_rotate_key` and `conv_widget_rotate_identity_secret` kept the family-before-verb shape, `conv_request_callback` was titled "Place a phone call…" against a name that promises a request, and `analytics_export_config` was titled "Export trackers + visitor identities" — accurate about the payload, silent about the `config` its name promises.

### Patch Changes

- Updated dependencies [1461e0e]
  - @getmunin/backend-core@4.76.0

## 4.75.0

### Patch Changes

- Updated dependencies [c5a05c5]
- Updated dependencies [cc87bb6]
- Updated dependencies [3269f5c]
- Updated dependencies [b98f618]
- Updated dependencies [862b055]
- Updated dependencies [77820b0]
- Updated dependencies [eedcba5]
- Updated dependencies [c5a05c5]
- Updated dependencies [c5a05c5]
  - @getmunin/backend-core@4.75.0

## 4.74.0

### Patch Changes

- Updated dependencies [cad7227]
- Updated dependencies [0d6a0ce]
  - @getmunin/backend-core@4.74.0

## 4.73.0

### Patch Changes

- Updated dependencies [62776e2]
- Updated dependencies [62776e2]
- Updated dependencies [0ac33df]
- Updated dependencies [0ac33df]
  - @getmunin/backend-core@4.73.0

## 4.72.0

### Patch Changes

- Updated dependencies [852ba5c]
- Updated dependencies [f7113e4]
- Updated dependencies [58abfbc]
- Updated dependencies [c81065d]
- Updated dependencies [45b8b7c]
- Updated dependencies [1b52a3e]
  - @getmunin/backend-core@4.72.0

## 4.71.0

### Patch Changes

- Updated dependencies [426a66e]
- Updated dependencies [0b864a4]
- Updated dependencies [5b49ac1]
  - @getmunin/backend-core@4.71.0

## 4.70.1

### Patch Changes

- Updated dependencies [ff032db]
  - @getmunin/backend-core@4.70.1

## 4.70.0

### Patch Changes

- Updated dependencies [5cb5ff3]
- Updated dependencies [4601314]
- Updated dependencies [e123820]
  - @getmunin/backend-core@4.70.0

## 4.69.3

### Patch Changes

- Updated dependencies [137fe87]
  - @getmunin/backend-core@4.69.3

## 4.69.2

### Patch Changes

- Updated dependencies [5b82be8]
  - @getmunin/backend-core@4.69.2

## 4.69.1

### Patch Changes

- Updated dependencies [2d118b3]
  - @getmunin/backend-core@4.69.1

## 4.69.0

### Patch Changes

- Updated dependencies [352ba3e]
- Updated dependencies [dcf7022]
- Updated dependencies [7078b30]
- Updated dependencies [2f2ea9e]
- Updated dependencies [277080c]
- Updated dependencies [18dc6a6]
- Updated dependencies [6f31549]
  - @getmunin/backend-core@4.69.0

## 4.68.0

### Patch Changes

- Updated dependencies [8116ea6]
- Updated dependencies [c48d768]
- Updated dependencies [ab212f4]
- Updated dependencies [129e6e7]
- Updated dependencies [3870f04]
- Updated dependencies [1482bbe]
- Updated dependencies [8da0e90]
- Updated dependencies [2b3db51]
- Updated dependencies [491186c]
- Updated dependencies [cdff1ad]
- Updated dependencies [cdff1ad]
- Updated dependencies [cdff1ad]
- Updated dependencies [8037e74]
- Updated dependencies [cdff1ad]
- Updated dependencies [3677620]
- Updated dependencies [8788bd4]
  - @getmunin/backend-core@4.68.0

## 4.67.2

### Patch Changes

- Updated dependencies [fbb276c]
  - @getmunin/backend-core@4.67.2

## 4.67.1

### Patch Changes

- @getmunin/backend-core@4.67.1

## 4.67.0

### Patch Changes

- Updated dependencies [eead33b]
  - @getmunin/backend-core@4.67.0

## 4.66.1

### Patch Changes

- 47d67aa: widget: add `data-munin-cookie-domain` so a conversation can be shared across sibling subdomains

  The session and visitor ids are kept in `localStorage` with a cookie fallback, and both were host-only — a chat started on `www.example.com` did not carry over to `app.example.com`. Setting `data-munin-cookie-domain=".example.com"` now writes the session + visitor cookies with that `Domain`, so both subdomains read the same ids and the anonymous thread is claimed when the visitor signs in on the app. The value must be a suffix of the page's host or it is ignored (a rejected `Domain` would silently break persistence). Default behavior is unchanged (host-only).

- Updated dependencies [d266e86]
- Updated dependencies [47d67aa]
  - @getmunin/backend-core@4.66.1

## 4.66.0

### Patch Changes

- fb104ce: fix(docs): use the real `mn_admin_` admin key prefix in MCP connect guides and setup placeholder (was the non-existent `mn_live_`)
- Updated dependencies [44a9d34]
- Updated dependencies [abeb2ef]
- Updated dependencies [37c95e9]
  - @getmunin/backend-core@4.66.0

## 4.65.0

### Patch Changes

- Updated dependencies [07f1d6e]
  - @getmunin/backend-core@4.65.0

## 4.64.0

### Patch Changes

- Updated dependencies [3387922]
- Updated dependencies [1823364]
  - @getmunin/backend-core@4.64.0

## 4.63.1

### Patch Changes

- Updated dependencies [8c8b89c]
  - @getmunin/backend-core@4.63.1

## 4.63.0

### Patch Changes

- Updated dependencies [cadc2c8]
- Updated dependencies [5902396]
- Updated dependencies [834138e]
  - @getmunin/backend-core@4.63.0

## 4.62.1

### Patch Changes

- @getmunin/backend-core@4.62.1

## 4.62.0

### Patch Changes

- Updated dependencies [73491b2]
- Updated dependencies [398077b]
- Updated dependencies [4d7d83a]
- Updated dependencies [5f7319d]
  - @getmunin/backend-core@4.62.0

## 4.61.1

### Patch Changes

- @getmunin/backend-core@4.61.1

## 4.61.0

### Patch Changes

- Updated dependencies [86bf3d0]
- Updated dependencies [f92d186]
- Updated dependencies [8e0d50e]
  - @getmunin/backend-core@4.61.0

## 4.60.0

### Patch Changes

- Updated dependencies [c713b77]
- Updated dependencies [84ee716]
- Updated dependencies [a393617]
- Updated dependencies [6719043]
  - @getmunin/backend-core@4.60.0

## 4.59.2

### Patch Changes

- Updated dependencies [0d4aef1]
- Updated dependencies [39443cb]
- Updated dependencies [6f941e1]
  - @getmunin/backend-core@4.59.2

## 4.59.1

### Patch Changes

- Updated dependencies [7c3fa39]
- Updated dependencies [1940b63]
- Updated dependencies [b8c162b]
  - @getmunin/backend-core@4.59.1

## 4.59.0

### Patch Changes

- Updated dependencies [2e3b87a]
- Updated dependencies [0fb358d]
  - @getmunin/backend-core@4.59.0

## 4.58.0

### Patch Changes

- Updated dependencies [cd6b338]
  - @getmunin/backend-core@4.58.0

## 4.57.1

### Patch Changes

- @getmunin/backend-core@4.57.1

## 4.57.0

### Patch Changes

- Updated dependencies [3ce6c5d]
- Updated dependencies [4c3a9f7]
  - @getmunin/backend-core@4.57.0

## 4.56.1

### Patch Changes

- @getmunin/backend-core@4.56.1

## 4.56.0

### Patch Changes

- Updated dependencies [2d69094]
  - @getmunin/backend-core@4.56.0

## 4.55.0

### Patch Changes

- @getmunin/backend-core@4.55.0

## 4.54.0

### Patch Changes

- @getmunin/backend-core@4.54.0

## 4.53.0

### Patch Changes

- Updated dependencies [c3a62e1]
- Updated dependencies [95f2983]
- Updated dependencies [82fef68]
  - @getmunin/backend-core@4.53.0

## 4.52.1

### Patch Changes

- 2669ca2: Fix the developer-portal docs on mobile. The decorative 320px sidebar-column fill (`.docs-body::before`) was painting an opaque stripe over the article on phones — `:has(.docs-side)` still matched the in-DOM sidebar even though it was `display:none` — leaving content clipped against the right edge. The stripe is now hidden below 880px, and each section's sidebar (REST endpoints, MCP tools, guides, skills) becomes a collapsible "Browse…" dropdown so in-section navigation works on mobile instead of disappearing.
  - @getmunin/backend-core@4.52.1

## 4.52.0

### Patch Changes

- Updated dependencies [72869c4]
- Updated dependencies [e0a87c0]
  - @getmunin/backend-core@4.52.0

## 4.51.4

### Patch Changes

- @getmunin/backend-core@4.51.4

## 4.51.3

### Patch Changes

- Updated dependencies [139d00e]
- Updated dependencies [0cc9260]
  - @getmunin/backend-core@4.51.3

## 4.51.2

### Patch Changes

- Updated dependencies [657b2bf]
  - @getmunin/backend-core@4.51.2

## 4.51.1

### Patch Changes

- @getmunin/backend-core@4.51.1

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
