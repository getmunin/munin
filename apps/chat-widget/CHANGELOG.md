# @getmunin/chat-widget

## 5.23.3

### Patch Changes

- @getmunin/types@5.23.3

## 5.23.2

### Patch Changes

- @getmunin/types@5.23.2

## 5.23.1

### Patch Changes

- @getmunin/types@5.23.1

## 5.23.0

### Patch Changes

- @getmunin/types@5.23.0

## 5.22.0

### Patch Changes

- @getmunin/types@5.22.0

## 5.21.0

### Minor Changes

- 0817af4: Let chat-widget visitors send images, and render the ones sent back to them.

  Two new widget routes sit on top of the attachment store: `POST /v1/widget/attachments` hands out
  a presigned target and `POST /v1/widget/attachments/:id/complete` confirms the bytes. Both go
  through the same key-to-channel check and origin allowlist as ingest, and both pass the caller's
  `sessionId` into `ConvAttachmentsService`, so a visitor can only complete an upload their own
  session requested. `WidgetIngestMessage.attachmentIds` links completed uploads at send time via
  `attachToMessage`, which re-validates ownership, conversation match and upload completion — a
  client-supplied id is never trusted, and an id belonging to another session or another
  conversation is refused rather than silently dropped.

  A message may now carry attachments with an empty `body`; previously `body` was required, which
  made an image-only message impossible to express. A message with neither is still rejected.

  `GET /v1/widget/messages` returns an `attachments` array per message, so outbound agent and human
  images render in the widget too. Realtime already signals only a `messageId` and the widget
  refetches, so no gateway change was needed. A tombstoned attachment serializes as
  `deleted: true` with null URLs and the widget shows a placeholder — a deleted image never
  degrades into a broken one.

  In the bundle, images can be attached from a composer button, pasted from the clipboard or dropped
  onto the panel, are downscaled and re-encoded to WebP in the browser before upload, and render as
  tappable bubbles with a lightbox. The downscale mirrors the dashboard's `prepareImageForUpload`
  rather than importing it, because the widget ships as a standalone bundle.

### Patch Changes

- b787e96: Share one set of attachment limits between the server and both clients, and validate uploads in the
  dashboard composer before they leave the browser.

  The allowlist, the 10 MB cap and the per-message maximum existed in two places — the server's
  `conv-attachments.constants.ts` and the widget's `upload.ts` — and in neither for the dashboard,
  which reused `lib/upload-image.ts`, the CMS asset helper (SVG allowed, no size cap). A wrong file
  type was silently dropped, an oversized one round-tripped to the server and came back as a bare
  "Upload failed", and nothing enforced the per-message cap client-side. An SVG was the sharp edge: it
  passed the `image/*` filter, uploaded untouched, then failed the server allowlist with no hint why.

  `@getmunin/types` now owns `CONV_ATTACHMENT_*` plus `attachmentRejectionFor`, and all three callers
  read from it. The dashboard checks type, size and count up front and reports each rejection through
  the conversation pane's existing `role="alert"` banner rather than a second, quieter channel — so an
  attachment failure now reads like every other action failure in that pane. Attachment deletion also
  stops reporting itself as "Send failed": `QueueActionType` gains `attach`.

  Icons in the attachment UI stop being characters. The removed-attachment chip swaps its 🚫 emoji for
  lucide's `ImageOff`, and both remove buttons swap `✕` for lucide's `X`, so all three render in the
  pane's own ink and follow dark mode instead of leaning on the platform emoji and text fonts. The
  widget inlines the same `X` geometry — it draws into a shadow root and cannot import from
  lucide-react — so its chip control stays visually matched to the dashboard's.

- b787e96: Make the widget's composer error behave like the dashboard's, and stop losing failed sends in the
  console.

  The composer note was a bare red line that erased itself after five seconds, so the reason a file
  was rejected disappeared while its error chip stayed on screen. It is now a dismissible alert — dot,
  message, Close — carrying `role="alert"` so assistive tech announces it, and it persists until the
  visitor dismisses it or sends the message. A message that fails to send used to be `console.warn`
  only, invisible to the visitor; it now surfaces in the same note.

  The attachment chip's remove control also picks up the dashboard's affordance — the same `✕` glyph
  on a translucent paper pill in muted ink, instead of a filled dark circle with an SVG cross.

- b787e96: Clear the chat widget's drop hint when a drag leaves the panel without dropping.

  The `dragleave` handler decided whether the drag had really left by inspecting `e.target`, but
  `dragleave` fires on the element being left and bubbles, so the last event before the pointer exits
  the panel almost always targets a descendant — a message bubble, the message list — not `.chat`
  itself. The old guard read that as an internal move and returned early, leaving "Slipp bildet her"
  covering the conversation until the next drag. It now keys off `e.relatedTarget`, the node being
  entered: still inside `.chat` means an internal move, anything else (including `null` when the drag
  leaves the window) hides the hint.

- 9b48cf5: fix(widget): the voice call screen names the org's assistant

  The voice overlay and its minimized banner had exactly two cases: a human took
  over (use `assigneeName`) or it's the AI, in which case they fell back to the
  localized `defaultAuthorName` — "Agent" in every locale. An org that named its
  assistant Thea saw "Thea" in the chat transcript and "Agent" the moment the
  caller switched to voice.

  The name was already resolved server-side, but only per message: list-messages
  stamped `assistants.name` on each agent message's `authorName` and never put it
  on the conversation envelope, which is all the overlay reads. `agentName` now
  rides along on the envelope (falling back to `Munin`, matching the per-message
  behaviour), and the widget prefers it over the generic string. A human assignee
  still wins once the conversation is handed over.

  The lookup also no longer waits for an agent message to exist, so a brand-new
  conversation — the common case for starting a call before the assistant has said
  anything — has the name available on its first load.

- Updated dependencies [b787e96]
  - @getmunin/types@5.21.0

## 5.20.0

### Patch Changes

- @getmunin/types@5.20.0

## 5.19.0

### Patch Changes

- @getmunin/types@5.19.0

## 5.18.0

### Minor Changes

- 56a3349: Bring the palette up to WCAG 2.2 AA

  Five token pairs failed AA where they actually meet in components. Measured against every
  surface each token lands on, not just the one it was tuned against.

  **Mute text.** `--munin-fg-3` (`#7E8590`) reached 3.56:1 on paper, 3.21 on paper-deep and
  2.93 on bone — below even the 3:1 large-text floor — across 250 uses of `text-ink-mute`, 116
  of them at `text-xs` or smaller, plus every `Label` and every `Input` placeholder. Now
  `#5E646C` (4.71 on bone, its binding surface). Light and dark needed opposite moves: the
  light value lands at 3.24:1 on ink, so dark gets its own `--munin-fg-3: #868D97`, which also
  fixes a separate 4.26:1 failure on the dark `--secondary` sidebar that the old shared value
  had. The chat widget keeps a literal copy of the same grey across 20 rules and moves with it.

  **Field boundaries.** `Input` drew its edge with `border-rule-soft` (`ink / 0.09`, 1.20:1)
  on `bg-paper` inside a `Card` that is also `bg-paper` — nothing identified the field, failing
  1.4.11. Adds `--munin-rule-field`, which form controls use while cards, dividers and
  hairlines keep the decorative 0.09 rule. Light mode takes the solid ink edge the chat widget
  already shipped; dark takes `fg-on-dark-2 / 0.36` (3.06:1). The same override in the widget's
  dark palette had dropped its own fix back to 1.50:1, and the focused border is identical to
  the resting one, so focus rested entirely on the outline below.

  **Cobalt.** `#0066FF` was tuned on paper (4.63:1) and used at 8.5–11px on paper-deep (4.17)
  and bone (3.81). Now `#0059DE`, which also lifts paper-on-accent from 4.63 to 5.78.

  **Widget brand colour.** `themeColor` arrives from the customer and was used raw as the active
  send icon and as the only focus outline on the composer and card forms — amber `#F59E0B` put
  those at 2.06:1. Adds `contrastFloor()`, which darkens or lightens along the colour's own hue
  only until it reaches 3:1 against the surface and returns a passing colour untouched. Also
  fixes `.launcher-badge`, which hardcoded `#fff` over the brand colour (1.30:1 on a light one)
  instead of the contrast-picked `--munin-theme-fg`.

  **Verdigris.** The counterparty hue is identity text in the widget, not only a fill: 4.38:1 on
  paper and 4.04:1 on its own tint. Now `#1B7153`.

  The widget's default `themeColor` tracks cobalt to `#0059DE` so the brand blue is one value
  across the product rather than two that differ by a contrast fix. It is a fill with
  `--munin-theme-fg` on top, so it passed either way — this is consistency, not a contrast
  repair. The `data-munin-theme-color` docs and the `setup-chat-widget` skill move with it.

  `readableOn()` guaranteed only a 4.21:1 floor, because best-of-two across ink and paper bottoms
  out at their crossover. It now falls through to black or white — whichever the background
  actually favours — when neither palette value clears AA, raising the floor to exactly 4.50:1,
  verified by sweeping 132k backgrounds. Picking the extreme on the same side as the palette
  winner is wrong near the crossover and was the first version of this fix.

  `--destructive` went `#b53d3d` → `#b23b3b` to clear 4.48:1 on bone.

  Unchanged and re-verified: every dark-mode pair outside the mute finding, both identity
  bubbles, all button fills, the alert and invite pairs, and both focus rings.

### Patch Changes

- @getmunin/types@5.18.0

## 5.17.0

### Patch Changes

- @getmunin/types@5.17.0

## 5.16.0

### Minor Changes

- a9d71da: Apply the design system's conversation identity colours to the admin thread and the chat widget.

  One colour per role, never per mood: **you are ink** (`#0F1419`), **the counterparty is verdigris** (`#208562`, bubble tint `#E3F5EC`), and **the agent is hueless** (`#7E8590` on `#DCE2E8`) because it is not a person. Cobalt is now reserved entirely for emphasis and actions — it is an action, not an identity.

  Both surfaces previously shipped the variant the design system rejected: the admin thread painted your own messages cobalt, so your own bubble competed with the only cobalt that should matter (the approve action), while the agent wore ink and the counterparty — the one role that must carry a hue — was plain paper. The widget did the same via `--munin-theme`, and painted human operators identically to the AI.

  Details:

  - New `verdigris` and `agent-tint` token families in `@getmunin/ui`. Self needed no new tokens — `--munin-ink` and `--munin-fg-3` were already exactly the specified values.
  - The agent tint is `#DCE2E8` (`#1E252C` on ink), not paper-deep. The agent has no hue to spend, so its tint spends temperature instead: every Munin surface is warm, the agent tint is cool. Paper-deep was the failing case — the admin thread is itself wrapped in `bg-paper-deep`, so the agent bubble sat at Lab ΔE 0.0 against its own background and survived only on its hairline border. The cool grey lifts the worst of the four surfaces to ΔE 8.1 (paper 10.1, paper-deep 8.1, bone 8.1, ink 8.4). Note that WCAG luminance ratio cannot measure this — on bone the two are near-equiluminant (1.03:1) and separate entirely on the b\* axis, which is the point.
  - Direction still decides which side a message sits on; only colour carries identity, so a colleague's message sits on the outbound side wearing verdigris rather than your ink. The thread stays avatar-less — the bubble fill and the existing name label carry the role between them.
  - Self is resolved against the viewer (`viewerUserId`) rather than `authorType === 'user'`, so a colleague is correctly "other" instead of borrowing your identity. When the viewer is unknown, staff fall back to self and the ring is suppressed entirely — an unresolved session must not invert the rule and paint your own messages as the counterparty, which is a worse failure than the flat staff bucket it replaced.
  - Participant ring: with three or more humans in a thread, the non-self humans take `oklch(0.55 0.105 h)` at hues 165 / 32 / 210 / 75 / 315 in order of first appearance — fixed lightness and chroma, hue only. Under three humans the counterparty keeps the verdigris token. The agent never counts toward the threshold and never takes a hue.
  - The viewer counts toward that threshold even when they have not posted in the thread, because they are a participant in any conversation they are reading. Counting only authors leaves a two-author thread — one customer, one colleague — below the threshold, so both render flat verdigris and a teammate is indistinguishable from the customer, which is the exact collision the ring exists to prevent.
  - A ring participant's hue tints their name label as well as their bubble. With no avatar in the thread the bubble is the only other carrier, and two ring hues at a 12% tint are too close to tell apart at a glance.
  - Widget self bubbles come off the tenant's `themeColor` entirely; that colour keeps the action surfaces (send button, email-capture button, focus rings). Human operators get the verdigris tint, split off the AI via the `authorKind` the widget already receives, and both keep their name and role label — the visitor is told who is answering.
  - **The widget takes quiet self, not the filled ink bubble.** Self-as-ink collided with the widget's own chrome — the ink title bar and the visitor's bubble were the same hex, so their message read as a chip that fell off the header, and the answer they opened the widget to read was the palest thing on screen. Widget-side the visitor now takes `--munin-self-tint` (bone / `#272C33`) with ink text and a 2px corner on the authoring side; side and corner carry authorship, and the title bar keeps ink as the widget's one constant. The admin thread is unchanged — there, self staying a filled ink bubble is right, because no ink chrome competes with it.
  - Chrome geometry is now a five-step radius scale (`--munin-r-panel` / `-surface` / `-control` / `-tag` / `-pill`) driven by a new `data-munin-corners` embed attribute: `square` (default — sharp corners on every panel, field and button, radius only on bubbles) or `rounded`, which restores the previous radii. Bubbles keep their radius in both, and the mobile full-screen panel stays square regardless.
  - Cobalt is now actions only: send, the email-capture button, and focus rings. It is no longer a bubble fill, a link colour inside a bubble, or a presence dot — the dots take verdigris, and on dark the send arrow lightens to a 50% mix of the tenant colour so it stays legible on ink without abandoning the tenant's hue.
  - The widget's dark scheme moves onto ink (`--munin-paper` `#101418`, `--munin-paper-deep` `#1F252B`) so a dark host page gets a panel that reads as one surface rather than a grey card on black.
  - The welcome screen no longer claims a reply time. `welcomeRepliesAboutHtml` ("Replies in about **2 min**") was hardcoded in all 21 locales, backed by nothing, and wrong in both directions — seconds on an auto channel, hours once a human takes over. It is now `welcomeRepliesInstantly`, transcreated per locale, true because a widget channel always answers with the AI first, and escaped rather than interpolated as raw HTML.

  Two extrapolations beyond the spec, which only gives light-mode fills: dark-mode counterparty values (`#62C39C`, with the widget's dark verdigris bubble opaque at `#1B382A` and the admin thread's translucent), and ring bubble tints derived as a 12% `color-mix` of the participant's ring colour so a single hue drives both bubble and label in either scheme.

### Patch Changes

- Updated dependencies [d443f42]
- Updated dependencies [356885c]
  - @getmunin/types@5.16.0

## 5.15.0

### Minor Changes

- c4bd6f4: fix(realtime): name why a widget socket was refused, and keep chat alive when identity is wrong

  A widget socket whose identity was rejected got a bare `401` with no body — indistinguishable from a bad widget key, and unreadable from a browser. The handshake now answers identity and origin refusals as `403` with the code in an `X-Munin-Error` header and a `{"code":"…"}` body (`identity_partial`, `identity_verification_failed`, `identity_required`, `origin_required`, `origin_not_allowed`); `401` now means only that the credential itself failed. The socket also accepts `verifiedExternalId` as an alias for its `externalId` param, so one field name works across the socket, the ingest body and the `x-munin-verified-external-id` header.

  The bundled widget no longer reconnect-loops forever on a rejected identity: after three handshakes that never open it drops the identity params, reconnects anonymously and warns on the console, so replies keep streaming while the secret is fixed. It re-arms the identity if the anonymous socket also fails to open (that is a network fault, not a bad hash), on the next `window.mn.widget.identify`, and on page load. `skill://conv/setup-chat-widget` now documents the socket params, the refusal codes, and the per-channel nature of the identity secret — an org with dev and prod widget channels has two secrets, and signing with the wrong one is what makes a widget send fine yet never receive.

### Patch Changes

- 3252cd1: Bump Next.js to 16.3.4 and other dependencies to their latest compatible minor/patch versions.
- Updated dependencies [3252cd1]
  - @getmunin/types@5.15.0

## 5.14.0

### Patch Changes

- Updated dependencies [a5acd6c]
- Updated dependencies [80d6f34]
- Updated dependencies [701413c]
  - @getmunin/types@5.14.0

## 5.13.1

### Patch Changes

- @getmunin/types@5.13.1

## 5.13.0

### Patch Changes

- @getmunin/types@5.13.0

## 5.12.0

### Minor Changes

- c7039b9: Widget speaks eight more languages: Estonian, Latvian, Lithuanian, Czech, Slovak, Hungarian,
  Romanian and Nynorsk.

  The set was Nordics + Western Europe + Polish, which left conspicuous holes: the Baltics, where a
  Nordic-first product's customers already operate as one region, and Central Europe, where Polish was
  in but its neighbours were not. Twenty-one locales now ship: `en nb nn da sv fi is et lv lt de fr es
it pt nl pl cs sk hu ro`.

  Nynorsk is the odd one out and the cheapest: it was previously _aliased away_ — `nn`, `nno` and `nn-NO`
  all resolved to Bokmål. It now has its own strings, so `nn` gets Nynorsk while `no`, `nob` and `nor`
  stay on Bokmål. Norwegian public bodies are obliged to serve both written standards, which makes this
  closer to a requirement than a nicety for public-sector deals.

  Locales are statically imported, so every visitor downloads every language. Measured cost of the
  eight: **+4.4 KB gzipped** on the widget bundle (174.1 → 178.6 KB), about 0.55 KB per language.

  `FALLBACK_LOCALES` in `@getmunin/agent-runtime` mirrors the widget list and moves with it, so the
  runtime's canned greeting and handover notice speak the new languages too rather than silently
  dropping to English. The chat-widget guide documents `data-munin-locale` for the first time — the
  attribute has existed since the widget shipped, was described in `skill://conv/setup-chat-widget`,
  and was missing from the human-facing optional-attributes list.

  Translation notes worth a native reviewer's eye before this reaches production traffic: register is
  informal for Estonian and Nynorsk, polite for Latvian, Lithuanian, Czech, Slovak, Hungarian and
  Romanian, matching how support desks in each market actually address customers. Where a template
  interpolates an agent's name into a case-inflecting language, the copy uses a colon form
  (`Kõne: {who}`, `Hovor: {who}`, `Hívás: {who}`) rather than a preposition that would demand a
  declined name. The Romanian month abbreviation `{n} l` and the Estonian `{n} k` are the two terse
  relative-time strings most likely to want a second opinion.

### Patch Changes

- @getmunin/types@5.12.0

## 5.11.0

### Patch Changes

- @getmunin/types@5.11.0

## 5.10.0

### Patch Changes

- 77e5c8b: Mark the widget's "Powered by Munin" links `rel="nofollow noopener"` and tag the href with UTM params.

  The credit link is rendered into every embedding site's template, which is exactly the pattern Google's link spam guidance calls out as a link scheme ("links embedded in widgets that get distributed across various sites", "links in the footers or templates of various sites"). Googlebot renders JS and flattens open shadow roots, so the link was discoverable and followable — carrying the manipulation risk without any realistic ranking benefit, since widget links are devalued by policy either way. `nofollow` takes that risk off the table at no cost.

  Dropping `noreferrer` is the part that gains something: it was stripping the `Referer` header, so every real click landed in analytics as direct traffic with no way to tell which embedding site sent it. With only `noopener` (which is what actually covers the `target="_blank"` security concern), clicks now carry a referrer host and show up in `analytics_list_referrer_hosts`. The href gains `utm_source=widget&utm_medium=referral&utm_campaign=powered_by` — the three params `tracker.js` reads; `utm_content` is deliberately omitted because the tracker ignores it and the referrer host already provides the per-install dimension.

  The href also points at the canonical `www.getmunin.com` rather than the apex, which 301s to it — one less redirect hop per click.

  Both call sites (welcome eyebrow and panel footer) now build the anchor from one helper, so the href and rel can't drift apart.

- Updated dependencies [3136f2b]
- Updated dependencies [3136f2b]
- Updated dependencies [b8690cb]
  - @getmunin/types@5.10.0

## 5.9.0

### Patch Changes

- @getmunin/types@5.9.0

## 5.8.0

### Patch Changes

- @getmunin/types@5.8.0

## 5.7.0

### Patch Changes

- @getmunin/types@5.7.0

## 5.6.0

### Patch Changes

- @getmunin/types@5.6.0

## 5.5.0

### Patch Changes

- @getmunin/types@5.5.0

## 5.4.0

### Patch Changes

- @getmunin/types@5.4.0

## 5.3.0

### Patch Changes

- @getmunin/types@5.3.0

## 5.2.2

### Patch Changes

- @getmunin/types@5.2.2

## 5.2.1

### Patch Changes

- @getmunin/types@5.2.1

## 5.2.0

### Patch Changes

- @getmunin/types@5.2.0

## 5.1.0

### Patch Changes

- Updated dependencies [be67821]
- Updated dependencies [be67821]
  - @getmunin/types@5.1.0

## 5.0.2

### Patch Changes

- @getmunin/types@5.0.2

## 5.0.1

### Patch Changes

- @getmunin/types@5.0.1

## 5.0.0

### Major Changes

- 68748a3: Namespace the browser API: `window.mn.analytics.*` and `window.mn.widget.*`

  **Breaking.** Both bundles used to install onto `window.mn` — the tracker owned the root, the widget owned `mn.widget` _and_ leaked `identify` onto the root. Since each also chained to whatever `identify` was already there, a page running both sent one hash to two verifiers that check different payloads against different secrets, so one always rejected. That failure was lopsided and the bad half was silent: the widget logs to the console, the tracker fires `sendBeacon` and never looks at the response, leaving only `identify.rejected: hmac_mismatch` in a server log an integrator can't see. An empty contact journey with no client-side error was the only symptom.

  Each surface now owns a namespace, and the chaining is gone:

  | Before                                | After                                  |
  | ------------------------------------- | -------------------------------------- |
  | `window.mn.track(...)`                | `window.mn.analytics.track(...)`       |
  | `window.mn.trackOnce(...)`            | `window.mn.analytics.trackOnce(...)`   |
  | `window.mn.trackPageView()`           | `window.mn.analytics.trackPageView()`  |
  | `window.mn.trackSearch(...)`          | `window.mn.analytics.trackSearch(...)` |
  | `window.mn.trackEntry(...)`           | `window.mn.analytics.trackEntry(...)`  |
  | `window.mn.getVisitorId()`            | `window.mn.analytics.getVisitorId()`   |
  | `window.mn.identify(...)` _(tracker)_ | `window.mn.analytics.identify(...)`    |
  | `window.mn.identify(...)` _(widget)_  | `window.mn.widget.identify(...)`       |
  | `window.mn.ready`                     | `window.mn.analytics.ready`            |
  | `munin:ready` event                   | `munin:analytics-ready` event          |

  `window.mn.widget.open/close/toggle/isOpen` are unchanged. The widget gains `ready` and a `munin:widget-ready` event, which it never had — needed now that `identify` lives behind a namespace that only exists once the widget mounts.

  **Declarative embeds need no changes.** Every `data-*` attribute — `data-key`, `data-subject-type`, `data-mn-event`, `data-mn-once`, `data-external-id`, `data-user-hash`, `data-mn-entry-token` — works exactly as before. This is a JS-API change only, so a site that never calls `window.mn` from its own code is unaffected by the upgrade.

  **Where the break lands is unusual.** Nothing fails at deploy: the backend starts, the API is unchanged, and the new bundles serve normally. What breaks is JavaScript on the _customer's_ pages, the moment the upgraded bundle is served. Anyone calling `window.mn.*` from their own code updates the calls above; the failure is a loud `TypeError` rather than silent wrong behaviour.

  **A rejected identify is no longer silent.** `POST /v1/a/identify` used to answer `204` for every outcome, and the tracker sent it with `sendBeacon` and never read the response — so a hash signed with the wrong secret produced no client-side signal at all, only a server log the integrator couldn't see. The endpoint now answers `400 identity_invalid` / `identity_secret_missing` / `identity_hash_mismatch` and `403 identity_origin_not_allowed`, the tracker posts with `fetch(..., { keepalive: true })` and logs a console warning naming the status. An unrecognized tracker key still answers `204`, so the endpoint doesn't confirm which keys exist. Direct callers of this endpoint that assumed "always 204" should expect real status codes now.

### Patch Changes

- Updated dependencies [ace185f]
  - @getmunin/types@5.0.0

## 4.81.0

### Patch Changes

- @getmunin/types@4.81.0

## 4.80.1

### Patch Changes

- 2ea6198: Expose the widget greeting's trailing-clause emphasis as the `--munin-greeting-emphasis` custom property, defaulting to the existing serif italic. Sites that want the clause upright can now set it to `normal` from their own stylesheet: custom properties inherit across the shadow boundary, so this is the one override route that does not depend on the panel's internal class names.
  - @getmunin/types@4.80.1

## 4.80.0

### Patch Changes

- @getmunin/types@4.80.0

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

- 068fb46: Show voice transcript turns in the order they were spoken.

  Threll redelivers the full call transcript as a burst of `call.transcript` events around `call.ended`, and on a browser voice call that burst is the only delivery — no turns stream in live. Munin handled each webhook the instant it arrived, so nothing was delayed on our side, but `conv_messages.created_at` was left to its `now()` default and so recorded when the webhook was _processed_, not when the turn was spoken. Every read path orders by `created_at`, so a burst that arrived grouped by speaker rendered as every agent turn followed by every caller turn. A real call in the widget produced exactly that.

  `ThrellAdapter` now derives `created_at` from the `turnIndex` Threll already sends, anchored to the call's start (`metadata.voiceStartedAt`, falling back to the conversation's own `created_at` for inbound phone calls). `turnIndex` was already being captured into `metadata.voiceTurnIndex` and never read. It also makes the timestamp idempotent across redeliveries: the turn dedup added alongside this keeps whichever copy inserted first, and an arrival-time `created_at` meant that copy decided where the turn sorted. `handleEnded` no longer deletes `voiceStartedAt`: transcripts and `call.ended` arrive in the same burst with retries, so a straggler processed after the call closed would otherwise re-anchor to a conversation that opened days earlier and scatter those turns through the chat history. Nothing reads the field, so keeping it is free.

  Backdating `created_at` collided with the widget's incremental fetch, which is the only way a rendered conversation ever gains a message: the realtime event carries no body, it just triggers `backfillSince(lastSeenAt)`, and `lastSeenAt` is a monotonic high-water mark. The "Call ended · 00:36" separator is a real message inserted at real time, so it pushed the cursor past the entire call before the transcript burst landed — and every backdated turn then sat below the cursor and was never delivered at all. Ordering the rows correctly in the database would have traded a scrambled transcript for a missing one.

  So `created_at` is now purely the display clock and `conv_messages.ingested_at` (default `clock_timestamp()`) is the arrival clock. The widget's `since` filter and page ordering both move to `ingested_at`, the response carries an explicit `cursor` the client advances instead of inferring one from the last message's `at`, and rows are sorted by `created_at` before serialization. `clock_timestamp()` rather than `now()` because `now()` is fixed for a transaction: a batch that inserts several turns at once — Vapi's end-of-call report does — would tie on the cursor column and let keyset pagination skip rows. The server-computed cursor also advances past a page of internal-only messages, which previously stalled the `while (hasMore)` loop.

  `ui.addMessages` inserts by timestamp instead of appending, so a turn that arrives late but was spoken earlier lands in the right place without waiting for a reload.

  Existing rows inherit `created_at` as their `ingested_at`. The backfill runs inside a `bypass_rls` block because `conv_messages` is FORCE ROW LEVEL SECURITY, which applies to the table owner too — without it the `UPDATE` matches nothing on a live deploy while a fresh CI database, where the policies are applied only after migrations run, looks green.

  Vapi has the same display-ordering defect and is untouched here: `handleEndOfCallReport` inserts every turn of a report inside one transaction, so all of them share a `created_at` and `ORDER BY created_at` breaks ties arbitrarily.
  - @getmunin/types@4.79.0

## 4.78.0

### Patch Changes

- Updated dependencies [5802b45]
- Updated dependencies [180727a]
  - @getmunin/types@4.78.0

## 4.77.0

### Patch Changes

- Updated dependencies [cfa7b4f]
  - @getmunin/types@4.77.0

## 4.76.0

### Patch Changes

- Updated dependencies [1461e0e]
  - @getmunin/types@4.76.0

## 4.75.0

### Patch Changes

- Updated dependencies [c5a05c5]
- Updated dependencies [c5a05c5]
  - @getmunin/types@4.75.0

## 4.74.0

### Patch Changes

- Updated dependencies [cad7227]
  - @getmunin/types@4.74.0

## 4.73.0

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

- Updated dependencies [0ac33df]
  - @getmunin/types@4.73.0

## 4.72.0

## 4.71.0

## 4.70.1

## 4.70.0

## 4.69.3

## 4.69.2

## 4.69.1

## 4.69.0

## 4.68.0

## 4.67.2

## 4.67.1

### Patch Changes

- 824e3d7: Fix anonymous→identified chat carry-over: the widget now claims a pre-existing anonymous session on boot when configured with a verified identity (`data-external-id` + `data-user-hash`). Previously it set the in-memory identity for reads but never called `identify`, so the backend's leak-protection returned empty history for the still-anonymous session — a conversation started anonymously (e.g. on a marketing site) was invisible after logging in until the visitor sent a new message. The claim now runs once on connect, before history is loaded.

## 4.67.0

### Minor Changes

- eead33b: Security hardening from a follow-up audit.

  - **Widget session credential moved out of the URL (BREAKING):** the widget read endpoints (`GET /v1/widget/messages`, `GET /v1/widget/conversations`, `GET /v1/widget/voice/available`) no longer accept the session credential in the query string. `sessionId`, `sessionIds`, `verifiedExternalId`, and `userHash` must now be sent as the `x-munin-session-id`, `x-munin-session-ids`, `x-munin-verified-external-id`, and `x-munin-user-hash` request headers. This keeps the session token — which grants read/write on a visitor's conversation — out of server, proxy, and CDN access logs. The bundled chat widget is updated; any custom integration that called these GET endpoints must move the fields from the query string to headers.
  - **Widget origin allowlist is required by default (BREAKING):** a widget channel with an empty `originAllowlist` now rejects all traffic, and creating one without an allowlist fails, unless `MUNIN_WIDGET_REQUIRE_ALLOWLIST` is explicitly set to `0`/`false`. Previously the allowlist was only enforced when the flag was opted in. Existing widget channels without an allowlist stop accepting requests until their origins are configured (or the flag is disabled). This inverts the default to fail-closed.
  - **OAuth `mcp:admin` scope is gated by org role (BREAKING):** OAuth access tokens (opaque and JWT) issued to users whose org membership role is not `owner` or `admin` no longer carry the `mcp:admin` scope or the admin MCP audience — they resolve to the self-service surface. Previously any member who consented to an `mcp:admin` scope grant reached every admin MCP tool. Admin API keys (`mn_admin_*`) are unaffected.
  - **Channel webhook endpoint hardened:** `POST /v1/conversations/channels/:channelId/webhook` is now rate-limited (per-IP, like the other public endpoints) and returns a uniform `401` for both unknown-channel and signature-verification failures to prevent channel-id enumeration. Note: an unknown channel now returns `401` instead of `404`.

## 4.66.1

### Patch Changes

- 47d67aa: widget: add `data-munin-cookie-domain` so a conversation can be shared across sibling subdomains

  The session and visitor ids are kept in `localStorage` with a cookie fallback, and both were host-only — a chat started on `www.example.com` did not carry over to `app.example.com`. Setting `data-munin-cookie-domain=".example.com"` now writes the session + visitor cookies with that `Domain`, so both subdomains read the same ids and the anonymous thread is claimed when the visitor signs in on the app. The value must be a suffix of the page's host or it is ignored (a rejected `Domain` would silently break persistence). Default behavior is unchanged (host-only).

## 4.66.0

## 4.65.0

## 4.64.0

### Patch Changes

- 43fdff8: fix(widget): stop iCloud Passwords popover from opening on the message composer

  The composer textarea had no `autocomplete` attribute, so browsers defaulted it to `on` and the iCloud Passwords extension classified the widget as a login form (helped by the save-thread email field), offering credential autofill when typing a message. Set `autocomplete="off"` (and `autocorrect="off"`) on the composer to opt it out.

## 4.63.1

## 4.63.0

## 4.62.1

## 4.62.0

## 4.61.1

## 4.61.0

## 4.60.0

## 4.59.2

## 4.59.1

## 4.59.0

## 4.58.0

## 4.57.1

## 4.57.0

## 4.56.1

### Patch Changes

- 74780cc: Keep the composer focused after sending a message. Disabling the textarea while a send was in flight dropped its focus and re-enabling it didn't restore it, forcing the user to click back into the field before each new message. The widget now restores focus to the composer once the send completes.
- 8b7b284: Chat widget: defer the "Reconnecting…" status bar by a short grace period (1.5s) so a quick websocket reconnect no longer flashes the bar and shifts the layout. The bar now appears only if the connection stays down past the grace window, matching the admin dashboard's disconnect banner.

## 4.56.0

## 4.55.0

## 4.54.0

## 4.53.0

## 4.52.1

## 4.52.0

### Patch Changes

- ce59242: Stop mobile browsers from zooming in when the message box or email field is focused. iOS Safari auto-zooms when a focused field's font is below 16px, so text-entry fields are now 16px on touch devices.

## 4.51.4

### Patch Changes

- d14b028: Open the chat widget full-screen on small viewports (phones in portrait and landscape, plus small tablets — up to 600px wide), matching the behaviour of Intercom/Crisp. The panel now goes edge-to-edge using dynamic viewport units, respects device safe-area insets, and locks page scroll while open so the conversation is usable on small screens.

## 4.51.3

### Patch Changes

- 0cc9260: fix(widget): probe voice availability without minting a provider session

  Opening a widget conversation used to call `POST /v1/widget/voice/start` purely to decide whether to show the call button. For Threll-backed voice channels that has a side effect — it creates a web call upfront (and overwrites `threllCallId`), so every conversation open burned a Threll session that was never connected to, then a second one was minted when the visitor actually started the call.

  The availability check now has its own cheap endpoint, `GET /v1/widget/voice/available`, which runs the same validation and voice-channel routing as `voice/start` but stops at a vendor config presence check — it never creates a Threll web call or fetches a Vapi assistant. The widget's open-time probe calls it instead of `voice/start`; `voice/start` now fires only when the visitor actually starts a call.

## 4.51.2

## 4.51.1

## 4.51.0

## 4.50.1

## 4.50.0

## 4.49.0

## 4.48.0

## 4.47.0

## 4.46.0

### Patch Changes

- 32c883e: Log previously swallowed errors in widget realtime, dashboard, and voice session paths. Empty `catch {}` blocks now emit `console.warn` for socket lifecycle/fetch failures and `console.debug` for listener-loop exceptions so issues surface during debugging instead of disappearing.

## 4.45.1

## 4.45.0

## 4.44.1

## 4.44.0

## 4.43.2

## 4.43.1

## 4.43.0

### Minor Changes

- 3858d3e: Link analytics tracking to CRM contacts and chat conversations through a shared `end_users` identity.

  Until now the analytics tracker, the chat widget, and the CRM lived in three separate identity silos: `analytics_view_events` carried only an opaque `visitor_id`, while the widget and CRM both spoke `end_users.id`. A visitor's page-view history stayed orphaned even when they later identified themselves in chat or signed in.

  This change introduces an `analytics_visitor_identities` bridge table mapping `(org_id, visitor_id) → end_user_id`, and a denormalised `end_user_id` column on both event tables that the analytics service stamps at ingest time. Two write paths populate the bridge:
  - **Widget**: `findOrCreateEndUser` in `widget-ingest.service.ts` now upserts the bridge whenever a chat session carries a `visitorId`. The chat widget and the analytics tracker now share the same `localStorage` key (`mn.vid`), so a visitor who first opens the widget retroactively links their already-stored tracker visitor id.
  - **Tracker**: new `POST /v1/a/identify` endpoint plus a `window.mn.identify(externalId, userHash)` method on the tracker bundle. Identity is verified by HMAC against a per-tracker secret; mint one via `analytics_create_tracker` (returned once) or rotate with the new `analytics_rotate_tracker_identity_secret` tool. Tampered hashes are rejected silently.

  Query tools now accept an optional `endUserId` / `contactId` filter (`analytics_views_over_time`, `analytics_subject_engagement`, `analytics_top_subjects`), and a new `analytics_contact_journey` tool returns the chronological page-view + search timeline for a known visitor. Past anonymous rows stay orphaned — there is no retroactive backfill.

  The dashboard gains a **Settings → Analytics trackers** page that lists trackers, mints new ones (with the public key + identity secret revealed once), shows whether identity verification is configured, and lets admins rotate the identity secret or revoke the tracker without dropping to MCP tools.

  The tracker bundle gains a script-tag identity path (`data-external-id` + `data-user-hash`), matching the chat widget's embed shape. The runtime `window.mn.identify()` call remains as the SPA escape hatch.

  The chat widget gets a matching runtime identity path: `window.munin.identify(externalId, userHash)` posts to a new `POST /v1/widget/identify` endpoint. When an anonymous chat session identifies mid-flight, the backend migrates the conversation: the verified `end_users` row replaces the `anon:…` one, the contact's `metadata.externalId` is updated, and the analytics bridge is rewritten — so the same browser's prior page-views attach to the now-known visitor without losing the chat history.

## 4.42.0

## 4.41.1

## 4.41.0

## 4.40.4

## 4.40.3

## 4.40.2

## 4.40.1

### Patch Changes

- 706d8c9: CodeQL cleanup: drop the `Math.random` session-id fallback in the chat widget (modern browsers always have `crypto.randomUUID`/`getRandomValues`), tighten the HTML-stripping regexes used by the web crawler and widget email fallback so nested/whitespaced `</script>` tags don't slip through, and rejection-sample in `makeId` to remove the modulo bias on the cryptographic random source.

## 4.40.0

## 4.39.0

## 4.38.0

## 4.37.0

## 4.36.0

## 4.35.0

## 4.34.0

## 4.33.0

## 4.32.0

### Patch Changes

- f6cb178: Vite config now adds `development` to `resolve.conditions` when running in dev mode (`vite build --watch --mode development`). Without it, the chat-widget watcher resolved workspace deps like `@getmunin/widget-voice` through the `default` (production) export and required their `dist/` to exist before `pnpm dev` could start. With the condition wired up, dev resolves directly to each workspace package's `src/index.ts`. Production builds are unchanged.

## 4.31.0

## 4.30.0

## 4.29.2

## 4.29.1

## 4.29.0

## 4.28.0

## 4.27.1

## 4.27.0

### Minor Changes

- 6c585ba: Localize the AI-down greet and handover fallback messages to the visitor's widget locale across all 13 widget-supported locales (en, nb, da, sv, fi, is, de, fr, es, it, pt, nl, pl). Previously a Norwegian visitor whose widget was in `nb` still saw English fallback copy when the LLM provider was unreachable.

  The chat widget now sends its picked locale on every conv-create / message-ingest request. The backend stashes it in `end_users.metadata.locale` (no schema migration — the column was already jsonb). `ConversationDetail.endUserLocale` exposes the value to the agent runtime, which looks up the localized string from a new `fallback-messages` module. Unknown locales and other channels (email, SMS, voice) fall back to English at lookup time.

  Greet copy mirrors the widget's existing `defaultGreeting` tone per locale (e.g. `nb: "Hei. Hva kan vi hjelpe deg med?"`); handover copy is a fresh translation matching each locale's existing widget tone.

## 4.26.0

## 4.25.0

## 4.24.3

## 4.24.2

## 4.24.1

## 4.24.0

## 4.23.5

## 4.23.4

## 4.23.3

## 4.23.2

## 4.23.1

## 4.23.0

## 4.22.0

## 4.21.0

## 4.20.0

## 4.19.4

## 4.19.3

### Patch Changes

- 0814264: Move `@getmunin/widget-voice` from `dependencies` to `devDependencies`. Vite already inlines it into the IIFE bundle at build time (`inlineDynamicImports: true`), so consumers should not try to resolve it at install time. As shipped in 4.19.2 the published package errored on `pnpm install` because `widget-voice` is a private workspace package not available on the registry.

## 4.19.2

### Patch Changes

- 0ea9b12: Publish `@getmunin/chat-widget` to GitHub Packages so the cloud backend image can install the prebuilt widget bundle from the registry instead of needing a workspace link. Aligns its version with the rest of the public OSS packages and adds it to the changesets `fixed` group so future releases keep all OSS package versions in lockstep.
