# @getmunin/dashboard-pages

## 5.18.0

### Minor Changes

- ac7ea66: Name a caller by their phone number instead of "Anonymous visitor".

  A voice conversation usually carries a number and nothing else — no name, no email — so every call in the queue read "Anonymous visitor", indistinguishable from the next one, while the number itself sat unformatted in the thread header. The queue read model now returns `customerPhone` (contact phone, falling back to the end user's), and the queue row, the thread header and every inbound bubble in the thread resolve identity through one `customerIdentity` helper: name, then email, then the phone formatted with `libphonenumber-js` (`+47 95 03 94 93`). Queue search matches the raw number, so pasting a caller ID from a missed call finds the conversation. The thread header drops its separate phone chip when the title already is that number, and an unparseable number is shown as written rather than hidden.

  Only the fallback moved. A message that carries its own `authorName` still shows it, and "Anonymous" remains the label when the conversation genuinely has no name, email or number — a widget visitor who never identified themselves.

  The API keeps the raw E.164 string; formatting is a dashboard concern.

- 1397a25: A first-run workspace now renders its onboarding steps in the server HTML, with no spinner and no skeleton in front of it, and every console page decides that the same way.

  The dashboard shell used to withhold every page behind a `PageSpinner` until four client fetches — session, membership, agent config, setup state — had all landed, and Dashboard and Automation then held a skeleton until a second fetch (usage summary, automation summary) landed on top of that. `readDashboardBootstrap()` now does that work on the server: a new `@getmunin/dashboard-pages/server` export reads the session cookie, fetches memberships, agent config and setup state in parallel, and feeds them to a `DashboardBootstrapProvider` that seeds `useActiveMembership`, `useAgentConfigStatus` and `useSetupState`. With those seeded the gate is satisfied on the first render, so the shell, the sidebar and the first-run scene are all in the initial HTML.

  The bootstrap is deliberately conservative and returns `null` — falling back to the existing client path unchanged — when there is no session cookie, when any fetch fails or exceeds 1.5s, when setup is incomplete (that user belongs on `/setup`, and the redirect stays client-side), or when the user belongs to more than one org. The active-org pin lives in `sessionStorage`, which a server render cannot see, so for a multi-org user the server cannot tell which org to fetch; single-tenant OSS deployments always take the fast path.

  On that fallback path `SetupStateProvider` now mounts alongside the spinner rather than behind it, so the setup fetch runs beside the gate's own fetches instead of queueing after them. It takes an `enabled` flag, and `useRealtime` an `enabled` option, so a signed-out visitor still opens no socket and fetches nothing.

  Dashboard, Conversations, Review and Automation now share one `useFirstRunGate()` returning a single `view` of `loading | firstRun | content`, replacing four different hand-rolled conditions. A page narrows first run with its own emptiness rule — `topicCount === 0` on Automation, nothing pending on Review — and returns `null` from that rule when it cannot decide yet, which reads as `loading` rather than a wrong guess. Dashboard passes `content: inbox.hasLoadedOnce` so its own data gates only the content branch, never the first-run branch, and it names its skeleton once instead of twice. Automation additionally reads its topic count from the setup snapshot rather than from the automation summary, so deciding first run needs one request instead of two.

  `useDashboardGate` also drops its duplicate `roleLoading` term — `useActiveRole` returns `useActiveMembership`'s own loading flag — in favour of three named booleans, and the three copies of "fetch JSON from the API forwarding the caller's cookie" in `setup-gate.ts`, `server-session.ts` and the new bootstrap now share one `fetchJsonWithCookie` helper.

### Patch Changes

- 402f00d: Overview review empty state now uses the shared console empty component, so it wraps at the same measure as the conversations one and no longer draws a stray bottom rule.
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

- Updated dependencies [56a3349]
  - @getmunin/ui@5.18.0
  - @getmunin/types@5.18.0

## 5.17.0

### Minor Changes

- 19c91b2: Say why a CMS preview will not embed, instead of showing a dead grey frame.

  A frontend that sends `Content-Security-Policy: frame-ancestors 'none'` or `X-Frame-Options: DENY` — the default in most security-header snippets, including the one Next.js docs suggest — cannot be framed by the Review pane. Until now that produced a blank grey panel that stayed on the Preview tab forever, with the reason visible only in the browser console.

  The pane could not have detected it. Measured in Chromium against a blocked site and an allowed one, the two are indistinguishable from the embedder: both fire `load`, both throw `SecurityError` on `contentWindow.location`, `origin`, `history` and `frameElement`, and both report `contentDocument === null` and `contentWindow.length === 0`. `frameStayedBlank()` only ever worked for a same-origin `about:blank`; on a CSP-blocked cross-origin frame its `catch` returned "not blank", which is what marked the dead frame `ready` and defeated the 15-second timeout behind it.

  So the check moves server-side. `POST /v1/cms/drafts/:id/preview-link` now also returns `embed`: `{ embeddable, reason, detail, previewHost, embedderOrigin }`, from one `safeFetch` of the preview URL that reads `Content-Security-Policy` and `X-Frame-Options` and evaluates `frame-ancestors` against `MUNIN_WEB_URL`. The evaluation follows what browsers actually do — every policy in a comma-joined header must allow the embedder, `'self'` is read against the previewed site rather than the dashboard, `X-Frame-Options` is ignored whenever any `frame-ancestors` directive is present, and `ALLOW-FROM` is treated as absent because no current browser honours it. `cms_get_preview_link` is untouched: the probe hangs off the dashboard's controller, so minting a link from an agent still makes no outbound request.

  When the verdict is "blocked" the pane skips the frame entirely, opens on the fields, and names the offending header and the origin it refuses — the "open on the site" link keeps working, because a top-level navigation is not framed. A probe that fails for any other reason falls open and behaves as before: a wrong "blocked" banner over a working preview would be worse than the frame we have today.

  `skill://cms/preview-entry` gains the frontend side of this as Step 4, along with a second failure it shares. The preview cookie in the skill's own example carried no `sameSite`, which is `Lax` — not sent in a cross-site frame, so once the framing headers are fixed the frame redirects, the cookie never arrives, and the reader gets the published entry with nothing to indicate why. It now sets `SameSite=None; Secure; Partitioned`, as Next's own draft-mode bypass cookie already does. `skill://cms/design-collection` points at it, since both fixes belong to whoever wires the frontend up.

- 19c91b2: Make the console logo a link, and let the host decide where it goes.

  `DashboardShell` and `ConsoleShell` take `brandHref`, defaulting to `/dashboard`. The sidebar console that replaced `DashboardTopbar` dropped the topbar's `<Link href={brandHref}>` around the mark, so the logo has not been clickable since; the default restores that rather than only adding a prop.

  Absolute URLs render as a plain `<a>` instead of the i18n `Link`, which is the whole reason this needs a branch: `Link` prefixes the active locale, so a hosted deployment pointing the mark at its marketing site would otherwise navigate to `/en/https://example.com`. Only the mark is wrapped, never the whole lockup — the brand-text slot is `headSlot`, which in a multi-tenant deployment is an org switcher, and a button inside an anchor is neither valid nor clickable. All three instances get it: sidebar, mobile header, and the menu sheet.

- 19c91b2: Give the console pages a loading state, one empty-state treatment, and an Oversight order that follows the day.

  **Loading.** Every settings page has had a skeleton since they shipped; none of the four console pages did. All four opened with `if (setup.loading) return null` — a blank main pane — and then, once setup resolved but their own data was still in flight, rendered a **false empty state**: `/dashboard` showed `0` live and `0` waiting with the all-clear note, Review showed "Nothing blocked." above four items that were about to arrive, Automation showed "No topics yet", and Conversations showed a header over an empty list with nothing in it at all. `hasLoadedOnce` was already on both `useInboxData` and `useConversationQueue`; nothing but the error paths read it.

  Each page now renders a skeleton of its own layout while setup is undecided — deliberately a skeleton and not the real chrome, because the first-run scene is still a possible outcome at that point and must not be preceded by a flash of the ordinary page — and every empty state is gated on its data having loaded at least once. New `ConsoleRowsSkeleton` / `ConsoleSplitSkeleton` / `ConsoleTableSkeleton` / `ConsoleHeroSkeleton` in `components/console-skeleton.tsx`, alongside the existing settings skeletons.

  **Empty states.** The console had four treatments: `EmptyCallout` (bordered, centred) on every settings page, Review's local `EmptySection`, Automation's one mono line, and Conversations' nothing-at-all. Review's was the odd one: an `<li>` with `border-b border-rule-soft px-5 py-6`, which is the same shell as `QueueRow` — so it read as a row you could tap and couldn't, worst on mobile where the list is the whole screen. It also put a serif `<h3>` inside a list column, where serif otherwise belongs to page heroes and panes, so on a tab with rows above it the empty read as a third header.

  Automation's empty needed one thing more. Its column header carries both the rule above the list and `max-md:hidden`, so on a phone the empty sentence lost its anchor and floated in white space below the KPI, at the same weight and colour as the lede two blocks up — three grey paragraphs, none of them reading as the state. Review never had this because `ConsoleSectionLabel` renders at every width and brings its own rule. The rule now lives on the table wrapper as `max-md:border-t`, so under `md` the list has a top edge whether it is empty, loading or populated — the populated mobile list never had one either, it just got away with it because a row is dense enough to read as a start.

  One quiet `ConsoleListEmpty` now serves Review, Conversations and the overview's recent list: no row border, no serif, body text only. `emptyBlockingTitle` and `emptyImprovementsTitle` are dropped rather than restyled — the section label directly above already says "Blocking · 0". Conversations gets a real empty state for the first time (`queue.emptyTitle` / `emptyBody`, plus a distinct pair for a search that matches nothing).

  **Copy.** Two strings were describing the furniture instead of the reader:

  - Automation's title was "Built to be <em>retired.</em>" — no subject, so read cold off the nav it parses as a deprecation notice about the feature, and what actually retires is the review step, not the automation. Its neighbours both address the reader ("What needs you, first.", "Nothing ships without your nod."). Now "Approve it until <em>you don't have to.</em>" The Norwegian was worse — `pensjonert` is what happens to people — and is now "Godkjenn til <em>du slipper.</em>"
  - Review's pane empty said "This tab is empty.", which the reader can see. It now says what the three tabs hold, which is the one thing they cannot: "Waiting holds anything blocked on your decision. Scheduled holds what you've approved for later. Decided is the record of the last {days} days."

  **Grouping.** The section labels are gone — `dashboard.console.groups.{admin,oversight,workspace}` with them, in both locales. Five links carried three labels, two of them over a single item, and the three eyebrows plus their `gap-6` separators took about as much vertical space as three more links would. The taxonomy was also wrong where it mattered most: `adminOnly` is set on Dashboard, Review, Automation **and** Settings, so "Admin" named one of the four admin-gated items while the only item that is _not_ admin-gated sat under "Oversight" — and a member, after `consoleGroupsForRole` filters, saw a lone uppercase "OVERSIGHT" over a single link. The separating whitespace went too, so the five links now render as one flat list — `NavList` flattens `groups` at render rather than emitting a `<ul>` per group, which also keeps the 1px rhythm between items uniform across what used to be a group boundary. `ConsoleNavGroup` stays as the data shape: it still carries the order, and `consoleGroupsForRole` still filters by group and drops the ones it empties. It simply has no visual output any more.

  With the labels gone the column's own alignment was exposed: the nav sat in `pl-2 pr-6` and each link added `border-l-[3px] px-3.5`, putting link text at 25px against the brand row's logo edge at 20px — five pixels off, which reads as a miss rather than a choice — while the active band started 8px in and stopped 24px short of the divider, and its `border-l-[3px]` cobalt edge-marker sat nowhere near an edge. The nav padding moves onto the link (`pl-[17px] pr-5`), so text lands at 20px in the same column as the logo, the active band bleeds edge to edge with the marker on the sidebar's actual edge, and the badge gets the same 20px margin on the right that the logo has on the left. The mobile sheet, which shares `NavList` and titles at `px-5`, picks up the same alignment. This was the settings sub-nav's pattern (12 items in 6/3/3, extended by cloud through `extendSettingsGroups`) applied to a nav a third that size — and unlike the settings shell, `ConsoleShell` takes no `groups` prop, so nothing could have extended it into paying off.

  **Order.** Oversight was Conversations · Automation · Review. Two of the three carry badges and are worked daily; Automation carries none and is a configuration surface, so it split the pair and dropped a settings page into the middle of the loop. It is now Conversations · Review · Automation, which is also the progression the copy describes — answer, decide, and then, when the numbers hold, flip it to auto.

### Patch Changes

- 19c91b2: Give `ConsoleShell`'s `headSlot` the brand text's place instead of a row of its own.

  The sidebar console shell that replaced `DashboardTopbar` dropped the slot's contract along with the topbar. The topbar rendered `leftSlot` **instead of** the brand text (`leftSlot ? … : brand`); the sidebar renders the brand row unconditionally and then drops `headSlot` underneath it, outside the row's `px-5`. OSS never noticed — `apps/web` passes no `headSlot` — but cloud passes its org switcher there, so hosted Munin shipped the product name on one line and an unpadded, flush-left org switcher on the next.

  `headSlot` now takes the brand text's place in the brand row, which is what the switcher is built for: its `-mx-2.5` cancels the button's own `px-2.5` so the org name lands exactly where the brand text did, beside the logo. `brand` still names the product in the mobile header and the menu sheet, and the fallback keeps every caller that passes no slot pixel-identical.

  The mobile sheet gets the slot too, below the title. Since the shell rework there was no way to switch organization on a phone at all — the slot rendered only in the desktop sidebar, which is hidden under `md`.

- 19c91b2: Drop 50 message keys that nothing reads, in both locales.

  Audited every leaf in `messages/en.json` against every `useTranslations`/`getTranslations` call in this repo **and** in the cloud web app that merges over this tree, keeping anything reachable through a computed key — `t(\`${state}Title\`)` on the verify-email page, `t(\`moduleDescriptions.${module}.readWrite\`)`on the consent screen,`t(\`kind_${change.kind}\`)`, `t(\`saved_${policy}\`)`, `t(\`channel_${kind}\`)`, `t(\`${vendor}.${field}.placeholder\`)`, and the whole `errors.*`namespace, which is looked up by API error code. 1775 leaves down to 1725, en and nb still in exact parity, and no`t()` call in either repo resolves to a key that no longer exists.

  The console rework cleaned up after itself almost completely: of the 138 keys used by the six components it deleted, 122 went with them and the other 16 are still live elsewhere. It left exactly two behind. `nav.closeMenu` was kept on purpose — its changeset says "kept, since `dashboard-pages` is shared with the cloud web app" — but the cloud app never referenced it either, so the reason it was spared does not hold. `dashboard.apiKeys.copyClipboard` went unused when `KeyReveal`'s `copyLabel` prop went away, unremarked.

  The other 48 are older debris that no release has swept since: the May 2026 usage redesign (`percentUsed`, `perMinute`, `perDay`, `resetNow`, `resetMinutes`, `resetHours`), the i18n consolidation of the same month (most of `dashboard.team.*`, `dashboard.agents.*`, `dashboard.auditLog.filter*`), the August channels and trackers card-grid redesign (`imapPolling`, `smtpServer`), the App Store integrations page (`integrations.slack.notConfigured`, superseded by `notConfiguredShort`), and a dozen keys — the vendor `*Chip` strings, `dashboard.trackers.rotated`, `agentSetup.apiKey.ledeStored` — that were written into the catalogue and never wired to anything at all.

- @getmunin/types@5.17.0
  - @getmunin/ui@5.17.0

## 5.16.0

### Minor Changes

- f781f5f: Console page headers share one component. Learning, Automation and Conversations each hand-rolled a `<header>` with copy-pasted eyebrow, title and lede classes, which had already drifted: all three set the title to `leading-tight` (1.25) where the console kit specifies `line-height: 1` and the settings `Hero` uses `1.05`, so console titles were looser than both — visible whenever a title wrapped.

  `ConsoleHero` mirrors `Hero`'s API (`eyebrow` / `title` / `lede` / `actions`) on console-kit values: cobalt eyebrow rather than muted, a 36px serif title, and a 14px lede capped at 52ch. Titles style their own `<em>` through a descendant selector, so pages pass `t.rich('title', { em: (chunks) => <em>{chunks}</em> })` exactly as the settings pages do instead of repeating the italic-cobalt classes. Learning and Automation now render it; Automation's 7-day auto-rate moves into the `actions` slot. Conversations keeps its own markup — it is the narrow list pane, with a smaller title and a search input inside the header — but picks up the same corrected leading.

  The rule under the header is gone from all three, so the console pages agree with each other. Note this departs from the kit, where `.c-inbox-head` carries `border-bottom: 1px solid var(--ink)`.

  Learning gains a lede. Every settings page and Automation already had one, leaving Learning the only page in the product whose header stopped at the title; `lede` is now an explicit per-page choice rather than an omission.

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

- f781f5f: First-run and empty states for Overview, Conversations, Automation and Learning

  A brand-new org used to land on a dashboard of zeroes: a hero that said agents were
  caught up, two stat rows reading 0, and five empty usage tiles. Nothing told you that
  no channel was connected, or that the two things worth doing were pointing an agent at
  `/mcp` and opening a way in.

  The four console pages now render a first-run scene instead, driven by one shared
  source of truth. `GET /v1/overview/setup` (new `SetupStateService`) reports the org's
  channels, all-time conversation count, topic count, knowledge-base size and external
  MCP tool-call activity in a single request. `useSetupState` turns that into
  a `stage` — `unconfigured` (no channel can accept a message), `listening` (a channel is
  live, nothing has ever arrived) or `active` — and pages branch on `setup.isFirstRun`
  so an established org keeps exactly the behaviour it had.

  Setup state is fetched from a `SetupStateProvider` mounted in `DashboardShell` rather
  than per page. Fetching it per page meant every console navigation remounted the hook,
  started from "unknown", and rendered the established-org layout for a frame before
  flipping to the empty state — a visible flash on every switch. Pages now also render
  nothing rather than the wrong branch while the answer is still undetermined, so the
  wrong frame never reaches the screen.

  The provider revalidates on navigation, keeping the last snapshot on screen while the
  refetch is in flight, so connecting a channel in settings and walking back to the
  console shows the new channel without a reload. Channel mutations emit no realtime
  event, so navigation — not the event stream — is what makes that flow correct; a
  channel opened by an agent while you sit on Overview still lands on the next
  navigation rather than instantly.

  "Has an agent been pointed at the endpoint" counts only _external_ callers. Munin's own
  in-process runner reaches the same tools, so a first count of every non-system
  `audit_log` row with a tool set reported 35 calls — and a green "done" — for an org
  where nobody had ever connected anything. `externalMcpCallCount` now excludes the
  `agent-host` actor and its per-end-user variants alongside the system actors, reusing
  the `@getmunin/types` actor constants rather than restating the prefixes. The step
  counter is derived from the same two facts in both stages, so a live channel with an
  untouched endpoint reads "1 of 2 done" instead of claiming both.

  The derivation is a pure function (`toSetupSnapshot`) with its own tests: stage
  transitions, channels awaiting credentials counting as pending rather than live, the
  endpoint counting as connected only once an external tool call is recorded, and channel
  labels falling back from public address to channel name.

  The scenes are built from a small reusable set — `FirstRunScene`, `FirstRunSteps`,
  `FirstRunChain`, `FirstRunStatusList`, `FirstRunFigures`, `FirstRunAside`,
  `FirstRunNote` and the shared `CopyField` — so all four pages share one editorial layout
  rather than four bespoke empty states. `@getmunin/ui` gains an `accentOutline` button
  variant for the quiet cobalt CTA these screens use.

  The endpoint is readable by any org member, since Conversations is the one console
  page members can open and its empty state has to distinguish "no channel connected"
  from "connected, nothing has arrived". It returns counts and public channel config
  only — the same redaction `conv_list_channels` applies.

  The endpoint field became the shared `CopyField`: a mono value with the Copy control
  attached inside one hard-edged ink border on `paper-deep`. `CopyableSecret` is now that
  field plus a label and hint, `KeyReveal` on api-keys and the webhook-secret field on
  channels use it directly, and `channels.tsx` no longer shadows `CopyableSecret` with a
  local copy of its own — that duplicate is what kept the widget-key and Twilio dialogs
  on the old rounded `bg-background` look while the rest of the console moved on. The
  multi-line embed snippets in channels and trackers keep their button underneath, since
  an attached control makes no sense on a code block, but their surface now matches. The
  Copy control sizes itself to the wider of its two labels by rendering both in one grid
  cell, so the field does not shift when Copy becomes Copied — and it stays correct in
  Norwegian, where "Kopiert" is a character longer than the English word. The email
  channel form's SMTP and IMAP fieldsets lost their `rounded-md` corners, and
  `--munin-radius-input` drops from 2px to 0, so inputs, textareas and every
  `rounded-input` surface are hard-edged like the rest of the system.

  The four first-run scenes were then measured rather than eyeballed, at both widths and
  in both stages: scene gap, page padding, every inter-block gap and each closing rule.
  Two arbitrary differences fell out and are fixed — `FirstRunFootnote` closed on 20px
  where `FirstRunNote` closed on 24px despite playing the same structural role, and the
  chain's mobile number gutter was 44px against the steps' 52px even though both land on
  76px from `md` up. What remains different is deliberate: Conversations closes on a soft
  rule (a caveat) where the other pages close on an ink rule (a statement), and its
  listening stage has no closing line at all, ending on the test affordance the way the
  design does.

  Copying the endpoint no longer crashes outside a secure context. Every copy button in
  the dashboard reached for `navigator.clipboard.writeText` directly, and that object
  does not exist on a plain-HTTP origin — so pressing Copy on a LAN dev host threw
  `Cannot read properties of undefined (reading 'writeText')`. A shared `copyText` helper
  now falls back to a selection copy and reports failure instead of throwing, and a
  `useCopy` hook owns the "Copied" flag and its timeout. Both replace the eight
  hand-rolled copies of that logic across api-keys, channels, trackers and
  `CopyableSecret`.

  "Send a test message" on the listening screen is a real feature rather than a mock.
  `POST /v1/conversations/test-message` opens a conversation on the org's first live
  channel with an inbound end-user message, flagged `setupTest` in conversation metadata
  and surfaced as `isTest` on the conversation DTO. It goes through `createConversation`,
  so the whole pipeline runs — classification, drafting, the lot — which is the point of
  a test. Nothing is delivered outbound, because an `end_user`-authored first message
  never enqueues delivery.

  The test conversation is a real conversation, so the console takes over from the
  first-run screen the moment it lands and you watch it arrive. `DELETE
/v1/conversations/test-message/:id` removes it — refusing any conversation not carrying
  the flag — and the pane shows that action in a banner while a test is open. Deleting
  returns the org to zero conversations and the first-run screen comes back, so the whole
  loop is reversible. Both endpoints are owner/admin only, which is why
  `ConversationsController` now includes `RoleGuard` (a no-op for its existing methods,
  none of which declare roles).

  The banner reports the delete to the page rather than acting on it. Navigating and
  refetching from inside the banner left the queue holding a conversation the server had
  dropped, so the pane stayed mounted and its button span forever; and the shared
  setup-state revalidation is throttled, so a delete within a couple of seconds of
  opening the conversation silently skipped it and the console rendered its ordinary
  empty state instead of returning to first run. `ConversationsPage` now owns the
  aftermath — shallow-navigate to the queue, refetch the queue, force a setup reload —
  which is the same sequence it already uses for every other conversation-level action.

  The Done section is now bounded by both count and age: everything closed inside
  `FINISHED_WINDOW_DAYS` (7) stays, and at least `FINISHED_MIN_ITEMS` (25) stays even when
  older, so a quiet week still shows history and a busy one does not hide it. It was
  previously a flat 25-of-any-age, which meant a busy org silently lost recent rows while
  a quiet one showed conversations closed a year ago. `visibleFinished` expresses the
  union as a pure function over the already-sorted page and is unit-tested on both
  branches, the window edge, and undated rows. The closed page now fetches 100 rather
  than 25 so the window has room; past 100 closed inside a week the section is capped,
  since the endpoint's cursor is still unused by this page.

  One caveat: a test conversation counts in usage tiles and can pick up a topic like any
  other, so the copy promises only that it is marked as a test and deletable — not the
  design's "counts toward nothing".

  The Overview hero greets you by name. The headline was a fixed line about waiting on
  your word regardless of who opened the page or when; it now reads "Good morning,
  _Kjell_." — four buckets split at five, noon and six, first name in the same cobalt
  italic the old emphasis used, with the state left in the lede where it already lived.
  The small hours get their own line ("Still up, _Kjell_?") rather than being folded
  into a morning that would otherwise start at midnight. `firstName` falls back to the
  unpersonalized headline rather than guessing: a blank name, an email in the name field
  (BetterAuth allows it), or a first token over 24 characters all keep the old line, so
  the hero never addresses someone by their address or overflows. The Norwegian
  greetings are transcreated to what reads naturally there — morgen, ettermiddag, kveld,
  and "Fortsatt oppe" for the night — rather than mapping one-to-one onto the English
  buckets.

- e6d7af6: The admin overview becomes the Oversight design's landing screen. The hero now reads "Waiting on your word." with a lede that states how many items wait on an admin, and two big count rows navigate to the console's destinations: Live now → Conversations and Learning → Learning, each with the design's dot/ring marker, serif count, and a note that flips with the count. The live-conversation cards and recent-conversations list leave the overview — conversations are handled in the review queue destination now — while the Waiting-on-you queue (with its hover actions and 560px drawers), Scheduled section, and the five-tile usage sparkline row stay.
- 94cc025: The Oversight console shell replaces the topbar dashboard chrome. All `/dashboard/*` routes now render inside a 280px bone sidebar: a plain brand head (consumers can inject extra head content via `headSlot`) and role-gated nav groups (Admin / Workspace for now — Oversight destinations land with their own releases) with live badges fed by `/v1/inbox`. On phones the sidebar becomes a 56px header whose ☰ opens a full-screen role-gated menu sheet with a sign-out foot, per the mobile design. `DashboardShell` keeps its public props and delegates to the new `ConsoleShell`; settings routes keep their own chrome. The old `DashboardTopbar`/`SettingsTopbar` exports are removed. `nav/console-groups.ts` mirrors the settings-groups pattern (`consoleGroupsForRole`, `extendConsoleGroups`, exact-match active state for the dashboard root).
- f781f5f: The Learning page becomes the Oversight design's proposals screen. Curation candidates render as the design's proposal cards: an accent kind line that names the revised document ("Revision — KB 07 …") or reads "New article", a serif title, a mono meta row of target space · age · a link to the conversation the candidate came from, and then the proposed article itself. A revision additionally shows its first changed passage as a before → after excerpt above the full text. Publish and Dismiss sit under the card, and the empty state is the design's bordered "Nothing proposed." panel.

  Candidate text is shown in full rather than behind a "Read full" toggle. Curation candidates are agent-drafted articles a few hundred characters long, so the toggle hid roughly a paragraph behind a click and the card could not be judged without one. To make that free, `listCurationCandidates` now carries `body` and `revisesDocumentBody` on `CurationCandidateSummary`: the batched document load it already ran for revision titles now covers the candidate ids too, so the query count is unchanged and the Learning page needs no per-card detail fetch. The redundant "Proposed for <space>." snippet line goes with it — the meta row already names the space.

  The card states each fact once. A candidate body written by the curation pass opens with its own `# H1` repeating the title the card already shows in serif above it, so a leading heading is dropped at render time — unconditionally, since the two often differ by a word ("Widget not loading on Safari" under a title of "Widget not loading on Safari with ITP") and an equality check would miss it. Only the leading heading goes; sections further down survive, and the stored body is untouched, so publishing still writes what the agent wrote. The "Proposed article · full" label above the text goes too — it restated the "New article" kind line and contrasted "full" against a collapsed state that no longer exists. On a revision it stays, where it genuinely separates the full document from the changed-passage excerpt above it.

  The past-decisions list leaves the page along with the pending/published/dismissed counter strip, and the section header above the cards goes too now that proposals are the page's only content. Learning is now only the open proposal queue, and the `/v1/kb/curation/decisions` read it made on mount is gone. Candidate rows still refresh live off `kb.*` events through the shared inbox subscription.

- daf5e55: Learning becomes its own console destination. `GET /v1/kb/curation/decisions` exposes the existing curation decision record to the dashboard, and `/dashboard/learning` renders the design's cards: pending KB candidates (revision vs article, target space, publish / review-and-edit / dismiss — reusing the inbox KB drawer for editing) followed by the decided history with published/dismissed pills and the no-refile note. KB candidates leave the admin overview's Waiting-on-you list now that Learning owns them, the overview's Learning stat row links somewhere real, and the sidebar's Learning entry (admin-only, badge = pending candidates) goes live.
- 271cba5: The review queue becomes its own destination at `/dashboard/conversations`. Desktop is the design's two-pane layout — a sectioned list (Needs your attention / In progress / Finished, partitioned by claim ownership and attention, with client-side search) beside a full-height conversation pane; on phones the same routes become list-then-detail with a back link and stacked 44px actions. Rows carry the enriched queue DTO: channel tag, customer — subject, inbound preview, topic nudge, "No draft — you write it" / drafting badges, age, claim-holder face and note count. The pane renders the thread with interleaved amber internal notes, the agent's "why" block (audit rationale + tool-call chips off the draft metadata, hidden when absent), and a claim-gated composer with Reply / Internal note tabs: approve-or-edit the seeded draft, Reject (now stamps the audit trail via clear-draft), Restore draft, Release, Ask for a draft, and Close-no-reply. Support agents land here instead of the admin overview, and the sidebar gains the Oversight group. `errors.claim_held_by_other` and `errors.conv_draft_pending` are translated in both locales.
- 1378212: Settings opens for support agents. The settings shell no longer bounces non-admins back to the dashboard: agents see Workspace → Account plus the "Workspace, access, and monitoring are admin-only" note, and landing on any other settings page redirects them to Account. The back link in the settings topbar is role-labelled and role-targeted — "Back to overview" → `/dashboard` for admins, "Back to conversations" → the review queue for agents — matching the console's role-based landing. `settingsGroupsForRole` joins the exported nav-data helpers so downstream shells can apply the same gating.
- 356885c: Per-topic reply automation with promotion. `conv_topics` gains `agent_mode` and `auto_promoted_at` (migration 0085): a topic's mode, when set, overrides the per-conversation agent mode everywhere it is read — the runner's conversation detail, the queue DTO (which also carries `topicAgentMode` for the row nudge), and the dashboard. `ConvAutomationService` aggregates each topic's 30-day review record (approved-unedited / edited / rejected counts, weekly volume, auto-sent share over 7 days) and flips modes, stamping `auto_promoted_at` on promotion and emitting the new `conversation.topic_automation_changed` event. Exposed as `GET /v1/conversations/automation` + `POST /v1/conversations/topics/:topicId/agent-mode`, the MCP tools `conv_list_topic_automation` / `conv_set_topic_automation`, and the `skill://conv/promote-topic-to-auto-send` procedure. The dashboard's Automation screen shows the per-topic table with the ≥90 %-unedited readiness gate, the promote dialog with the disposition breakdown, and one-click demotion — and the queue rows now read `Topic · Auto/Review/Human`.
- f781f5f: Review splits into Waiting / Scheduled / Decided tabs, and owns the scheduled queue

  The page previously stacked three sections in one scroll: blocking decisions, knowledge
  improvements, and the decided window. Those are two different axes — urgency of a pending
  decision, and the past — so the lifecycle now lives in a tab bar and urgency stays as the
  section labels inside Waiting.

  Scheduled is the reason the split earns its keep. An approved-for-later outbound message or
  CMS publish is the one thing in the system that is still cancellable, and it was only visible
  on Overview, hidden entirely whenever the list was empty. It now sits in Review next to the
  decision that created it, with the existing read-only pane and call-off action. Overview keeps
  its own scheduled section for now.

  Tabs are always shown, empty or not, with a count only when non-zero — a missing tab reads as
  a missing feature, and the page already answers "nothing here" in words (`Nothing blocked.`,
  `Nothing proposed.`, and now `Nothing scheduled.` / `Nothing decided yet.`). The whole-page
  first-run takeover still covers a genuinely cold org, so three empty tabs never render.

  Scheduled and Decided hold a single bucket each, so they carry no section label — the tab is
  the label. Only Waiting keeps them, where Blocking and Improvements are genuinely two
  sections. The decided window widens from 7 days to 30, and is now stated only in that tab's
  empty state.

  An empty tab used to leave the detail pane a blank slab, because the "select from the list"
  line only rendered when the list had rows. It now carries an eyebrow / serif heading / lede
  block borrowed from `LoadFailed`'s pane layout, top-aligned so its eyebrow lands on the same
  line as the list column's.

  Putting a second row of mono labels directly under the hero exposed a set of padding drifts
  that were invisible while nothing sat next to them, so both console pages now hold one edge
  per column:

  - The list column headers on Review and Conversations were `px-5 md:px-6` while every section
    label and row below them is `px-5`, leaving the hero 4px right of its own list on desktop.
  - Every pane action row — drawer footers, the CRM/KB/outreach approve rows, the conversation
    composer and its reply/note tab strip, the queue error banner — was `p-4 md:px-5` against
    pane content at `px-5 md:px-7`, an 8px step at the bottom of the pane.
  - The outreach drawer body was `px-6`, disagreeing with its own header and with the CMS drawer
    body, so the two scheduled panes did not match each other.

  The tab underline is sized by the trigger's text rather than trailing padding, matching the
  CMS entry pane.

  Deep links keep working: `/dashboard/review/<id>` derives its tab from whichever bucket owns
  the id rather than resetting to Waiting, and the stale-route guard checks every bucket so a
  scheduled or decided id is not bounced to the list mid-load.

  Uses `Tabs`/`TabsList`/`TabsTrigger` from `@getmunin/ui` — its first consumer in the dashboard
  — for real tab roles and roving arrow-key focus, which the bespoke `ViewTab` in the CMS pane
  does not have.

- f781f5f: Learning becomes Review, and everything waiting on an admin moves into it.

  `/dashboard/learning` is now `/dashboard/review`, and the page is no longer only about
  knowledge proposals. The four things that queue up for a human decision — CMS drafts, CRM
  merge proposals, outreach drafts, and forwarded feedback — leave the admin overview and
  join the KB candidates here, split into two sections that carry different urgency:

  - **Blocking** — everything that stops something from shipping, sorted **oldest first** so
    the longest wait is at the top. A blocking queue sorted by recency buries exactly the
    item that has been ignored the longest, which is the opposite of what the section is for.
  - **Improvements** — knowledge proposals, newest first, separated by a rule rather than a tint.
    These have no deadline: the base is already answering customers, and a proposal only makes it
    answer better. Keeping them in the same list as an unsent email made them look overdue, but
    tinting or dimming the rows overcorrected — the section label carries it.

  `Pill` gains a `marker` variant so the detail pane's module pill can carry the same glyph its list
  row does — a square for CMS, a diamond for CRM, a hollow ring for KB — instead of the generic filled
  dot every tone rendered before.

  **Outreach gets a purpose-built pane** rather than the sheet drawer reused in place. It is ordered by
  what you must not get wrong: the message as it will arrive, then why it is being sent, then when.

  - The **envelope is rendered** — from, to, subject — and so is everything the send path appends,
    as the literal text it will append rather than two booleans in a note at the bottom: the
    campaign's CTA URL on its own line, then the fixed `---` / Unsubscribe footer, under one
    "appended on send" marker. `ProposalCampaignSummary` gains `ctaUrl` (already selected by the
    query, only ever used to compute `appendsCta` and then dropped), `ProposalDelivery` gains
    `sender` / `senderName` off the channel's own addressing config (allow-listed through
    `publicChannelConfig`, so no credential can leak into a DTO), and `ProposalContactSummary` gains
    `companyName`, so the pane can say who it is going to.
  - **"Why this, why now" now exists.** `evidence` was already one call away on
    `/v1/outreach/proposals/:id` and the dashboard never fetched it. It is freeform jsonb whose shape
    varies per drafting agent, so it is rendered by _shape_ rather than by an allow-list of keys:
    long values and known reason keys become prose, `kb://` and `kdoc_` references become linked
    chips, and everything else becomes a labelled chip. A parser keyed to the documented example
    would have rendered nothing for the proposals already in the dev database, which is what the
    tests pin.
  - **Send timing is a control on the page**, not a dialog behind a button — the agent's proposed
    time, send now, or a picked time. The cadence annotations the design asks for next to it need
    campaign `cadenceRules`, which are not on the DTO yet, so they are left out rather than faked.
  - **SMS and voice are first-class.** No subject row, no CTA or unsubscribe placeholders, a live
    segment count as you edit, and the sender rendered as a number. A contact with no address on
    file blocks approval outright and says why, instead of tinting a note the same weight as
    everything else and failing at the service.
  - `BodyDiff` gains `wrap`: these are prose bodies in a ~700px pane, where horizontal scrolling
    through an email diff is unusable.

  The reply-thread quote is deliberately _not_ carried over from the old drawer: it quoted the
  proposal's own snippet, not the inbound message it was replying to. Showing the real thread needs
  the conversation fetch, so the block is gone until then rather than wrong.

  **CRM merges get a pane that leads with the consequence**, not a field dump. The old drawer was a
  header and one sentence of prose while `recommendedPatch` and `evidence` — both already in the
  browser — rendered nowhere.

  - **What changes on the keeper** is the body: one row per patched field, `old → new`, tagged
    `Differs` / `Replaced` / `Added`. `tags` and `customFields` overwrite rather than merge, so a
    replacement names what it drops (`"newsletter" is dropped`) — the single most destructive thing
    an apply does and previously invisible. A wholesale field the keeper doesn't have yet reads
    `Added` with no drop note, and a patch entry that wouldn't actually change anything is not
    rendered at all.
  - The evidence becomes the lede sentence — matched signals plus `keeperReason` — read **by shape**,
    like the outreach evidence, because the keys in the dev database (`sameCompanyDomain`,
    `emailVariation`, `phoneInB`) differ from the ones `skill://crm/clean-contact-data` documents
    (`sameEmail`, `nameMatch`, `samePhoneNormalized`). Both shapes are pinned by tests; unlabelled
    keys are ignored rather than dumped into prose.
  - Everything untouched collapses behind **Compare all**, a keeper-vs-archived table with identical
    values dimmed.
  - **And then** states what apply actually does, read off `applyMergeProposal`: history moves, the
    duplicate is archived and set to do-not-contact, and — new — _queued outreach for the duplicate
    is cancelled_, naming the campaign. A reviewer could previously destroy a scheduled email
    without being told.

  That needed `MergeProposalContactSummary` widened from 6 of ~24 contact columns to the patchable,
  displayable set (both read paths already fetched the whole row), plus `companyName` and a
  `MergeImpact` block — pending outreach on the duplicate and the count of other pending proposals
  the apply supersedes — computed in two batched queries. `impact` is nullable rather than zeroed, so
  the apply/dismiss responses say "not computed" instead of claiming nothing is at stake.

  Selecting a blocking item renders the existing per-module drawer in the split's right pane
  rather than a sheet, so the CMS field editor, outreach scheduling, and the merge preview all
  work unchanged and are now deep-linkable at `/dashboard/review/:id`. `DrawerHeader`'s close
  button became optional for that: in a persistent pane it pointed nowhere, because the list
  immediately re-selects the first row.

  The overview drops the queue concept entirely — no "Waiting on you" list, no count in the
  hero, no stat row. The sidebar badge on Review is the single signal that work is pending,
  and it now counts all five kinds instead of only KB candidates.

- f781f5f: Topics carry a description — what belongs in them, in the operator's words

  Picking a topic is an automation decision, not just filing: a topic can force `draft_only` or `off` on every conversation tagged with it. Until now the classifier made that decision from a name and its kebab-case slug — the same word twice. Nothing told it where an org draws the line between Support, Technical and Security, what its own vocabulary means, or that an existing topic already covers the case it was about to create a near-duplicate for.

  `conv_topics` gains a nullable `description`. It is returned by `conv_list_topics` and `conv_list_topic_automation`, settable on `conv_create_topic`, and editable through the new `conv_update_topic` tool or the topic editor on the automation page. The slug stays fixed at creation — it is how exports and imports address a topic.

  `skill://conv/set-topic-and-title` now reads descriptions ahead of names, treats a description that rules a case out as decisive, and writes one for every topic it creates. It deliberately does not edit descriptions on topics it did not create: one conversation is not enough evidence to redraw a boundary an operator drew.

- f781f5f: Per-topic promote threshold, and a customer message on an always-human topic now asks for a human

  The automation page hardcoded a 90% unedited bar for every topic, and the only way to
  express a topic's policy was the Promote / Back-to-manual buttons. Topics now carry
  `promote_threshold_pct` (default 90, so existing topics keep the current bar) and the page
  gets an explicit mode selector — inherit, always human, drafts only, auto-send — plus a
  threshold picker for the topics where the bar still applies. `conv_set_topic_automation`
  and `POST /v1/conversations/topics/:id/agent-mode` accept `promoteThresholdPct`; omitting
  it leaves the stored value alone, so changing mode never silently resets the bar.

  Auto-send is a standing rule, not a one-time promotion. It is selectable at any time, and
  the gate is evaluated at reply time on every reply: above it the agent sends unread, below
  it the agent drafts and waits. A topic whose unedited share falls back under its gate
  returns to drafting on its own, with no human action and no notification needed — which is
  what the dialog copy ("below it, Munin drafts and waits for you instead") always promised.
  `effectiveAgentModeSql` in `topic-auto-gate.ts` is the single definition, used by both the
  conversation-detail read the runner decides from and the queue-list read the dashboard
  labels from, so the row label and the actual behaviour cannot disagree.

  That fold changes what reads mean, and the read-model tests are split to say so. A read now
  reports two different things: `agentMode` is the gated, effective mode a caller should act
  on, while `topicAgentMode` stays the mode an operator configured — the automation page shows
  the second, the inbox row shows the first, and collapsing them back into one column would
  break one of the two surfaces silently. The old single test asserted an `auto` topic reads
  back as `auto` everywhere, which was the pre-gate contract and only passed because nothing
  evaluated the threshold yet. It is now two: the override rule is tested with `off`, the one
  class of mode the gate can never veto, and a second case pins the fold itself — an `auto`
  topic with no review history reads `draft_only` while still naming `auto` as the topic mode.

  Separately, a conversation on a topic whose effective agent mode is `off` could go silent
  with nobody watching. `needs_human_attention` was only ever raised by the agent calling
  `conv_request_human`, and on an `off` topic the agent never runs — so once a teammate had
  replied (which clears the flag), a follow-up from the customer left the conversation
  unflagged, unclaimed, and filed under "In progress", where it reads as though the agent
  owns it. Inbound end-user messages now raise the flag when nothing else can answer.

  The check runs on every inbound text path — widget, email, and the generic webhook channel
  ingest — because those write `conv_messages` directly rather than going through
  `sendMessage`. Voice is deliberately untouched: the vendor's assistant owns that response
  loop. An already-flagged conversation keeps its original `needs_human_attention_at`, so the
  "stopped 2h ago" age doesn't reset on every new message.

  The automation console is rebuilt to the Munin Oversight design: a topic row now reads
  topic / volume / approved-unedited / policy, with one Edit button opening a policy dialog
  instead of inline selects and duplicated hold labels. The dialog offers four policies as
  described radio rows — channel default, always human, drafts only, auto-send — plus an
  ≥85/90/95/98 gate that only appears for auto-send, and tells you whether that gate is
  sending right now or still holding.

  That table stops being a table on a phone. Four columns inside a 760px minimum meant the
  page scrolled sideways at every phone width, so the policy — the one thing you came to
  change — sat off-screen. Under `md` each topic stacks instead: name and description, then
  the approved-unedited percentage with a label where the column header used to be, then the
  policy and its Edit button on one line. The weekly-volume column and the percentage's
  progress bar are dropped there rather than shrunk; volume is context for a decision, not
  the decision, and a bar that restates the number beside it earns none of the width it costs.
  Both are unchanged from `md` up, where the grid still holds.

  New topics default to `draft_only` rather than inheriting the channel default: a topic
  nobody has judged yet should draft, not auto-send. Inheriting stays available as a
  deliberate fourth policy ("channel default"), so existing topics with no override keep
  their meaning — nothing is backfilled.

  A conversation you hold the claim on now stays in "Needs your attention" for as long as you
  hold it. Previously it dropped to "In progress" the moment you replied, because the section
  was gated on `endUserSpokeLast` — so the conversations you had personally picked up
  scattered between two sections depending on who happened to have spoken last, and the ones
  where you were waiting on a customer looked like the agent's work. A claim is a statement
  that you own the outcome, not just the next message. A flagged conversation someone else
  holds still sits in "In progress": it is theirs to finish.

  `draft_only` now means what it says on a conversation a human has claimed: the agent drafts
  on every new customer message, claim or not. Previously the claim check ran ahead of the
  mode and skipped the agent entirely, so a topic set to drafts-only produced nothing the
  moment someone took the conversation over — exactly when a suggestion is most useful — and
  the only way to get one was the explicit "ask for a draft" button.

  Auto-send is unchanged: the agent still refuses to _send_ on a claimed conversation. The
  claim gate now applies to delivery, not to thinking, so `delivery === 'send'` is what it
  tests.

  That change alone would have destroyed work. The composer seeded itself from an arriving
  draft with `setReply(draft.body)` and no guard, so a draft landing while you were mid-reply
  replaced your text silently. A draft now only fills an empty composer; anything you have
  typed wins. The explicit ask-for-a-draft path still streams over the box, because there you
  asked for it.

  The console now shows when the agent is working on a conversation you didn't ask it to
  draft. `ConversationQueueItem` gains `agentWorking`, read straight off the runner lease
  (`runner_holder` plus an unexpired `runner_lease_expires_at`) that `tryAcquireConversation`
  already writes — so it is the actual state of the runner, not a guess, and needed no new
  event. Rows and the pane reuse the existing "the agent is drafting…" badge, and the queue
  takes one extra poll 1.5s after an inbound message because the runner claims the
  conversation just after the message event lands.

  Only a draft you asked for locks the composer. Autonomous drafting shows the badge but
  leaves the keyboard alone: taking the textarea read-only for the few seconds the model runs
  would interrupt someone mid-sentence, which is the same reason a landing draft no longer
  overwrites typed text.

  The audit pass that runs after each agent turn now sees the conversation, not just the last
  message. It previously received only the newest customer message plus the reply, and decides
  from that whether to close the conversation, snooze it, mark it spam, or request a handover
  — judgements that are close to unmakeable without context. A customer answering "Kult!!!!"
  to a substantive answer read as a goodbye and the thread was closed under a reply that had
  just asked "anything else?"; the same conversation had earlier been marked spam, because one
  short line in isolation is indistinguishable from junk. The last 10 public messages now go in
  as `[Conversation so far]`, fenced with `fenceUntrusted` since they are third-party text, and
  the auditor is told to read a short reaction mid-thread as continuation rather than a
  sign-off.

### Patch Changes

- f781f5f: Align the console and settings shells: drawer, mobile bar, and sidebar width.

  The two shells had drifted into three visible differences on the same account.

  The mobile drawer opened as a full-width sheet on `bg-paper` in the console and a
  320px panel on `bg-bone` in settings, and each rendered its navigation differently —
  the console had a `mobile` variant of `NavList` with borderless 52px rows, settings
  reused its desktop tree. The console drawer now takes the settings panel: same width,
  same surface, same nav treatment, which removes the `mobile` variant entirely so both
  shells render one list in both places. The console keeps its logo, brand and user
  footer, since those are its identity and its only route to sign out.

  The mobile top bar was bone in the console and white in settings. Neither header
  declared a background: `DashboardShell` roots at `bg-bone`, and the settings branch
  wraps children in `bg-paper`, so each header simply inherited whatever its ancestor
  happened to be. Both now set the bone surface explicitly rather than depending on
  that.

  The desktop sidebar was a 280px grid column in the console and `w-72` — 288px — in
  settings. Settings now matches at 280px.

  One deliberate loss: the console drawer's explicit close button is gone, because the
  settings drawer it now matches has never had one and `SheetContent` ships no built-in
  close — both dismiss by backdrop or Escape. Adding a close affordance to both shells
  would be the better end state and is not done here.

  `nav.closeMenu` is now unused in this repo but kept, since `dashboard-pages` is shared
  with the cloud web app.

- f781f5f: Reviewing a CMS draft now leads with the page itself. The drawer fetches the preview link as soon as the draft opens and embeds it in a sandboxed frame behind a Preview/Fields tab pair, with a direct "open on the site" link alongside. A frame that never paints — the site refuses to be embedded, or does not answer inside fifteen seconds — falls back to the field view with a marked tab, an explanation, and a retry, rather than leaving a blank rectangle. The old approach opened a blank tab first and navigated it after the link resolved, which browsers increasingly treat as a popup and which gave no signal when the preview failed.

  Every review pane's footer now fits one line on a phone. The primary action stretches to fill the row and the rest collapse into a bottom sheet behind a single "more actions" button, replacing footers that stacked three or four full-width buttons and pushed the content out of view. On mobile the panes also drop their own headers and eyebrows, since the surrounding shell already names the item. CMS drawers gain the same load-failed and loading states the other panes have, and their padding matches the rest of the console.

  Two visual corrections: the confidence, channel and kind badges in the review panes are `Pill`s rather than hand-rolled spans — which is what the new `fill="solid"` variant is for — and avatar chips use ink instead of cobalt, so cobalt stays the accent it is everywhere else.

- f781f5f: Split the oversight composer's action row by the object each action acts on.

  The row had grown to five controls (six with "ask for a draft") that answered three
  different questions: verdicts on the conversation (send, close without reply),
  operations on the draft (reject, restore, ask for a draft), and operations on the
  claim (release). Restoring the agent draft is not even a conversation action — it is a
  client-side undo of the reviewer's own edits, with no request behind it.

  Release and restore now sit in the composer's status strip, each attached to the fact
  it undoes: `yours · release` and `edited by you · restore draft`. Both were already
  conditional on exactly the state that renders their label, so nothing new is gated.
  The bottom row keeps only what ends the review — send, reject, close without reply —
  which caps it at three controls. Closing without a reply used to be a smaller mono link
  pushed to the far right; it is now a ghost button sitting with the other two, since it
  is a verdict on the conversation like they are, and its weight rather than its size is
  what marks it as the rarest of the three.

  The strip states only what nothing else on screen already says. "Agent draft" and "no
  draft" are gone: a pre-filled box under an "approve & send" button is a louder statement
  that a draft arrived than a 9px label is, and an empty box with no approve button says
  the opposite just as well. What is left is the transient run ("thinking", "writing") and
  "edited by you", which is the one draft fact no button implies — and the fact that
  "restore draft" undoes. Ownership states for conversations that are not yours are
  unchanged. The queue row keeps its own no-draft badge, where triage does need it.

  The hairline actions are desktop-only. On a phone the expanded composer puts release and
  restore behind the ⋯ menu in its dialog header, next to close, leaving the strip as a
  pure status line. Underlined 9px mono is a pointer idiom — it wants hover and precision,
  and as a touch target it is far under the minimum — so the overflow that was wrong for
  desktop, where there was room to show both actions outright, is right here. Nothing
  becomes unreachable on mobile, which hiding them outright would have done: release now
  lives only in that strip.

  The whole strip is muted. Cobalt is left to the transient run only, where the pulsing
  dot already earns it; a tinted "edited by you" sat directly above a cobalt focus ring
  and a cobalt send button, and three blues stacked vertically read as three competing
  claims on the eye rather than one hierarchy. The two hairline actions carry an underline
  and hover to ink rather than cobalt, matching the state-label-plus-dismiss pair in
  `inbox-conv-drawers.tsx` — in mono micro-text this dashboard uses cobalt for live state,
  never for affordance.

  "Edited by you" and its restore action are hidden together on the internal-note tab —
  one condition drives both, so the label can never appear without the action it anchors.
  There, the visible field is the note, so the label would have described something off
  screen and restore would have silently rewritten it. The states that outlive the tab
  switch — thinking, writing, unclaimed, owned by someone else, closed — still show.

  "Reject" is now "Reject draft" — bare "Reject" did not say what it acted on, and it
  sits next to "Send reply", which does.

- f781f5f: Give the composer's action-failure banner an error tone instead of the accent one.

  It rendered in cobalt with a pulsing dot, which said the wrong thing twice. Cobalt is
  this dashboard's accent and, in the console, its live-state colour — so a failure was
  drawn in the same hue as the send button directly beneath it, and "take-over failed" read
  as something to act on rather than something that went wrong. The pulse claimed the
  opposite of the truth: an action that already failed is settled, not in flight.

  Now `text-destructive` with a static dot, matching `StatusLine`'s `tone: 'error'` in
  `card-kit.tsx`, which is the dashboard's canonical dot-plus-label pattern and already
  pairs the destructive colour with an unanimated dot. The dot stays `bg-current` so it
  tracks the text, and `role="alert"` no longer ships an animation with it.

  The load-failure hero loses its pulse for the same reason. Its colour was already right —
  it uses the `alert-bad-*` token family meant for page-level alert surfaces — but a failed
  load is just as settled as a failed action.

- 980dfac: Rebuild the dashboard home as two sections that link out, and retire the drawers.

  "Overview" is now "Dashboard" — the route has always been `/dashboard`, only the
  sidebar label lied — and the page is two symmetric blocks mirroring the Oversight
  nav: Conversations and Review. Each is a count, up to five rows and a way in, with
  the usage strip below them as a footer.

  The page had been four blocks at three altitudes: a one-row live stat, a scheduled
  list borrowed from Review that rendered with its own bespoke row and cancel dialog,
  the usage KPIs, and three off-screen Sheets. The scheduled list is now a single
  countdown line, and it links to the scheduled item rather than to `/dashboard/review`
  — a bare link lands on the Waiting tab, because the Review page resolves its tab from
  the selected id. Decided is gone from the dashboard: it is an audit trail you go
  looking for, never a glanceable number.

  Rows navigate to `/dashboard/conversations/<id>` and `/dashboard/review/<id>` instead
  of opening a drawer, so the page that owns each pane owns it everywhere. That deletes
  a duplicate as well: `useInboxData` carried its own `send` / `takeOver` / `release` /
  `closeConv`, reply state, a per-conversation detail cache and its error maps, all of
  it feeding the conversation drawer alone, while `useConversationQueue` has implemented
  the same actions for the Conversations page throughout. The KB body fetch goes with
  them — `ReviewKbPane` reads `item.raw.body` off `/v1/inbox` and never used it.

  The Conversations count and its rows come from two sources on purpose. `/v1/inbox`
  answers "needs a human" and returns `LiveSummary`; the rows want `QueueItemDto`, so
  they are a separate one-shot `/v1/conversations/queue` read. `status=open` there is
  load-bearing — omitting it applies no status filter at all, which would pull closed
  and spam conversations into "recent".

  Second commit is a pure rename with no logic hunks. `queue-drawers/` had not been
  drawers since Review became a split view: `QueueDrawer` and `ScheduledDrawer` are the
  right-hand pane, wrapped by `ReviewBlockingPane` and `ReviewScheduledPane`. The
  directory is now `queue-panes/`, the components `QueueItemPane` / `ScheduledItemPane`
  / `*QueuePane`, and `shared.tsx`'s `Drawer*` helpers `Pane*`. The controller's
  `queueDrawer` / `scheduledDrawer` become `activeQueueItem` / `activeScheduledItem`,
  which is what they are — they render nothing, and only trigger the lazy fetches for
  the CMS body, the CMS preview link, the outreach evidence and the `viewed` POST.

  Deliberately left for later: `queue-panes/kb.tsx` and `crm.tsx` are unreachable
  (`partitionReviewQueue` sends every KB item to `ReviewKbPane`, and `ReviewBlockingPane`
  short-circuits CRM to `ReviewCrmPane`), but deleting them means narrowing
  `QueueItemPane`'s `item` prop so the switch stays exhaustive — a refactor, not a
  deletion. `InboxController.connectionStatus` has no consumers. And the
  `dashboard.overview.drawer.*` message group is now read only by the queue panes and
  the Review split view, so it belongs under `dashboard.console.review.pane.*` — about
  100 keys across two locales, large enough that it would bury the diff here.

- 602b390: Align the dashboard's two list sections with each other, and the relay forwarding address with the form it sits in.

  - **Waiting rows now match conversation rows.** `ReviewRow` had drifted from `ConversationRow`: a flex row instead of the `[52px_minmax(0,1fr)_auto]` grid (so titles started at a different x), a 15px title against 14px, a `text-ink-mute` second line against `text-ink-soft`, and an `uppercase` age that rendered `6D` next to the conversations' `3h`. Stacked on the overview page the two sections read as two different components; they are now one row shape with one type scale. `ReviewRow` also backs the Review page's waiting tab, so that list picks up the same shape.
  - **Dropped the "Munin will generate an address under … when you save" line.** It only ever appeared in the create dialog, promising a value the form was about to produce anyway; the address then shows up as a real field on the channel afterwards.
  - **The forwarding address reads as a form field.** `CopyField` gains a `field` variant — form-input chrome (`rounded-input`, `border-rule-soft`, `bg-paper`, matching height and padding) instead of the heavy ink-bordered plate — and `CopyableSecret` passes the hint through `dialogHintClass` in that variant. The plate stays the default: in the one-time reveal dialogs (tracker keys, widget keys, invite links) the emphasis is the point. Only the inline relay field opts in.

- f781f5f: Rebuild the Learning page as a persistent split, and show recent decisions under the queue.

  The page was a single scrolling column of cards, each carrying a proposal's full body
  and its own publish/dismiss pair. Reviewing the fourth proposal meant scrolling past
  three complete articles, and there was no way to hold one open while looking at the
  list. It now uses the same index-and-reading-pane split the conversation queue already
  established: proposals on the left as compact rows (kind, title, target space, age), the
  selected one on the right as the working surface, with the action bar pinned to the
  bottom of the pane rather than trailing the body.

  Selection lives in the URL — `/dashboard/learning/:id` — pushed shallowly the way the
  conversation queue does it, so a proposal can be linked to and the back button walks the
  review. On desktop the first row is selected automatically on arrival, via
  `replaceState` so that auto-selection does not become a history entry the back button
  has to climb over. On a phone the list and the pane are mutually exclusive, and arrival
  still lands on the list: jumping straight into a full-screen proposal would skip the
  browse step that makes the queue legible. A routed id that is no longer listed falls
  back to the list instead of rendering an empty pane, which also means publishing or
  dismissing moves you to the next proposal rather than leaving you on a dead one.

  The page also only ever showed what was waiting. Everything already ruled on vanished,
  which made "every edit teaches" hard to believe, since the record of what was taught was
  the one thing not on screen. Decisions from the last seven days now sit in a second
  section of the same list, below the open proposals, over the existing
  `GET /v1/kb/curation/decisions`. One list rather than tabs, because the two are read
  together — what is waiting, and what just happened to the neighbouring articles — and a
  tab would have hidden the half that gives the other its context. The window keeps that
  section from growing into an archive the queue has to scroll past; older decisions are
  still available through the API and the MCP tool.

  Decided rows are attributed: `CurationDecisionDto` gains `decidedByName`, resolved by
  left-joining `users` on `decidedByActorId` when the decider was a person, the way
  conversation claims already resolve `holderName`. Agent decisions carry a null name and
  render as "Agent" — the actor type drives that label, not the absence of a name, so a
  person whose record no longer resolves reads as "Unknown" rather than being misattributed
  to the agent. Decided rows also carry the queue's scroll-linked fade, so the section
  reads as settled history until you scroll to it.

  The decided pane shows what was actually decided, not just that something was. A
  published decision loads the article it produced — `kb_curation_decisions` keeps
  `published_document_id`, and a new `GET /v1/kb/documents/:id` fetches it on selection —
  and renders the body in the same reading treatment as a proposal. Without it the pane
  was four lines of metadata under a headline, which is a poor argument that every edit
  teaches: the one thing missing was what got taught. The body is rendered verbatim rather
  than through the proposal pane's `stripLeadingHeading`, which exists because candidates
  tend to repeat their title as an H1; a published article has no such guarantee, and
  stripping would silently eat a real opening section heading.

  Dismissed decisions say plainly that the text is gone rather than showing an empty
  panel. Dismissing hard-deletes the candidate and its versions cascade with it, so the
  decision row's `title` and `reason` are all that survive — an asymmetry worth stating in
  the UI instead of leaving the reader to wonder what is missing.

  Corrections, the third section in the original design, is deliberately absent. Its rows
  mixed direct edits to published documents with rejections of proposals, and the latter is
  what the decided section already covers; the two would have double-counted. A feed of
  direct KB edits is a separate surface over `kb_document_versions`, not a variant of this
  one.

  Publish and dismiss are unchanged in behavior but now match the conversation composer's
  button sizing, including the 44px touch target on mobile. Both panes take that pane's
  horizontal padding too, and the source-conversation link drops cobalt for the muted
  hairline treatment the composer's status actions use — in this dashboard's mono
  micro-text, cobalt marks live state, not every link.

  The section label both list columns use is now one `ConsoleSectionLabel` rather than a
  copy in each page — the copy is what let them drift in the first place. It gains a rule
  below it, and its padding is even top and bottom: the original `pt-4 pb-2` leaned the
  label toward the rows beneath it, which reads as grouping while the label floats, but as
  a misaligned box once it has a border. The conversation queue picks up both changes.

- e464792: Deny the control plane to `member` sessions by default, and open the inbox back up explicitly.

  The console has presented `member` as an inbox-only role since the oversight rebuild —
  `OSS_CONSOLE_GROUPS` marks Overview, Automation, Review and Settings `adminOnly`,
  `/dashboard` redirects members to `/dashboard/conversations`, and `SettingsShell`
  bounces any non-admin. The backend never agreed. `RoleGuard` refuses `'member'` as a
  gate on purpose ("all org members pass"), so the only closed routes were the ~20
  carrying `@RequireRole('owner', 'admin')`. Everything else was open to a member with a
  session cookie: `GET /v1/crm/export`, `/v1/kb/export`, `/v1/conv/export` (every message
  body in the org), `/v1/cms/transfer/export`, `/v1/analytics/export/events`, their `POST
…/import` counterparts, the whole Review feed _including_ its writes —
  `kb/curation/candidates/{id}/publish`, `crm/merge-proposals/{id}/apply`,
  `cms/drafts/{id}/approve` and `outreach/proposals/{id}/approve`, which is the human gate
  that actually sends mail in the org's name — plus `/v1/curator/jobs` and its
  claim/fail/progress endpoints, `/v1/inbox`, `/v1/overview/*`, `/v1/activity`,
  `/v1/orgs/me`, `/v1/orgs/me/roster` and `/v1/skills`. UI-level hiding, no authorization.

  Enumerating the closed set was the wrong shape: it is ~60 routes, it grows with every
  new controller, and a controller added tomorrow joins the open side silently — which is
  how this drifted in the first place. So the default is inverted instead.
  `ControlPlaneGuard` — already on all 37 control-plane controllers, unlike `RoleGuard`,
  which 21 of them never applied — now admits a user actor only when their role in the
  active org is `owner` or `admin`, or when the route opts in with `@AllowMember()`. An
  unrecognized future role starts closed rather than open. Refusals carry
  `code: 'member_forbidden'` with an `errors.member_forbidden` entry in both locales,
  since a member who types an admin URL will see it.

  The member surface is now eleven routes, pinned by `member-surface.test.ts` so widening
  it has to be a deliberate diff: the eight inbox routes the conversation pane actually
  calls (`queue`, `{id}`, `messages`, `status`, `take-over`, `release`, `request-draft`,
  `clear-draft`), `/v1/me/memberships` for role and org resolution, `/v1/overview/setup`
  for the first-run copy, and `/v1/oauth/pending-org` so a member can still authorize a
  connector — `gateOauthGrantsByRole` already assumed members complete that flow and just
  lose `mcp:admin`.

  Session credentials now carry the resolved membership role on `ActorIdentity.orgRole`,
  so the common path costs no extra query. The guard falls back to reading `org_members`
  when a credential arrives without one, which is what keeps a host that builds its own
  session credentials — cloud — protected rather than locked out.

  Two consequences worth naming. The console's queue badge came from `/v1/inbox`, which
  mixes live conversations with the review feed and is now admin-only, so the shell reads
  `/v1/conversations/queue` for non-admins instead and shows no review count; the badge
  keeps working for members rather than silently sitting at zero. And the realtime
  gateway is untouched: it authenticates its own WebSocket upgrade outside Nest guards, so
  a member's socket still receives `kb.*` and `crm.merge_proposal.*` event notifications on
  the org channel. Those carry ids and types rather than record bodies, and closing that
  seam is follow-up work.

- f781f5f: On a phone you can no longer send a draft you were never shown

  The mobile review pane offered Approve & send as its primary action the moment a draft
  existed, but the draft itself appeared nowhere on that screen: it lives in the composer
  textarea, and on mobile the composer is collapsed to a bar. The thread doesn't render it
  either — pending drafts are filtered out of the message list. So the one-tap path sent an
  agent-written reply to a customer sight unseen, and the only way to read it first was to
  notice that the secondary "Edit draft" button happened to open the full-screen editor.

  The collapsed bar now carries a single full-width Review draft button. Approve & send and
  Reject draft both live in the editor it opens, where the text is on screen — a verdict on
  a draft is only reachable from a screen showing the draft. Rejecting blind was the quieter
  half of the same problem: a reject counts against the topic's approved-unedited share, so
  it moves the auto-send gate on evidence nobody read.

  The no-draft state gets a matching button, in place of the bar styled as a text input. It
  read as somewhere to type, which on a phone it never was — tapping it opened the editor. It
  now says what it does and carries the same arrow: Write reply, or Continue reply when one
  is already in progress, so half-written text stops being invisible behind a placeholder.
  Ask for a draft sits beside it unchanged, and while the agent works the button carries the
  Thinking / Writing state instead.

  The editor's own gutters line up while we're here. Its header sat at 16px and the
  reply/note tab row under it at 20px, a step visible against the textarea below (16px) — the
  tab row and the action-failure banner were the only two strips in the footer that hadn't
  been given a mobile value, so they kept the desktop one at both sizes. Both are 16px on
  phones and 20px from `md` up now, and the overflow-menu trigger is pulled out by its icon
  button's own inset so its glyph aligns with the close control above it.

  Opening the editor onto an unedited draft no longer focuses the textarea. Focus raises the
  keyboard, which covers most of the text you opened the screen to read; you get the keyboard
  by tapping into the draft, which is also the moment you meant to edit it. Every other way
  in — the note tab, an empty composer, a draft you have already touched — focuses as before.

- f781f5f: Settings is admin-only, the console sidebar grows a user menu, and mobile stops hiding its own controls.

  A support agent used to keep Workspace → Account in the settings nav, whose only content is the organization name — an admin-only field. `PATCH /v1/orgs/me` already carried `@RequireRole('owner','admin')`, so the form was never a hole; it was a dead end that always ended in a 403. Settings now filters out for non-admins in both the console nav and the settings shell, `/dashboard/settings/*` bounces a member to conversations, and the system-alert banner drops its call to action for members since every target is a settings page they can no longer reach.

  Signing out no longer lives at the foot of the settings nav, since a member can no longer reach it. Both the desktop sidebar and the mobile menu sheet now end with the signed-in user — avatar, name, and an overflow menu holding Sign out — sharing one footer component instead of the sheet-only variant that existed before.

  The membership cache is keyed to the session user, so signing out as an owner and back in as a member reflects the new role without a hard refresh; previously the module-level cache survived the client-side navigation through `/login` and kept serving the first user's role.

  A draft is only produced when the customer wrote the last public message. Asking otherwise gives the agent nothing to answer, and the draft comes back greeting whoever spoke last — a teammate, by name, as though they were the customer. The runtime labels operator turns correctly as `[Human teammate]`, so this was an ill-posed request rather than a misread transcript. The runtime now enforces that in every mode and the dashboard hides "Ask for a draft" on the same condition, so the button never offers a request the runner will drop. Internal notes never count as the last word.

  Three paths previously disagreed. The on-demand path was exempt from the check entirely, which is how a draft could be requested with nothing to answer. The automatic path treated an operator's own message as something to reply to, reachable once a claim expired. And a draft request after the agent had already replied was allowed as a deliberate "follow-up proposal" — a feature dropped here in favour of one rule that holds everywhere, since a button offering a follow-up is indistinguishable from one offering a reply.

  "Ask for a draft" is gated on holding the claim rather than merely on the conversation being open, so it no longer sits beside "Claim to reply" offering an action that lands in someone else's lane. That leaves the unclaimed footer with just the claim button, and the one remaining call in that branch was dead code once the condition tightened.

  The unclaimed conversation's caption is gone — the "Claim to reply" button beside it already said the same thing, so the sentence explaining that claiming is needed to reply was restating its own call to action. The caption naming a teammate who already holds the claim stays, since that one carries information the button does not.

  A claimed conversation whose last public message is from the customer now sorts under "Needs your attention" rather than "In progress". The section was driven entirely by the persisted `needsHumanAttention` flag, which nothing sets when a customer simply answers a thread you already hold, and the queue payload carried no notion of who spoke last — so the read model gains a derived `endUserSpokeLast` rather than widening what that flag means. It stays scoped to conversations you hold; extending it to unclaimed rows would sweep in every unanswered auto-mode thread.

  The queue's tally strip above the list is gone, along with its three strings in both locales. Each section already states its own count in its heading, so the strip restated them a second time before the list had even started.

  An empty "Needs your attention" drops its heading rather than announcing that nothing needs you; the queue reads as a list of work, and a section that is always present but usually empty is noise. Its message is deleted from both locales.

  A closed conversation offers a Reopen button instead of only stating that it is read-only, which left the dashboard with no way back from a close — the status endpoint already accepted `open`, nothing surfaced it. Both the mobile and desktop composers share one footer for that state.

  Returning to the queue works after reloading a conversation directly. The detail route passes its id as a prop, and the pathname match fell back to that prop the moment the URL became the queue's — so the back control rewrote the URL while the pane stayed put. The queue's own path is now authoritative over the prop, which only ever mattered on a reload since a client-side visit renders the queue route with no prop at all.

  The full-screen mobile composer no longer hides its own send button behind the keyboard. It was `fixed inset-0`, which measures the layout viewport — but an on-screen keyboard shrinks only the _visual_ viewport, so the actions sat underneath it and had to be scrolled to. The overlay now covers the whole layout viewport so nothing shows through beneath it, while an inner wrapper tracks `visualViewport` height and offset through CSS variables — collapsing to `display: contents` above the mobile breakpoint so the desktop composer keeps its original layout. The composer's header carries the conversation's subject and topic instead of just the customer's name.

  On mobile the conversation's own header is gone, and its title and topic move into the app bar beside the back arrow, which is the only chrome a phone has room for. The bar takes them through the same context the back action already travels on. Its detail line and identifier stay desktop-only.

  On mobile the shell was measured with `h-screen`, whose `100vh` ignores the browser's own chrome on iOS, so the conversation footer — "Claim to reply" — sat underneath Safari's toolbar and could not be tapped. The shell and the document body now measure in `dvh`. The conversation pane's back link also moves out of the column header into the app header, where it replaces the hamburger for the duration of the detail view, via a small context any page can use to publish a mobile back action.

- 1378212: Oversight console polish round two. Handover reasons are now recorded as internal agent notes instead of system divider messages (`requestHandover` accepts `postSystemNote: false`, and migration 0086 deletes old draft-park dividers and converts reasoned ones to the note shape). The runner's draft-request mode survives transcripts that end with a staff turn, withholds `conv_request_human`, and reports failures as internal notes. The console gets the review-driven UI batch: two-phase Thinking/Writing composer states with a locked input, per-action button spinners, auto-growing textareas, a compact mobile composer that expands to a full-screen editor, shallow conversation selection (no list remount flash), subject-first pane header, sticky settings rail, and the on-duty roster card removed.
- f781f5f: Follow-ups from the oversight code review. The conversation list pager's cursor now carries the needs-attention flag so resuming across the attention boundary drops no rows, and the list tiebreaker matches the cursor (id, not createdAt); the list and queue endpoints share one query parser and the invalid-status error carries the `conv_invalid:` prefix. The review pane surfaces a detail-load failure with a retry instead of spinning forever, the mobile full-screen editor gains dialog semantics (role, Escape to close, focus on open), and the queue's scroll fade is driven by a CSS variable so scrolling no longer re-renders every row. The learning page reports when past decisions fail to load and labels its published/dismissed counts as recent. `SetDraftReplyOpts` is exported from the runtime and reused by the in-process client, the nav-group extension helpers share one generic implementation, agent settings gating keys off `ACCOUNT_SETTINGS_HREF` instead of a URL suffix, and the live-now dot's halo derives from the accent token in both themes.
- f781f5f: Give the conversation pane the shared load-failure state instead of a bespoke one.

  When a conversation's detail fetch failed, the pane rendered its own small block: a mono
  eyebrow, the translated message, and an outline retry button. The eyebrow used
  `text-ink-mute` — byte-identical to the "select a conversation" empty state a few lines
  above it — so a failure looked like an empty pane rather than something that went wrong.
  It also dropped the diagnostics: `detailErrors` stored `translateErr(err)`, a string, so
  the `ApiError` and with it the request id were discarded at the point of capture. A page
  level failure hands the user a request id to quote; this one left them with nothing.

  `LoadFailed` gains a third size, `pane`, beside `inbox` and `settings`. It keeps the
  alert eyebrow with its dot and the `request_id` / `endpoint` / `status` table, and drops
  the display type to `text-2xl` so it fits beside a working list — the `inbox` size is a
  56px headline, which inside a split pane would claim the whole app is unreachable when
  one fetch is. At `pane` size the heading renders as `h2`, since the list column beside it
  already owns the page's `h1`. No auto-retry hint: unlike the queue load, a failed detail
  fetch has no interval behind it, and the page-level copy would have promised one.

  `detailErrors` on the conversation queue controller now holds the `ApiError` itself, and
  `usePaneLoadFailedProps` translates it for the lede at render time — same message as
  before, with the diagnostics still attached. The overview drawer's own `detailErrors` in
  `inbox-data.ts` is a separate controller and keeps its string shape; it is a different
  surface and is not converted here.

- f781f5f: Report publish and dismiss failures inline instead of as a toast.

  `inbox-data.ts` carried two conventions for the same kind of event: conversation actions
  (`takeOver`, `release`, `closeConv`, `send`) recorded an `actionError` the pane renders as
  a dismissible banner, while queue actions called `notify.error` and vanished after
  Sonner's default four seconds. Nothing chose that line — it fell out of the two paths
  being written at different times.

  A toast is the wrong instrument for publish specifically. On failure `loadInbox()` is
  skipped, so the proposal stays exactly where it was, which is indistinguishable from a
  click that never registered — the toast is the only evidence, and it removes itself. The
  likeliest failure is also the one that most needs to persist: publish sends `ifVersion`
  (or `ifCandidateVersion` + `ifDocumentVersion`), so a concurrent edit comes back a
  conflict, and "someone changed this, reload" is an instruction rather than a notice.
  The rebuilt Learning page finally gives that message somewhere to live — the pinned
  action bar sits under the proposal it acts on, which the old card feed and drawer did not
  offer.

  `approveQueue` and `dismissQueue` now record a `queueActionError` and return whether they
  succeeded, mirroring the conversation queue's `runAction`. Both surfaces that call them —
  the Learning pane and the overview queue drawer — render the same
  `QueueActionErrorBanner`, keyed to the acted-on item so a stale error cannot appear
  above a different proposal. The returned boolean also stops the decided list from
  refetching after an action that decided nothing.

  Toasts stay where the anchor disappears or the action is incidental: `saveQueue`,
  `scheduleQueue`, `previewCmsDraft`, and the scheduled-send cancellations.

- 602b390: One row primitive behind every queue list, and one meta-line vocabulary behind every row.

  The dashboard, Conversations and Review pages between them render four list rows — conversations, waiting, scheduled, decided — that were four independent implementations of the same idiom. Each carried its own copy of the `role="button"` + Enter/Space handling, the `px-5 py-3.5` border-bottom row, the hover, the `--qfade` dim, and the active treatment. The active treatment was byte-identical in all four, which is what a shared component looks like before someone extracts it.

  `QueueRow` now owns the chrome and exposes four slots — `code`, `title`, `meta`, `trailing` — with `RowTime` and `RowNote` for the trailing column. The four rows became thin callers, and the differences that were drift rather than meaning are gone:

  - **One title origin.** Conversations put their channel `Pill` in a 52px grid column; review and scheduled used `RowCode` at `w-14`; decided had no code column at all, so its titles started 66px to the left of every other list. All four now sit in the same 52px column, and decided gains the `KB` module pill it was missing — a published article and a dismissed merge no longer render identically.
  - **One timestamp column.** Ages were lowercase in two lists, uppercase in a third, and inlined into the mono meta line in the fourth. They are now a `RowTime` in the trailing column everywhere. Scheduled keeps cobalt, because "this ships without you" is meaning, not styling.
  - **One row height.** Scheduled titles wrapped to two lines while every other list truncated to one.
  - **One second line.** The meta line settles on the muted tone (`text-ink-mute` / `dark:text-foreground/50`) in all four lists rather than the darker `text-ink-soft` the conversation preview used, so the title carries the row and the second line stays subordinate. Decided keeps its outcome word in ink, which now reads as emphasis against the mute rather than competing with it.

  The second line had a subtler problem: `QueueItem.snippet` was built for every kind in `inbox-data.ts`, and then `ReviewRow` ignored it and computed a _second_ meta line from its own `dashboard.console.review.meta*` keys. Same item, two vocabularies, and which one you saw depended on which list you were in — the waiting tab said `sarah@…`, and the same proposal's snippet said `sarah@… — Hi Sarah, following up…`. The review wording (the terser, row-shaped one) now lives in the `overview.queue` snippet keys as the single source, `useMetaLine` is deleted along with the duplicate key set, and rows read `item.snippet` everywhere. No visible change to the waiting list: it already showed this wording.

  The outreach pane's "Reply from" quote was the one place the old snippet was actually rendered, so it now builds that preview from `item.raw` directly and shows exactly what it showed before. (It quotes our own draft body under a "Reply from" label, which looks wrong but is untouched here.)

- 411b50f: Format phone numbers on the end-user list the same way the rest of the dashboard does — an end user identified only by phone now shows `+47 911 05 891` instead of the raw E.164 string.
- b085fe1: Keep a voice turn that transcribed no speech, so a call transcript never loses the beat that explains the next answer.

  A Threll call read as though the assistant answered a question nobody asked: it greeted the caller, then said "Hei Tronn, velkommen til Threll.ai" with no caller turn in between. Nothing was out of order — `voiceTurnIndex` ran 0, 2, 3, 4 and Slack mirrored exactly that. Turn 1 was missing, and Slack's collapsing of two adjacent same-speaker posts into one block made the remainder look shuffled.

  Threll fixes a turn's position when the turn is _registered_, not when its text exists: a caller turn reserves its index and emits an interim, and the final follows when recognition resolves — with an empty string when it resolved to nothing, which is what happens when the caller is cut off mid-word. `ThrellAdapter` dropped every transcript event without text, so that turn vanished. It is now stored as a turn with an empty body and `metadata.voiceNoSpeech: true`, in its spoken position, in real time — no reconciliation pass and no late Slack post, because the empty final arrives on the same webhook stream as every other turn. An _agent_ turn with no text is still dropped; only a caller turn holds a slot worth showing.

  An empty body is the honest record, so the placeholder lives in the surfaces instead: Slack renders `_No speech transcribed_` (`chat.postMessage` rejects empty text), the dashboard drawer renders a muted italic line, the chat widget hides the turn from the visitor who lived through it, and the conversation-list preview skips empty bodies so a call ending on an unintelligible turn keeps its last real line. A silent turn is also not the visitor speaking last: `endUserSpokeLast` skips empty bodies, so the review queue stops offering "ask for a draft" on a turn that carries no question — which the runtime would refuse anyway. The conversation pane's own client-side computation of the same signal matches.

  `toRuntimeHistory` filters bodies that are empty after trimming — an empty user turn is both useless to the model and rejected outright by providers that refuse empty content blocks — and the conversation handler declines to reply when the newest public turn is a silent one, so a straggling final that lands after `call.ended` cleared `voiceActive` can't provoke a chat reply after a voice call.

- Updated dependencies [f781f5f]
- Updated dependencies [a9d71da]
- Updated dependencies [f781f5f]
- Updated dependencies [d443f42]
- Updated dependencies [356885c]
- Updated dependencies [f781f5f]
  - @getmunin/ui@5.16.0
  - @getmunin/types@5.16.0

## 5.15.0

### Patch Changes

- 3252cd1: Bump Next.js to 16.3.4 and other dependencies to their latest compatible minor/patch versions.
- bbbb395: Scope the Threll webhook subscription to the selected worker

  Munin registered its Threll webhook without a `workerId`, so the subscription was account-wide: every worker on the account delivered `call.worker_request`, transcripts and tool calls into one Munin channel, and a second Munin channel on the same account could only be connected by deleting the first one's subscription. Threll supports worker-scoped subscriptions (worker-scoped wins over account-wide for sync events), so Munin now passes `workerId` on create, lists subscriptions filtered to that worker, and only treats a same-worker subscription pointing elsewhere as a conflict — a customer's own account-wide webhook is left alone. One Threll account can now back several Munin channels, one per worker.

  Repointing a channel at a different worker (or account) re-registers the subscription on the new worker and deletes the old one, and re-saving credentials for an unchanged channel replaces its own stale subscription instead of failing Threll's one-responder-per-sync-event check.

  Existing channels keep their account-wide subscription until their worker is changed or their credentials are re-entered; delete the account-wide subscription in Threll and re-save the channel to move it over.

- Updated dependencies [3252cd1]
  - @getmunin/types@5.15.0
  - @getmunin/ui@5.15.0

## 5.14.0

### Minor Changes

- 701413c: Scope a dashboard session's organization per request instead of per account

  The active organization was a single account-wide flag (`org_members.is_default`) that every `/v1/*` request re-read, while the dashboard read the organization name once at page load and cached it. Switching organizations in one tab therefore changed what every other open tab was served, without changing what those tabs displayed — a stale label sitting on top of another organization's data. The same applied to a second browser or device, so no tab-local mechanism could have fixed it.

  Session credentials now accept a requested organization. `CredentialResolver.resolveSessionToken` takes an optional organization id, checks it against the caller's memberships, and refuses with `OrgAccessDeniedError` when it isn't one — it never quietly serves a different organization instead. The control-plane guard reads that id from an `x-munin-org` request header on the session-cookie path only, so API keys and OAuth tokens stay bound to the organization they were issued for, and it maps the refusal to a `403` carrying `code: org_access_denied`. Every authenticated response now echoes the organization that served it in an `x-munin-org` response header (exposed through CORS), and the realtime websocket takes the same id as an `orgId` connect parameter.

  On the client, the dashboard keeps its organization in `sessionStorage`, which is per-tab: a tab pins itself to whichever organization served its first response and stays there, so `is_default` now only decides where a _new_ tab starts. `api()` sends the pin, adopts the served organization when it has none, and — if the pin is refused, which is what a user switching accounts in the same tab looks like — drops it and retries once, so recovery is invisible rather than a wall of errors.

  This is the transport half of the fix. Until the organization also appears in the dashboard URL, server-rendered layouts still read `is_default`, so a tab pinned elsewhere can briefly render the account-wide organization name before the client corrects it.

### Patch Changes

- b0753ee: Card grids on Trackers, Channels and Integrations now share one layout. The settings content column has no max-width, so the Trackers page's two-column grid stretched each card to roughly 600px on a wide viewport — twice the width of a channel or connector card, with a 160px sparkline floating in it. `CardGrid` and `CardGridSkeleton` lost the `columns` prop entirely: every call site rendered three columns except that one, so hardcoding the layout is what keeps the pages from drifting apart again.

  The two Integrations sections also loaded behind a single full-width `CardSkeleton` while Trackers and Channels loaded behind a `CardGridSkeleton`, so the placeholder was a wide bar where the real content is a grid of cards. Both sections now use `CardGridSkeleton` at the card count they actually render — three for connectors, one for the Slack bridge.

- Updated dependencies [a5acd6c]
- Updated dependencies [80d6f34]
- Updated dependencies [701413c]
  - @getmunin/types@5.14.0
  - @getmunin/ui@5.14.0

## 5.13.1

### Patch Changes

- @getmunin/types@5.13.1
- @getmunin/ui@5.13.1

## 5.13.0

### Patch Changes

- @getmunin/types@5.13.0
- @getmunin/ui@5.13.0

## 5.12.0

### Minor Changes

- 1836666: Upgrade better-auth to 1.7.1 and clear the open dependency advisories.

  `@better-auth/oauth-provider` before 1.7.0-beta.4 could issue access tokens for
  unauthorized audiences via unbound resource indicators (GHSA-p2fr-6hmx-4528).
  Munin's `/mcp` gates on scope, so a token minted for one resource being accepted
  at another is directly on-threat — this is the advisory that mattered, and the
  only one reachable outside the build.

  1.7 pays for that fix with schema. Two migrations:

  - `0079_better_auth_account_issuer` — accounts are now keyed by
    `(issuer, account_id)` rather than `(provider_id, account_id)`. `issuer` is
    NOT NULL upstream, so existing rows are backfilled with the synthetic issuers
    better-auth derives for providers that have none of their own:
    `local:credential` for internal credentials, `local:oauth:<providerId>` for
    Google and GitHub. JWKS rows gain `alg` and `crv`.
  - `0080_better_auth_resource_indicators` — the resource-indicator storage the
    fix runs on: an `oauth_resource` registry, an `oauth_client_resource` grant
    table, an `oauth_client_assertion` replay guard, and the columns the provider
    now persists on clients, access tokens and consents. Entirely additive; every
    column is nullable or defaulted, so no backfill.

  Both are idempotent, and both were smoke-tested against a database already at
  the preceding migration with representative rows, not a fresh one.

  Two behaviour changes worth knowing about, both upstream tightening rather than
  anything Munin chose:

  - Dynamic client registration returns `201 Created`, per RFC 7591 §3.2.1. It
    previously returned `200`.
  - A client that registers a loopback redirect URI (`http://localhost:…`) is now
    rejected unless it declares `application_type: "native"`. OIDC defaults an
    omitted `application_type` to `web`, and web clients must use https on a
    non-loopback host. Hosted connectors are unaffected — they redirect over
    https — but a local MCP client that registers `http://localhost:…` without
    declaring itself native will now be turned away at registration.

  Also refreshes the stale `brace-expansion` override floors, pins `nanoid` past
  GHSA-2v37-7h3g-55p8 and `@hono/node-server` past GHSA-frvp-7c67-39w9, and
  deduplicates `@better-auth/utils` to 0.5.0. That last one works around an
  upstream contradiction: `@better-auth/core@1.7.1` peer-pins both
  `better-call@1.4.0` and `@better-auth/utils@0.4.2`, but `better-call@1.4.0`
  itself depends on `@better-auth/utils@^0.5.0`. Left alone, pnpm installs three
  copies of `@better-auth/core`, and the duplicate type identities make the
  oauth-provider plugin fail to typecheck against `BetterAuthPlugin`.

### Patch Changes

- @getmunin/types@5.12.0
- @getmunin/ui@5.12.0

## 5.11.0

### Minor Changes

- 9d09f89: Show on each data-connection card who can actually reach it.

  The Integrations page listed every connector in one undifferentiated section, so nothing told an operator that connecting Bing Webmaster Tools exposes no surface at all to the customer-facing chatbot, while connecting Gastroplanner lets customers cancel their own bookings. That is a material fact when you are about to hand a vendor credential over.

  Audience is a property of the domain's tool surface, not of the vendor, so it is derived from `ConnectorDomain` in the backend (`audienceForDomain`) and carried on both the vendor and connection DTOs rather than recomputed in the dashboard. `commerce` and `bookings` ship admin tools and a self-service half, so they read "Customers + team". `seo` is admin-only — its five `seo_*` tools are `audiences: ['admin']`, `seo:read` is absent from both `CONNECTOR_DOMAIN_SCOPES` and `SELF_SERVICE_SCOPES` — so it reads "Team only". Custom MCP servers are proxied only into end-user agent sessions, so they read "Customers only".

  No enforcement changes: the audience gate, the connector scope map and the delegated-token scope allow-list already decided this. The badge only makes the existing decision visible.

- e055fa3: Teach the connector trunk to authorize by OAuth redirect, not just static credentials.

  `ConnectorAdapter` modelled one kind of credential: something a human pastes into the `/connect/credentials` form once. That covers Shopify, Magento, Gastroplanner and Bing, and it cannot express a vendor that hands out a short-lived access token behind a redirect. Adapters now declare an optional `oauth` capability (`authorizeUrl` / `exchangeCode` / `refresh` / `revoke`) and the trunk drives the rest: `connectors_get_authorize_url` mints an HMAC-signed state, `/v1/connectors/oauth/callback` exchanges the code, and `ConnectorOAuthService` owns the tokens from there. Adapters without the capability are untouched.

  **The redirect was the easy half.** A refresh is a write on a read path: it happens while a read tool is running, inside that request's tenant transaction, and the new refresh token has to survive even when the vendor call it enabled then fails. So refreshes run in their own root-db transaction under `SELECT … FOR UPDATE` on the connection row, re-reading the grant inside the lock so a parallel instance that already refreshed wins rather than both racing to burn the same token, with an in-process single-flight map collapsing concurrent callers in one process.

  The same reasoning has a sharper edge that a test caught: marking a connection `expired` must happen in a **separate committed** transaction. Doing it inside the transaction that then throws rolls the marker back along with the error, so a dead grant would look healthy on the next call and re-fail forever. Refresh failure is now a two-phase operation — release the lock, commit the state change, then raise `connectors_expired` telling the operator to reconnect.

  **Two things this changes for every connector.** `credentialState` grows from `active | pending` to `active | pending | expired | revoked`, and `config.oauth` becomes reserved for the trunk — adapters must not touch it. Since `buildStoredConfig` returns a whole new config, the trunk re-attaches the grant after calling it; `publicConfig` being an allow-list is what already keeps token ciphertext out of DTOs, and the `pending` branch of the connection DTO now strips the grant explicitly rather than dumping raw config.

  An OAuth connection stays `pending` even once its client secret is stored, because a client secret alone can't call the vendor — so `applyCredentials` no longer runs a connection test it would certainly fail, and instead points at the authorize step. `connectors_delete_connection` revokes the grant at the vendor before deleting the row, and treats a vendor that has already dropped it as success, since the local tokens are gone either way.

  Self-hosters can't use Munin's OAuth client, so client id and secret are per-connection config fields rather than deployment env vars.

  Two smaller improvements fall out. `connectors_list_vendors` reports which vendors are `oauth`, so an agent can tell the two setup paths apart before creating anything. And `resolveScope` no longer claims "no active connection configured" when one exists but is unusable — it names the connection and its state, so "expired, reconnect it" stops reading like "you never set this up".

- 2169915: Custom MCP connector: connect any proprietary system as a live tool source for the support agent.

  Orgs can now point Munin at an MCP server they host themselves (`vendor: "custom-mcp"`, new `mcp` connector domain). While the in-house agent handles a conversation, the remote server's tools are composed alongside the built-in ones under an `ext_<connection>_` namespace, so the agent can answer from the org's own system of record — subscriptions, memberships, internal CRM data — without Munin persisting any of it.

  The trust model externalizes the discipline the built-in self-service tools already follow: remote tools take no identity parameters. Munin sends a short-lived ES256-signed identity assertion (`X-Munin-Identity` JWT) on every call, verifiable against a new public per-org JWKS endpoint (`/v1/public/connectors/:orgId/jwks`, keys minted lazily into the new `connector_signing_keys` table).

  The assertion deliberately carries no `verified` boolean. It reports `email_provenance` / `phone_provenance` — `authenticated` (identity-verified widget session or delegated token), `channel_asserted` (an email `From:`, SMS sender or caller ID, all spoofable), or `self_reported` (typed by an anonymous visitor) — and the receiving server decides what each level may disclose. Provenance is computed from the channel the current turn arrived on, not from the end-user record, so an identity that was authenticated once in the widget is still reported as `channel_asserted` when someone later emails claiming to be that person. Unknown channels fall back to `channel_asserted` rather than over-claiming.

  Because the connected server is a _customer-facing_ tool source rather than a toolbox for admin agents, a connection exposes nothing by default: only tool names listed in the connection's `allowedTools` reach a conversation, a call to a withheld tool is refused even if the model guesses the name, and a server with an empty allow-list stays connected and silent. `connectors_test_connection` reports what the server offers versus what is actually exposed, warns about exposed tools the server has not marked read-only, and flags allow-listed names the server does not provide.

  Remote listings are capped at 20 tools, descriptions are sanitized and truncated before reaching the model, results stay fenced as untrusted data, all outbound traffic goes through the SSRF-guarded fetch (new `safeFetchCompat` in `@getmunin/core`), and a down or slow server degrades to "agent runs without those tools" — never a failed conversation.

  Setup follows the existing connector flow (credential link for the bearer token, `connectors_test_connection` probes the server and lists its tools), the dashboard Integrations page gets a Custom MCP card, and `skill://connectors/connect-custom-mcp-server` documents the server contract with a reference implementation to hand to the customer's developers.

  `skill://connectors/connect-external-system` also gains the same caveat for the built-in commerce and bookings connectors, whose self-service tools have always trusted an inbound email `From:` header or SMS sender the same way: fine for order status, not sufficient on its own for anything whose disclosure to the wrong person causes real harm.

  `SectionHead` in `@getmunin/ui` gains an optional `subtitle` slot, and the Integrations page's private copy of that component is deleted in favour of it — the copy had drifted to a smaller heading than every other settings page used.

  The docs site gains an Integrations guide category and a "Connect your own system" guide covering the customer-facing warning, the allow-list flow and the provenance levels — the first guide-level documentation for connectors of any kind.

- c8ed388: Add a search-console connector domain (`seo`) with Bing Webmaster Tools behind it.

  Munin's analytics answer the post-click half of a traffic question — which pages got viewed, where visitors came from, what they searched for on the site and found nothing. A search console answers the pre-click half: what people typed, how often the site was shown, and where it ranked. The point of connecting one is that the same agent can then act on the gap, because Munin already owns the fix (`cms_update_entry`, `kb_create_document`) and now owns a write verb to ask for a recrawl. `skill://seo/improve-search-performance` walks that loop end to end.

  Five admin-only tools on the new `seo:read` / `seo:write` scopes: `seo_list_properties`, `seo_list_queries`, `seo_list_pages`, `seo_inspect_url`, and `seo_submit_urls`. No self-service half — no end user asks about impressions or average position — and no DB work: `connector_connections.domain` is free-text `varchar(32)` and its RLS policy is domain-agnostic, so the new domain is a union widening, not a migration.

  Three things this design commits to, all consequences of search-console data behaving unlike every connector already in the trunk:

  **Reads stay live; nothing is cached.** Bing publishes no per-day ceiling on `GetQueryStats`-style reads (throttling exists and surfaces as `ErrorCode` 4, now mapped to a `502` naming the throttle rather than a bare `500`), so there is no quota argument for persisting vendor data. The real constraint is shape, not volume: `GetQueryStats` takes no date-range parameters and returns every week Bing holds on each call, so windowing and top-N truncation happen in the adapter. Trend-over-time would need history the vendor won't hand over retroactively, and that is a deliberate feature with its own table — not an optimization to smuggle in here.

  **The window reported is the window covered.** Bing aggregates into whole weeks ending Friday and lags 2–3 days, so results are aggregated per query across the requested range — impressions and clicks summed, `avgPosition` weighted by impressions — and the response carries the range actually covered, `null` when nothing fell in range. Echoing back the requested `from`/`to` would have read as precision the data doesn't have.

  **Cardinality is new.** A commerce connection is one store; a search-console connection is one account holding many verified properties. So every verb takes a `siteUrl`, resolved the way `connectionId` already is: omit it when unambiguous, and when several are verified the error names them. `seo_submit_urls` additionally refuses URLs outside the resolved property, and pre-checks the vendor's remaining daily and monthly quota so an over-budget batch is rejected whole rather than partially submitted — a client error, not a gateway error.

  Adding `'seo'` to `ConnectorDomain` deliberately breaks the exhaustive domain map behind the voice self-service tool gate. That map now enumerates self-service domains only, so an operator-facing domain cannot reach an end-user surface by being forgotten; `seo:*` scopes are likewise absent from `SELF_SERVICE_SCOPES` and `CONNECTOR_DOMAIN_SCOPES`.

  Google Search Console fits the same `SeoAdapter` contract but is not included: it is OAuth-only, and `ConnectorAdapter` models static credentials exclusively — no authorize redirect, no refresh rotation, no revocation. That belongs in the trunk as its own change, where the hard part is not the redirect but that a token refresh is a write on a read path inside the request's tenant transaction.

- 9991922: Add Google Search Console to the `seo` domain, behind the same `seo_*` tools.

  This is the payoff for drawing `SeoAdapter` before there was a second vendor: `GoogleSearchConsoleAdapter` implements the same contract, registers into the same domain, and every `seo_*` tool works against it with **no tool-layer change at all**. It authorizes through the connector trunk's OAuth capability, so there is no Google-specific auth code either — an org supplies its own OAuth client id and secret, then approves the Google account by redirect.

  **Where the two engines genuinely differ, the interface admits it rather than faking it.**

  `submitUrls` is optional on `SeoAdapter`, and Google doesn't implement it: Search Console has no URL-submission endpoint (its Indexing API covers only job postings and broadcast events). So `seo_submit_urls` refuses on a Google connection with a message naming the vendor, instead of silently no-op'ing or pretending to queue something. Field coverage differs the same way — Bing reports `httpStatus`, `discoveredAt` and `inboundAnchorCount`; Google reports `detail`, its coverage state, which is the single most useful string it has ("Submitted and indexed", "Crawled - currently not indexed"). `detail` is new on `SeoUrlStatus` and null for Bing. A null field means the engine doesn't expose it, not that the value is zero, and the skill and tool descriptions now say so.

  **Both engines aggregate identically despite reporting differently.** Google honours an exact date range where Bing returns whole weeks, but the adapter still requests `['date', <dimension>]` and folds rows the same way — impressions and clicks summed per key, `avgPosition` weighted by impressions, `ctr` recomputed after aggregation rather than averaged from per-row values. That keeps the returned `window` honestly derived from the rows present in both adapters, so an agent reading one result cannot tell which engine produced it except by the fields that are null.

  Two Google specifics worth recording. The authorize URL sets `access_type=offline` **and** `prompt=consent`, because without forced consent a repeat authorization returns no refresh token and the connection would appear to succeed and then fail on first refresh. And `invalid_grant` on refresh maps to `OAuthGrantRevokedError` while every other token failure stays a vendor error — that distinction is what lets the trunk mark a connection `expired` for a genuinely dead grant without doing so on a transient Google 500.

  Property paths are URL-encoded, so both `https://example.com/` and `sc-domain:example.com` properties work.

  `webmasters.readonly` is a sensitive scope. An org's own OAuth client works unverified against accounts it owns, which is the self-hosting and single-tenant case; distributing one client to customers requires Google app verification (CASA assessment, privacy policy, demo video).

  **Unrelated fix, surfaced by this work:** `runMigrations` now takes a Postgres advisory lock for the duration. Concurrent callers were racing `CREATE EXTENSION IF NOT EXISTS`, which fails with `tuple concurrently updated`. It only bites on a cold database — several integration test files calling `runMigrations` at once — so it never reproduced on a warm local DB and would have shown up as a flaky CI failure in a file unrelated to whatever change added the extra racer. Adding two integration test files here was enough to trigger it.

### Patch Changes

- 0106285: A public reply now retires the pending handover draft, and every conversation opens in one drawer that shows the whole thread.

  An agent that answers and escalates in the same turn writes its `suggestedReply` before the public reply goes out. The runtime used to clear that draft only when the two strings matched exactly, so a paraphrase survived: the customer had already been answered, but the dashboard still opened with the near-identical draft loaded in the composer, one keypress from a duplicate message.

  The rule is now structural and lives in `ConvService.sendMessage`, where it holds for every MCP host and for humans too: a draft is a proposal for the _next_ outbound message, so any public message from an agent or a teammate retires it to `metadata.kind: 'draft_reply_superseded'` with a `supersededByMessageId` link. The row stays in the API for audit, the composer stops offering it, and `preserveAttention` still keeps the conversation flagged for a human. The runtime's string comparison is gone, and both `conv_request_handover` and `conv_request_human` state the retirement rule in their descriptions.

  The dashboard's two conversation drawers are now one. A flagged conversation used to open a review drawer showing the last customer message and a draft with no surrounding thread — while the same conversation opened as a full chat from the recent-conversations list. The merged drawer always renders the thread — minus drafts, which belong in the composer rather than the transcript, so a retired suggestion no longer shows up as an internal note next to the near-identical reply that retired it — and a pending draft prefills the composer under an "ai suggestion · edit before sending" banner with a discard action, so the operator sees what the agent already said before deciding what to add. Sending keeps passing `fromDraftId`, so an unedited approved draft still queues no curation pass and an edited one still curates the delta.

  Sending no longer claims the conversation implicitly — **Take over** is now the only thing that claims it. The live card marks conversations the agent has already answered since the customer's last message.

- bec14d1: Fix three mobile-viewport regressions in the dashboard shell.

  Side sheets were sized with `h-full` on a `position: fixed` element, which resolves against the initial containing block — on iOS Safari that is the _large_ viewport, so the bottom of every drawer sat behind the browser toolbar and the footer actions (approve, dismiss, cancel scheduled) were half-covered. They now use `100dvh` anchored to the top, which tracks the toolbar as it collapses and expands.

  The docs-link row under the Connect MCP snippet on Get started could not shrink: the docs URL is one long unbreakable token, so the flex row overflowed its card and pushed the copy button past the right edge of the viewport. The link may now wrap and the button no longer shrinks.

  The dashboard topbar used an 8px gap on mobile, which left the org selector nearly touching the logo once a `leftSlot` was supplied. Mobile now gets 16px; the desktop gap (which also has a rule between the two) is unchanged.

- Updated dependencies [9d09f89]
- Updated dependencies [2169915]
- Updated dependencies [bec14d1]
  - @getmunin/ui@5.11.0
  - @getmunin/types@5.11.0

## 5.10.0

### Minor Changes

- 3136f2b: KB curation now triggers on what a human changed in an agent draft, not on the fact that they sent it.

  In `draft_only` mode the runtime hands over on every turn, so every approved reply resolved a handover and queued a curation pass. The draft had been assembled from the KB by `kb_search`, so the pass kept proposing documents built out of information the KB had just supplied — a near-duplicate of whatever document fed the draft.

  Sending a draft from the dashboard now passes `fromDraftId`. The backend looks that draft up, compares the two bodies itself (whitespace-normalised, so a reflow is not an edit) and stamps `metadata.approvedDraft` — `{ draftMessageId, draftBody, edited, retrievedDocumentIds }` — on the sent message. An unedited approved draft queues no pass at all: it is positive evidence the KB already covered the question. An edited one queues a pass in delta mode, pointed at the draft and the sent message so it curates the change rather than the reply. A human answering without going through a draft is unchanged, and still curates as a gap.

  The draft the human sent is retired to `metadata.kind: 'draft_reply_sent'` with a link to the message it became, instead of being deleted by the next draft — so the before/after pair survives in the thread. The runtime also records which KB documents it retrieved while drafting (`kb_search` hits, capped at 8), which is what lets a later edit be traced back to the document that carried the wrong fact.

  `skill://kb/review-content` gained a delta mode with a classification table: formatting, tone and personalisation edits file nothing; a changed fact, an added caveat or a withdrawn claim file one candidate covering the change alone.

- 3136f2b: A curation candidate can now propose a new version of a document that already exists, instead of only a new document beside it.

  `kb_propose_curation_revision` files a proposed body against an existing `documentId`; `kb_publish_curation_revision` applies it as a new version of that document, so `kb_list_versions` and `kb_restore_version` roll a bad revision back. It takes two versions — the candidate text that was reviewed and the document text it was diffed against — and refuses if either moved, writing nothing. `kb_publish_curation_candidate` refuses a revision candidate rather than quietly publishing a duplicate.

  This is what a corrected fact should produce. A human editing an agent draft usually contradicts a document the draft was built from, and the old flow could only file a new FAQ beside the stale one, leaving the wrong text in place for the agent to retrieve again.

  Revisions share one review queue with new-document candidates: `kb_list_curation_candidates` carries `revisesDocumentId` plus the revised document's current title and version, and each surface branches per row — the dashboard drawer and the MCP Apps panel render a diff against the current text (new `BodyDiff`, backed by a dependency-free line differ in `@getmunin/types`), the control plane gains `POST /v1/kb/curation/candidates/:id/publish-revision`, and Slack shows the card without a publish button, since its approval value carries only one version. The panel's "loading" state for a candidate body was also unreachable — it reported a load failure while the fetch was still in flight.

  Curation decisions are now keyed by conversation **and** source message (`kb_curation_decisions.source_message_id`). One conversation can legitimately surface several corrections across turns; the old conversation-wide key closed it to curation after the first. Decisions recorded before this keep the whole-conversation lock, so nothing already dismissed reopens. Related: `kb_propose_curation_candidate` accepted `sourceMessageIds` and silently dropped it — the first entry is now persisted.

  `skill://kb/review-content` delta mode now prefers a revision over a new document and says how much to change; `kb_get_document`, `kb_list_curation_decisions` and `kb_propose_curation_revision` are added to the skill's runner allow-list. The skill's step 0 has always required `kb_list_curation_decisions`, which the runner could not call, so "skip already-decided sources" silently never ran.

- 3136f2b: Outreach keeps the draft as first written when a human edits a proposal, and can feed that edit to KB curation.

  `applyRevision` overwrote `draftBody`, so the original text was gone the moment anyone touched it — the proposal recorded that it had been revised, and by whom, but not from what. `original_draft_body` now captures the pre-revision body on the first revision made by a signed-in person; an agent revising its own draft before human review is not a human edit and does not set it. The outreach review drawer renders the two as a diff.

  The column is named for the original rather than for who wrote it: proposals are normally drafted by the curator agent, but `proposedByActorType` can be `user`, and then it holds a person's text.

  Approving a proposal a human edited can enqueue a delta-mode KB curation pass, gated by a new per-campaign `autoCurateEdits` flag that defaults **off**. Outbound copy is edited mostly for tone, length and personalisation, so this is opt-in per campaign rather than on by default; the pass is told to hold this source to a higher bar and file nothing unless the human corrected a fact about the product or the company. A proposal approved exactly as drafted enqueues nothing, and neither does an edit the human reverted.

  `skill://kb/review-content` delta mode now covers both sources — a conversation draft and an outreach proposal — and `outreach_get_proposal` joins the skill's runner allow-list so the pass can read both bodies in one call.

### Patch Changes

- 2e95f5e: Surface scheduled CMS publishes on the dashboard, alongside the scheduled outreach sends that were already there, and let both be opened read-only.

  Scheduled CMS entries were invisible in the dashboard. `CmsService.listDraftEntries` only ever returned `status='draft'`, and the dashboard has no CMS browsing page — the queue drawer is the sole CMS surface. So the moment an operator scheduled a draft from that drawer it vanished from the product: no way to see that a publish was pending, no way to check the date, no way to call it off. It reappeared only when the worker published it. `listScheduledEntries` now backs a `queue.cmsScheduled` array on `/v1/inbox`, ordered soonest-first.

  The old `ScheduledSendsSection` becomes `ScheduledSection`, covering both kinds in one chronological list so "scheduled" reads as one concept rather than an outreach quirk. Rows show a relative countdown rather than a timestamp — "in 4h" is what you scan an agenda for, and the exact time is one click away in the drawer's standing-order strip — so `useRelative` gains a future-facing `useCountdown` sibling; the existing helper only subtracts in one direction and reports every future timestamp as "just now".

  The queue section is renamed **Waiting on you** (nb: _Venter på deg_). "Queue" named the data structure rather than the reader's relationship to it, and the new name earns its place by contrasting with Scheduled: waiting on _you_ versus waiting on the clock — the same distinction the read-only drawer draws with "nothing to approve — this runs on its own". "Needs your attention" was the other candidate and was rejected for overclaiming against Live Now, which sits directly above it and genuinely does need attention first. `dashboard.overview.queue.empty` ("Queue is clear") was removed rather than reworded: nothing has ever rendered it, and its `<accent>` markup had no chunk renderer on this surface.

  Both the queue and scheduled rows drop the per-kind `Pill` for a fixed-width cell holding a shape glyph and a short mono code (`KB`, `CRM`, `OUT`, `CMS`, `FBK`). The pill's width tracked the length of its label, so every title started at a different x and the eye had no edge to run down — the badge was decoration paid for in scannability. The glyphs (hollow circle, diamond, filled circle, square, triangle) are inline SVG rather than `■ ● ○ ◆` text, which falls back to different fonts per platform and breaks both the size and the baseline in a column whose only job is alignment. Shape is pre-attentive and encodes without relying on hue, so the modules separate at a glance and stay separable for colourblind readers. Pills stay in the drawers, where there is one and nothing to align against.

  The two sections are one grid: same code cell, same title x, same right-aligned time column, so the eye keeps both edges scrolling from one to the other. An earlier pass led the scheduled rows with a wide date rail, which read well in isolation but put the two sections' titles ~285px apart and made them look like unrelated tables.

  Rows open a read-only drawer that reuses the CMS and outreach drawers behind a `readOnly` prop, so the content renders through exactly the code that renders it for review. The read-only state is marked three ways, because a drawer that looks editable invites typing: a cobalt SCHEDULED pill in the header, a standing-order strip above the content stating what fires and when, and a footer with no accent-filled primary — every other drawer in the dashboard leads with one. `⌘↵` is inert there.

  Calling off a scheduled publish returns the entry to `draft` and puts it back on the review queue, mirroring the existing outreach cancel; unlike outreach it takes no reason, since nothing left the building. `GET /v1/cms/drafts/:id` already resolved scheduled entries, so the drawer needed no new read endpoint — only `POST /v1/cms/drafts/:id/unschedule`, which rejects an entry that is not scheduled rather than silently drafting a published one.

  Two fixes found along the way:

  `CmsService.transition` did not clear `scheduledAt` on the `draft` branch, only on `published` and `archived`. The `publish-entry` skill already told agents to `cms_unpublish_entry` "to clear the schedule" — that is now true rather than aspirational. Without it an unscheduled entry keeps a stale timestamp, harmless to the worker (it filters on status) but a phantom date to anything reading the column.

  The dashboard's realtime filter did not match `cms.entry.*`, so a scheduled publish firing left the list stale until the next full load. Already true for the CMS drafts queue before this change.

- b8690cb: Classify and name API-key callers in the activity feed from the key itself. `actorKind` was guessed from the actor id's prefix, which mapped every `akey_*` caller to `widget` — so admin service keys were reported as widgets on `GET /v1/activity`, and they carried no `actorLabel` at all, leaving the feed to show a truncated raw id. Actor resolution now reads `api_keys`, labels the row with the key's name, and derives the kind from its type (`widget` / `track` → `widget`, everything else → `agent`).

  Drop the dead prefix branches from the same classifier. `usr_` never matched a BetterAuth-created user (those ids resolve through the `users` lookup first anyway) and `agt_` existed only in test fixtures.

  Give the synthetic actors a kind instead of reporting them as `unknown`: the in-process agent runtime (`agent-host:<org>`, `agent-host:<org>:<end user>`) is an `agent`, and the scheduler and read-tracker actors are `system`. The classifier now lives in `@getmunin/types` as `actorKindFromId`, alongside named constants for each synthetic actor id, so the server and the dashboard's realtime fallback cannot drift apart and the code that mints these ids shares the string with the code that reads it. `GET /v1/activity` had no test of its own; it now covers both key kinds, a BetterAuth user id, the runtime actors, the system actors, and an unplaceable id.

- Updated dependencies [3136f2b]
- Updated dependencies [3136f2b]
- Updated dependencies [b8690cb]
  - @getmunin/types@5.10.0
  - @getmunin/ui@5.10.0

## 5.9.0

### Patch Changes

- 2e00517: Fix credential-handoff links, which answered `401 invalid or expired credential` on every click in cloud.

  `CredentialHandoffController` was a plain `@Controller('v1/credentials')` with no `@AllowAnonymous()`. OSS applies `AuthGuard` per controller, so the endpoint was reachable there and every integration test passed; cloud registers `AuthGuard` as a global `APP_GUARD`, so both the describe (GET) and complete (POST) requests were rejected before the handoff service ran. The entry page fetches with `anonymous: true` — correct, since the link exists for people who hold no Munin credential — which made the failure total: every link minted by `conv_request_channel_credentials`, `conv_configure_email_channel` or `connectors_request_credentials` was dead on arrival, and the auth guard's message read as if the _link_ had expired. It is now a `PublicController` with public throttling, guarded by a test that fails if any controller declares neither `AuthGuard` nor an anonymous opt-out.

  A channel whose stored config is missing its credential slots now answers the link with a `conv_channel_config_invalid` 400 carrying `fieldErrors`, instead of an unmapped error that surfaced as a bare 500 — the interceptor that maps it only covers the dashboard's channel controller. The entry page names those fields, and no longer keeps showing a stale load error after a later attempt succeeds.
  - @getmunin/types@5.9.0
  - @getmunin/ui@5.9.0

## 5.8.0

### Patch Changes

- 2c7e3fd: Audit log: show the agent icon in front of the client, and stop calling every browser
  "dashboard".

  `GET /v1/audit-logs` now returns `clientIconUrl` alongside `clientName`, read from the
  OAuth client's registered logo, and the client column renders the same glyph the Agents
  page uses (icon when the client registered one, first-letter fallback otherwise). The
  glyph moved into a shared `ClientGlyph` component so both pages stay in sync.

  `classifyClient` used to label any `Mozilla/*` user agent `dashboard`, which swept up
  every other browser caller — a customer's own web UI, a docs "try it" console, Swagger.
  `dashboard` now requires a session-authenticated actor with no OAuth client (only our
  own dashboard holds a BetterAuth session cookie); every other browser caller classifies
  as the new `browser` kind, filterable from the client dropdown. Audit rows also record
  the calling `origin` (`Origin` header, falling back to the `Referer`'s origin), so a
  `browser` row shows the origin host — `docs.getmunin.com` — instead of a generic label,
  with the full origin and user agent in the cell tooltip. Existing rows keep a null
  origin and read as the bare kind.
  - @getmunin/types@5.8.0
  - @getmunin/ui@5.8.0

## 5.7.0

### Minor Changes

- 5818e0e: Remove the agent-as-actor identity model.

  The `agents` table has never held a row — nothing in the codebase inserts into it — and neither does anything set `tokens.agent_id`. `claims.agent_id` could only be written by a claimer whose actor id starts with `agt_`, which requires `tokens.agent_id`, so agent-held claims have never existed either. Conversation claims are an operator lock: they are taken only when a human sends a message, and read only to block the AI from replying over a human (`HandoverActiveError`). "The AI is handling this conversation" is modelled by `conv_conversations.agent_mode`, which is untouched.

  Dropped: the `agents` table and its RLS policy, `claims.agent_id`, `tokens.agent_id`, and `ClaimManager` from `@getmunin/core` — a generic entity-claim helper keyed on agent id with no callers in this repo or munin-cloud. `ConversationClaimsService` keeps its full behavior for user claims.

  `ClaimHolderType` narrows from `'user' | 'agent'` to `'user'`, which flows through the `/v1/conversations` claim DTOs, the `conversation.taken_over` and `conversation.released` webhook payloads, and `@getmunin/agent-runtime`'s claim type. The `'agent'` value has never been emitted, so consumers switching on it only lose a dead branch — but it is a type-level break, hence the minor bump.

  The migration refuses to run if any of the above turns out to be false in a real database: it raises rather than dropping when `agents` has rows or either `agent_id` column holds non-null values.

### Patch Changes

- 233842d: Attribute MCP activity to the agent that made it.

  The usage page's "By agent" table was always empty, and the Agents page never showed a last-used time. Both read from identity that was never recorded. OAuth-authorized agents (claude.ai, Claude Code) resolve to `actor_type = 'user'` with `actor_id` set to the authorizing user — deliberately, because their permissions derive from that user's org role — so the by-agent query's `actor_type IN ('admin_agent','end_user_agent')` filter excluded them, and its join against the `agents` table dropped whatever was left: nothing in the codebase ever inserts a row there. Even with the filter widened, `actor_id` could not have separated two connectors authorized by the same person.

  `audit_log` now records `client_id`, the OAuth client the credential was issued to, taken from `oauth_access_token.client_id` for opaque tokens and the `azp` claim for JWTs. The by-agent report groups on it (joined to `oauth_client` for the connector name) and no longer consults the vestigial `agents` table; admin API keys, delegated end-user agents and the in-process agent runtime resolve to their own labels instead of being filtered out. Average latency is now a call-weighted mean rather than an average of per-group averages. The Agents page derives last-used from the newest audit row per connector, so it fills in as traffic arrives rather than being hardcoded null.

  The audit log's Client column also stops reporting "unknown" for traffic it can identify: browser requests classify as `dashboard`, widget callers as `widget`, and the transport-level `POST /mcp` row as `mcp` (previously only the row carrying a tool name matched). Where a row has an OAuth client, the column shows the connector's name instead of a coarse bucket.
  - @getmunin/types@5.7.0
  - @getmunin/ui@5.7.0

## 5.6.0

### Patch Changes

- @getmunin/types@5.6.0
- @getmunin/ui@5.6.0

## 5.5.0

### Patch Changes

- 4f8a169: Drop the circular warning icon from the consent denial pane.

  The pane already opens with a serif headline naming the resource that can't be authorized, so the icon above it restated the tone without adding information. Removing it leaves the headline as the first thing read; the surrounding `gap-4` column keeps the spacing it already had.
  - @getmunin/types@5.5.0
  - @getmunin/ui@5.5.0

## 5.4.0

### Patch Changes

- @getmunin/types@5.4.0
- @getmunin/ui@5.4.0

## 5.3.0

### Minor Changes

- 55dc284: Let an MCP endpoint mounted beside `/mcp` be its own OAuth protected resource.

  Everything about authorization assumed exactly one MCP resource. `/.well-known/oauth-protected-resource` served a single document, `computeValidAudiences` derived audiences from `NEXT_PUBLIC_MCP_URL` alone, and `AuthGuard` enforced `credential.audience === mcpResourceUrl()`. An endpoint mounted below `/mcp` — a separately gated toolset on its own path — was therefore indistinguishable from `/mcp` for the entire length of the authorization flow: the client fell back to the shared metadata document, requested the full advertised scope set, and the authorization request carried nothing that identified which endpoint it was for. Consent screens could only describe the whole product, and an endpoint that refuses the caller could only say so on the first `initialize` call — after consent, after a token was minted — where a host application surfaces it as a bare connection failure.

  A surface is now a descriptor, `McpSurface { id, path, resourceName, scopes }`, registered through the `ADDITIONAL_MCP_SURFACES` provider token (the same optional-injection idiom as `ADDITIONAL_CREDENTIAL_RESOLVERS`) and passed to `createMuninAuthCore` as `mcpSurfaces`. `McpSurfacesModule.forRoot(surfaces)` provides the token globally, because the two Nest consumers sit in different modules — the resource-metadata controller inside `OAuthModule`, the guard at the composition root — and a host should not have to reach into either to register one. Four consumers read it:

  - `OAuthResourceController` serves RFC 9728 metadata at `/.well-known/oauth-protected-resource<path>` for each registered surface, with `resource` set to the surface's own URL and `scopes_supported` limited to its own scopes. Unregistered suffixes 404 as before, and the base document is unchanged — surface scopes never appear on it, and neither does the surface's existence.
  - `computeValidAudiences` takes a third argument of additional resource identifiers, so the authorization server stops rejecting `resource=<surface url>` with `invalid_target`. Surface resources contribute only their exact and trailing-slash forms; unlike the base resource they are not widened to their origin.
  - The authorization server's accepted scope list is `SUPPORTED_AUTH_SCOPES` plus the registered surfaces' scopes. Deliberately _accepted but not advertised_: `RESOURCE_ADVERTISED_SCOPES` and the authorization-server metadata document stay as they are, so a surface scope is only discoverable through that surface's own metadata document.
  - `AuthGuard` resolves the surface owning the request path and requires the audience to match that surface's resource, so a token minted for one surface is refused on `/mcp` and on every other surface. The base resource is still accepted on a surface path, which keeps tokens issued before a surface existed working. The `WWW-Authenticate` challenge now points at the surface's own metadata document rather than the base one, and audience comparison ignores a trailing slash — previously a token whose audience carried one passed audience validation at issue time and then 401'd at the guard.

  Surface paths must sit below `/mcp/`; a descriptor with a duplicate id or path, a path outside `/mcp/`, or a missing id or resource name throws at startup rather than silently not matching.

  `OAuthConsentPage` gains two optional props for describing a single resource instead of the whole product. `resourceInfo` supplies the resource name and its own permission rows, replacing the module/scope grouping — a surface scope no longer falls through the module map and renders as "no product permissions requested". `denial` renders the request as unauthorizable, with the reason (`not_eligible`, `no_org`) and a cancel button that returns the client to its redirect URI, instead of an authorize button that mints a token the endpoint will refuse. Deciding whether a caller is eligible stays with whoever mounts the page: the props describe presentation, and both default to null, so the existing consent flow renders exactly as before.

### Patch Changes

- @getmunin/types@5.3.0
- @getmunin/ui@5.3.0

## 5.2.2

### Patch Changes

- 8fd15f9: Stop returning bare 500s when a channel's stored config can't be parsed, and let a full save repair it.

  Every channel service parsed `conv_channels.config` with a bare `.parse()`, so a row that doesn't satisfy its stored schema threw a raw `ZodError` out of the handler and surfaced as an uninformative `Internal server error`. `ConvService.importConv` writes `config: {}` on every imported channel by design — the operator is told to "re-enter them on this server" — so the documented recovery path ran straight into this.

  Stored configs now go through a shared `parseStoredConfig`, which throws a transport-free `ChannelConfigInvalidError` carrying `code: 'conv_channel_config_invalid'` and the offending field paths. A controller-scoped interceptor maps it to a **500** at the HTTP boundary: a corrupt stored config is a server-side fault the caller cannot fix by changing the request, which is the same split `nestjs-zod` makes between request validation (400) and server-side serialization failures (500). The MCP dispatcher already surfaces the message, so agents get the coded string and the dashboard translates via `code`. Applied to all five channel kinds — email, Vapi, Twilio, MessageBird and Threll.

  `EmailService.updateChannel` additionally falls back to building the config from the submitted input when the stored one won't parse, so saving a complete configuration repairs the row instead of bouncing off it. The vendor services deliberately do not get that fallback: their merges read `input.config?.x ?? prev.x`, so rebuilding from a partial input would silently drop settings — they surface the error instead.

  Separately, the four vendor admin providers parsed _incoming_ config with a bare `ConfigSchema.parse(input.config)`, turning ordinary bad input into a 500 as well. That boundary is genuinely client-side, so it now throws a `400` naming the offending fields, matching the `validatePendingConfig` helper already sitting a few lines below each one.

- 5ea99ce: Pin the submit error in the email channel dialog to the footer instead of leaving it in the gap below the scroll area.

  The email channel dialog is the only one that scrolls an inner region rather than the whole popup, so its `FormError` rendered as a detached inset box wedged between the scroll container and the footer — misaligned against both neighbours' negative-margin bleeds, and with no spacing from the fields above. `FormError` now takes a `pinned` variant that drops the box for a `rule-soft` separator inset to the content width, on the same 16px/16px rhythm as the rule under the dialog header, so the error reads as a continuation of the form rather than a third structural zone competing with the footer plinth. It stays visible regardless of scroll position. Also raises the destructive fill of the boxed variant in dark mode, where 5% of `#d96a6a` over the card background was effectively invisible.
  - @getmunin/types@5.2.2
  - @getmunin/ui@5.2.2

## 5.2.1

### Patch Changes

- f646c5d: Reactivate an auto-deactivated email channel by fixing and saving it.

  A channel that failed inbound polling five times is switched off and the card offered a filled Activate button inside the alert row, stacked above the outline Edit button in the footer — two competing action rows. The alert row is now diagnosis only (message plus the failure detail on its own line), and Activate sits next to Edit in the card footer.

  The card also states its severity the way the awaiting-credentials card already did: `SettingsCard` takes an `accent` of `'pending'` or `'error'` instead of a `pending` boolean, so a deactivated channel gets a red top rule and a degrading one an amber rule. The redundant second status dot in front of the alert message is gone — the status line above it already carries the colour.

  Norwegian copy for the polling alerts reads properly now: "Auto-deaktivert etter 5 feilede henteforsøk" became "Slått av etter 5 mislykkede forsøk på henting" — "feilede" is the wrong adjective form and "henteforsøk" is a constructed compound, and "Innkommende henting feiler" became "Henting feiler · 3/5 · slås av ved 5" on the card and "Henting av nye meldinger feiler på «…»" in the needs-attention banner.

  Fixed alongside: a failed IMAP credential probe left an `ImapFlow` client with no `error` listener, so the socket timing out minutes later emitted an unhandled `error` event and killed the backend process. The probe now attaches a listener and closes the client in a `finally`, matching what the inbound poll adapter already did.

  Saving an update to a channel that is currently deactivated now re-tests the stored credentials through the existing SMTP/IMAP probe: the channel is reactivated (and its alert resolved) when both connect, and otherwise stays deactivated with the connection errors returned in the response's `probe` field, which the edit dialog surfaces instead of silently flipping the channel back on with credentials that still fail. This applies to `conv_configure_email_channel` as well as the dashboard. The explicit Activate button remains for the case where nothing was wrong with the config — a mailbox that was down, a provider that throttled.
  - @getmunin/types@5.2.1
  - @getmunin/ui@5.2.1

## 5.2.0

### Patch Changes

- @getmunin/types@5.2.0
- @getmunin/ui@5.2.0

## 5.1.0

### Patch Changes

- be67821: fix(agent): reconcile the model against the provider in one save

  Switching provider in the dashboard was a client-orchestrated two-step: PUT
  `/v1/agent-config` with the new base URL and key, GET `/v1/agent-config/models`,
  then a second PUT to fix the model. The first PUT already emits
  `agent.config.updated`, and the runner respawns on it, so for the length of the
  models round trip (18 s in the incident that surfaced this) a live runner held
  the new provider with the previous provider's model id. Anthropic 404'd a model
  name it had never heard of, and every curator job draining in that window
  hard-failed.

  The reconcile now happens server-side inside the single upsert, before the row is
  written and before the webhook fires: when the base URL or key changes, the
  provider's model list is fetched and a `fastModel` it doesn't offer is replaced
  with that provider's default (or the first model it does offer), while an unknown
  `smartModel` is cleared. The runner can no longer observe a mismatched pair. The
  same check guards the other direction — an explicitly supplied model the provider
  doesn't offer is now rejected with an `agent_config_invalid_model` code instead of
  being persisted into a config that can only 404, translated in both locales for
  the one path a dashboard user can hit it on (a model dropped from the provider's
  catalog while the page held a cached list). Providers without an OpenAI-compatible
  `/models` endpoint are left alone, so bring-your-own gateways still work.

  Provider failures also stop spending a job's retry budget. `attempts` is
  incremented at claim and was never given back when a provider error parked the
  job as `failed_retryable`, so a job that came back through the recovery sweep had
  already burned attempts and the next genuine failure sent it straight to `dead`.
  Parking now refunds the attempt. Provider alerts additionally carry the model id
  and base URL, so a mismatch reads as one instead of a bare 404.

- be67821: refactor: one shared trailing-slash trim instead of 50 copies of a polynomial regex

  `replace(/\/+$/, '')` appeared at ~50 base-URL call sites. The pattern is
  quadratic on a long run of slashes — the engine retries the match from every
  start position — which CodeQL flags wherever the input can come from outside
  the process. Most sites read an env var and were never reachable, but the
  connector base URLs (`magento.adapter.ts`, `gastroplanner.adapter.ts`), the
  agent provider base URL, the SDK's `baseUrl` and the tracker's `data-api`
  attribute all take theirs from a request or a customer's config.

  `stripTrailingSlashes` now lives in `@getmunin/types` — the one package
  everything already depends on — and walks back from the end of the string in
  linear time. `@getmunin/sdk` and `@getmunin/analytics-tracker` ship standalone
  bundles with no workspace dependencies, so they keep a local copy of the same
  four lines rather than take one. Behavior is unchanged at every site, which
  `packages/types/src/url.test.ts` pins against the old regex case by case.

- Updated dependencies [be67821]
- Updated dependencies [be67821]
  - @getmunin/types@5.1.0
  - @getmunin/ui@5.1.0

## 5.0.2

### Patch Changes

- @getmunin/types@5.0.2
- @getmunin/ui@5.0.2

## 5.0.1

### Patch Changes

- @getmunin/types@5.0.1
- @getmunin/ui@5.0.1

## 5.0.0

### Patch Changes

- Updated dependencies [ace185f]
  - @getmunin/types@5.0.0
  - @getmunin/ui@5.0.0

## 4.81.0

### Patch Changes

- 39777ed: Render `DashboardTopbar`'s `leftSlot` on mobile. The slot lived in a `hidden md:flex` container, so cloud's org switcher was unreachable below the `md` breakpoint — the topbar showed the centered brand label instead, with no way to switch orgs on a phone. The slot now renders at every width and replaces the brand label (as it already did on desktop); the centered mobile brand is kept only when no slot is supplied. Topbar gaps tighten to `gap-2` under `md` so a switcher fits next to the logo.
  - @getmunin/types@4.81.0
  - @getmunin/ui@4.81.0

## 4.80.1

### Patch Changes

- @getmunin/types@4.80.1
- @getmunin/ui@4.80.1

## 4.80.0

### Minor Changes

- 556e620: Redesign Channels and Trackers as card grids matching the Integrations page, and give Trackers real 7-day view stats.

  Channels and Trackers rendered as full-width `<ul><li>` rows while Integrations already shipped a bordered-card grid (`IntegrationCard`/`CardMenu`/`StatusLine`/`CardGrid`), so the three settings pages didn't read as one family. `CardGrid`, `CardMenu`, and `StatusLine` move out of `components/integrations/integration-card.tsx` into a new shared `components/card-kit.tsx`, alongside a new `SettingsCard` shell: mono kind eyebrow (chat/email/SMS/voice — no logo tile, since nothing real would go in one) with the vendor logo + name demoted to footer metadata, serif name with a mono qualifier, an always-visible status line, a one-line description, and a 1.5px amber top rule for anything needing attention (awaiting credentials, never fired). A new `CardGridSkeleton` gives the loading state the same shape as the loaded grid; the Integrations page itself is visually untouched (only its internal imports move), and Channels/Trackers keep their existing `EmptyCallout`/`LoadFailed` empty and error states unchanged.

  Trackers' cards also show a 7-day view count and sparkline per tracker. `analytics_view_events` previously had no way to attribute a view to a specific tracker — the ingest controller resolved the tracker from its API key but discarded the id before calling `recordView` — so this needed a small backend addition: a nullable `trackerId` column (+ index) on `analytics_view_events`, threaded through from the two ingest call sites, a new `AnalyticsService.trackerViewSummaries()` aggregation, and a dashboard-only `GET /v1/analytics/trackers/views-summary` endpoint (kept off the `analytics_*` MCP tool surface deliberately). Phone-number qualifiers (SMS `fromNumber`/`originator`) now format through `libphonenumber-js` instead of showing the raw E.164 string.

- 3695371: Add a middleware-safe `@getmunin/dashboard-pages/setup-gate` entry point so every web app can gate the dashboard on onboarding without copying the rule.

  `withSetupGate(handler, options)` wraps an existing next-intl middleware and returns a hard `307` to `/<locale>/setup` when the caller is an owner or admin whose org has no name or no LLM provider. Options are `locales`, `scope` (`'root'` or `'subtree'`), `exempt`, `apiUrl` and `timeoutMs`. It leaves an upstream locale redirect untouched, skips the API entirely without a session cookie or on an ungated path, and treats every unknown answer — failed read, missing membership, non-admin member — as "not incomplete", so the client-side `useDashboardGate` remains the backstop.

  `isSetupIncomplete` now has a single home in `auth/setup-status.ts` with no imports of its own, shared by the gate and by `resolvePostAuthDestination` (moved to `auth/post-auth-destination.ts`). The predicate was previously duplicated in `apps/web`, which could not import it because middleware must not pull in the `'use client'` root barrel.

  For a consumer whose middleware post-processes redirects — rewriting `Location` from `x-forwarded-host`, for instance — wrap the gated handler so that rewriting stays the outer layer; the setup redirect then inherits it instead of pointing at an internal host.

### Patch Changes

- 12d99b9: Stop the onboarding wizard clipping the focus ring on its inputs.

  `Card` carries `overflow-hidden`, and `BARE_CARD` — which turns a card into a plain layout wrapper for the wizard — dropped the border, background and padding but kept the clip. With `px-0` in bare mode the input is exactly as wide as the card, so the focused input's `ring-1` box-shadow, which paints outside the border box, was cut off on the left and right while the top and bottom kept their full 2px. The effect was a focus outline that looked thinner on the vertical edges than the horizontal ones.

  Bare cards clip nothing intentionally, so `BARE_CARD` now sets `overflow-visible`. This covers the workspace name, provider API key, models and website import steps.

- cf10e8c: Make the API-key reveal dialog's copy control a fixed-size icon button.

  The button was labelled "Copy to clipboard" and collapsed to a bare `✓` on success, so it shrank
  from ~340px to ~70px on click and the key field snapped wider underneath it. It is now a square
  icon button that swaps the copy glyph for a green check, with the label moved to
  `title`/`aria-label` and an `aria-live` region announcing "Copied" — no reflow, and the key gets
  the reclaimed width.

  The key field is pinned to `h-9` to match the button exactly; it previously derived a 34px height
  from `py-2` and sat 2px short. Moving the value into a `truncate` span means the field is no
  longer its own overflow container, so it also carries `min-w-0 overflow-hidden` — without that it
  cannot shrink below the key's intrinsic width and pushes the button outside the dialog.

- 2d896ca: Send a freshly signed-up or signed-in owner straight to onboarding instead of routing them through the dashboard first.

  `SignupForm` and `LoginForm` always pushed `/dashboard` (the `safeRedirect` fallback), and the need for onboarding was only discovered afterwards by `useDashboardGate` — two client-side API calls plus a route-bundle load later. The browser therefore sat on `/dashboard` for hundreds of milliseconds, and for seconds when the `/setup` route still had to be built, which read as "signup dropped me on the dashboard and a reload fixed it". Both forms now resolve the destination before navigating.

  `resolvePostAuthDestination` falls back to `/dashboard` whenever the setup state can't be established (either read failing, no membership, a non-admin member), so `useDashboardGate` remains the backstop rather than being replaced. An explicit `?redirect=` target — invitations, deep links, the OAuth authorize resume — still wins over the setup check.
  - @getmunin/types@4.80.0
  - @getmunin/ui@4.80.0

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

- @getmunin/types@4.79.0
- @getmunin/ui@4.79.0

## 4.78.0

### Minor Changes

- 5802b45: Outreach: `proposedSendAt` now actually schedules a send

  A proposal's `proposedSendAt` used to be inert metadata — it was stored, revisable and exported, but approval always delivered immediately and no worker ever read the column. Approving a draft that said "send Tuesday 09:00" sent it on the spot.

  Approval is now the authorization, and the send time is honored:

  - `outreach_approve_proposal` takes an optional `sendAt`. With no argument it inherits the draft's `proposedSendAt` when that is still in the future; `sendAt: null` forces an immediate send; a `sendAt` in the past is refused. A scheduled proposal parks at `status: 'approved'` with `scheduledSendAt` set, and `outreach_list_proposals({ status: 'approved' })` lists what is waiting, soonest first.
  - A new `OutreachSendWorker` drains due proposals (default every 60s, `MUNIN_OUTREACH_SEND_POLL_MS`, disabled by `MUNIN_OUTREACH_SEND_WORKER_DISABLED`) and re-runs every eligibility check at send time: campaign still enabled, contact not suppressed and still consented, and no prospect reply on a follow-up. A proposal that fails any of them goes to `status: 'failed'` with `failureReason` instead of being delivered. Quiet hours and blackout dates hold the send until the window opens rather than failing it. Transient delivery errors retry up to five attempts (`send_attempts`) before giving up.
  - New `outreach_cancel_scheduled_send` pulls an approved send back to `pending` before it goes out — the one real undo in outreach, and only before delivery.
  - New events: `outreach.proposal.scheduled`, `outreach.proposal.send_canceled`, `outreach.proposal.send_failed`.
  - The dashboard drawer names the inherited time on its approve button and offers Send now / Schedule…; a Scheduled sends section lists what is queued with a call-off action. The Inspector panel labels the button **Approve & schedule** and spells out the time above it.

  The one-proposal-per-(campaign, contact, kind) unique index now covers `approved` alongside `pending`, so a contact with a scheduled send cannot pick up a second in-flight draft. Proposals that were scheduled on a source server import as `pending` with a warning — no timer follows the data across servers.

### Patch Changes

- f3db6e6: fix(conv): the channel listing stops handing out credential material

  `toChannelDto` surfaced `conv_channels.config` as stored, so both consumers of the channel list — `GET /v1/conversations/channels` (the dashboard) and `conv_list_channels` (MCP, admin audience) — returned every secret the jsonb holds: the pgcrypto ciphertext of the Twilio auth token, the MessageBird access + signing keys, the Vapi and Threll API keys and webhook secrets, the nested SMTP/IMAP passwords, and — in plaintext, since the widget never encrypted it — the chat widget's `identityVerificationSecret`.

  Only the ciphertexts need `MUNIN_ENCRYPTION_KEY` to be worth anything, and that key is not in the payload; the widget secret needs nothing. What made all of it worth removing is that nothing on either side reads these fields, while an agent's copy of a tool result travels: into a transcript, a log line, or an LLM provider's request body. Credential-derived material crossing that boundary widens the blast radius of any unrelated leak, and it does so for no gain.

  A single projection, `publicChannelConfig` (`conv/channels/public-config.ts`), now walks the stored config recursively before it is surfaced. An `encrypted<Field>` key becomes `<field>: '••••'` when a secret is stored and `<field>: ''` when it is not, which is the shape the per-vendor DTOs and the dashboard already expect — so the list and the configure responses finally agree, and "credentials present" stays readable without the ciphertext. The widget's `identityVerificationSecret` collapses to `hasIdentityVerificationSecret`, matching that module's own sanitizer. Being a rule about key shape rather than a per-vendor list, it covers a vendor added later.

  `needsCredentials` was email-only and therefore wrong for all five vendor-backed kinds — a Twilio channel parked on an unopened credential link reported `false`. It now reads the `pendingSetup` marker too, so the flag is truthful for every channel.

  That truthful flag needed somewhere to lead. The dashboard's only credential form was the email SMTP/IMAP one, so a pending Twilio or Vapi channel could be created by an agent and then only be finished by opening the one-time credential link — an odd detour for someone already signed in to the dashboard, and the reason a vendor channel's "Awaiting credentials" state had nowhere to go. Channels now renders the same generic form the connectors page already uses: the secret fields come from `GET /v1/conversations/channels/vendors` (`configFields` where `secret: true`), and saving posts to the existing `POST /v1/conversations/channels/:id/credentials`, which completes the vendor-side setup and activates the channel. No new endpoint, and the credential link keeps working for handing the job to someone who is not in the dashboard.

  A pending channel row now reads like a pending connector card — the same `StatusLine` dot, an outline "Enter credentials" as the only action, and no Edit button or test/place-call entry in the ⋯ menu, since every one of those is rejected while the channel is awaiting credentials.

- 5b4fb1a: Bind merge application to the proposal that was reviewed.

  `crm_apply_merge_proposal` took only `{ id }`, and `crm_propose_merge` does not always create a proposal: on a pair that already has a pending one it updates that row in place, overwriting `confidence`, `evidence`, `recommendedKeeperId` and `recommendedPatch` under the same id. Merge proposals also have none of the review tracking outreach has — no `revisionCount`, no `revisedAfterReviewAt` — so the rewrite was completely silent. A curator pass that re-filed a pair with the keeper flipped would change the card an operator was reading, and their click would retire the contact they meant to keep.

  Applying is not a small write: it copies the patch onto the keeper, repoints activities, deals and relationships, archives the duplicate with `doNotContact: true` and a cleared `endUserId`, auto-dismisses pending outreach proposals for the duplicate, and auto-dismisses other pending merge proposals touching it. Unwinding all of that by hand is not realistic, and the dismissed outreach followups do not come back.

  Proposals now carry a `mergeFingerprint` over `(contactAId, contactBId, recommendedKeeperId, confidence, recommendedPatch)` and apply requires it — `{ id, fingerprint }` on the MCP tool, `{ fingerprint }` in the body of `POST /v1/crm/merge-proposals/:id/apply`. A mismatch is a `409` with `crm_conflict`: nothing is merged and the proposal stays pending. The Slack apply button carries the digest in its action value; the panel and the dashboard pass what they rendered, and the panel re-lists on a refusal so the operator lands on the current proposal with the conflict still shown.

  The digest deliberately covers the proposal row and not the contact rows behind it. `crm_update_contact` can change the name or email a card displays, but it cannot change which record survives or what patch lands, and digesting live contact fields would invalidate queued cards on ordinary CRM activity — conflicts on untampered work teach operators to click through them.

  `evidence` is also excluded, so the weekly hygiene pass can refresh its reasoning on a pending pair without invalidating a queue the operator is working through. Only a changed decision invalidates a review.

- 992f78a: Make a dismissed KB curation candidate stay dismissed.

  Candidates are `kb_documents` rows that are deleted on dismiss and on publish, and the only thing stopping a curation pass from refiling a source conversation was a candidate still sitting in `kb-curation-inbox`. Empty the inbox — review a batch, publish two, dismiss the rest — and the next weekly sweep redrafts the same conversations from scratch. That happened in production: candidates reviewed on 26 July came back on 2 August, six weeks after the conversations themselves.

  `kb_curation_decisions` records one row per decision (`dismissed` or `published`) with the reason, the deciding actor, and the published document when there is one. Rows outlive the candidate and the source conversation. `kb_propose_curation_candidate` now pre-checks the source conversation and throws `kb_curation_decided` when one exists, so the gate is enforced in the service rather than described in the skill — the "last 7 days" and "resolved handovers only" rules were prose-only, and the sweep that produced those drafts honored neither.

  Blocking is coarse and permanent, matching `crm_merge_proposals`: one decision retires the whole conversation, and there is no un-dismiss. Title matching would lose to rewording — the June and August drafts of the same answer had different titles. Something genuinely new from a decided conversation goes in with `kb_create_document`.

  New tools: `kb_dismiss_curation_candidate` (deletes the draft, records the decision, takes an optional `reason` and the reviewed `ifVersion`) and `kb_list_curation_decisions` (filter by `outcome` or `sourceConversationId`). Dismissing with `kb_delete_document` still records a reasonless decision, so the Slack button, the dashboard drawer and the Inspector panel are all covered by the same choke point in `removeDocument`.

  `POST /v1/kb/curation/candidates/:id/dismiss` accepts `reason` and `ifVersion`; `KbCurationDecidedError` maps to a 409 there. The dashboard drawer and the panel now say the dismissal is permanent.

- f5b2992: Bind KB curation publishing to the version that was reviewed.

  A curation candidate is an ordinary KB document, `kb_update_document` rewrites its title and body, and `publishCurationCandidate` copies `candidate.title` and `candidate.body` verbatim into the target space. So an agent could rewrite the draft after the review card rendered and the operator's click would publish text nobody read.

  `kb_publish_curation_candidate` now requires `ifVersion`, the same optimistic-concurrency argument `kb_update_document`, `kb_delete_document` and `kb_restore_version` already take, and `POST /v1/kb/curation/candidates/:id/publish` takes it in the body. A mismatch throws `KbConflictError`, nothing is written to the target space and the candidate stays in the inbox. The check runs before target-space resolution, so a refused publish no longer auto-creates a space as a side effect.

  `KbConflictError` now maps to a 409 in the candidates controller. It was unmapped, so a version conflict on that route surfaced as a bare 500.

  The Slack publish button carries the reviewed version in its action value, which the approval codec already had a slot for. Without it the Slack path would have read the current version and passed that back, making the check vacuously true on the one surface where the card can sit unread the longest.

  Also fixes the Inspector panel's Dismiss button, which called `kb_delete_document` without the required `ifVersion` and therefore failed schema validation on every click. Both panel actions now use the version of the body the operator actually opened, falling back to the list version. Publish re-lists on a refusal so the operator lands on the current draft with the conflict still shown.

- d78ff2a: Bind outreach approval to the draft that was reviewed, not to the proposal id.

  `outreach_approve_proposal` took only `{ id }`, so it meant "send proposal #a3f9", never "send the email I just read". `outreach_revise_proposal` is model-callable and mutates a pending draft in place, so an agent could rewrite the body after the panel, the dashboard drawer or the Slack card had rendered it — and the operator's click would send the rewrite. The revision count on the card was the only tell, and it was advisory: a human had to notice it on a card they had already decided about.

  Every proposal now carries a `draftFingerprint` (a digest of campaign, contact, kind, subject, body and proposed send time) and approval requires it — `{ id, fingerprint }` on the MCP tool, `{ fingerprint }` in the body of `POST /v1/outreach/proposals/:id/approve`. A mismatch is a `409` with `outreach_conflict`: nothing is sent and the proposal stays pending, so the drift goes back through review instead of through the wire. Approve already re-checked campaign state, contact suppression and superseding replies at click time; the draft text is now one of those conditions.

  All three review surfaces pass what they rendered. The Slack approve button carries the digest in its action value, and the bridge already re-renders the card on `outreach.proposal.updated`, so a revised draft rebinds its button and a card that missed the update refuses rather than sending stale text. The Inspector panel re-lists on a refused approval so the operator lands on the current draft with the conflict still shown.

  This deliberately stops short of single-use tokens. The proposal state machine already refuses anything non-pending, which covers replay; what was missing was binding the decision to the content, and a digest does that without an issuance store or a secret inside the iframe. `crm_apply_merge_proposal` and `kb_publish_curation_candidate` are still id-bound and want the same treatment.

- Updated dependencies [5802b45]
- Updated dependencies [180727a]
  - @getmunin/types@4.78.0
  - @getmunin/ui@4.78.0

## 4.77.0

### Minor Changes

- 2d14917: fix(outreach): keep `outreach_list_proposals` payloads bounded

  `outreach_list_proposals` returned every column of every matching row, curator `evidence` included. Evidence is an unbounded JSONB the curator fills with sources, compliance notes and reasoning — around 4,000 characters per proposal in practice, roughly three quarters of a row. Combined with a default limit of 100 and a default of all statuses, a queue of ~16 proposals already produced an 80,000-character result that clients refuse, and 100 rows would have been half a million characters. The failure is silent-ish and total: the MCP Apps panel renders the size error instead of the review UI, and the model gets no data either, so the review pass just stops.

  List rows now carry the draft, the nested `contact` / `campaign` / `delivery` summaries and a boolean `hasEvidence`, but not `evidence` itself. The default limit drops from 100 to 25 and the ceiling from 500 to 200.

  The new `outreach_get_proposal` reads one proposal by id with the full evidence attached, so nothing became unreachable — this exposes the `getProposal` service method the Slack bridge and `GET /v1/outreach/proposals/:id` already used. The Inspector panel's **Evidence** toggle now fetches on click rather than receiving evidence for every card up front.

  `GET /v1/outreach/proposals` and the inbox queue return the same trimmed rows. Nothing in the dashboard rendered `evidence` from a list response.

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

- 2808e5d: Eyebrows no longer echo the heading they sit above. The OAuth consent outcome screens paired "Authorization granted" with the H1 "Access granted." — and in Norwegian both collapsed to the identical string "Tilgang gitt", since `tilgang` covers both _authorization_ and _access_. They now name the flow state instead ("Authorization complete" / "Autorisering fullført", "Authorization cancelled" / "Autorisering avbrutt"), leaving the ✓ glyph and the heading to carry the outcome.

  Two inspector panels repeated a noun the same way and now add information instead: the outreach proposals eyebrow reads "Awaiting approval" (was "Pending proposals", above "Outreach proposals"), and the merge panel reads "Possible duplicates" (was "Pending merge proposals", above "Contact merges").

- Updated dependencies [cfa7b4f]
  - @getmunin/types@4.77.0
  - @getmunin/ui@4.77.0

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
  - @getmunin/types@4.76.0
  - @getmunin/ui@4.76.0

## 4.75.0

### Minor Changes

- cc87bb6: Outreach proposals say where they are going before you approve them

  A proposal DTO now carries `delivery`: the campaign channel's type and vendor, the destination the approval would actually reach (email address for email campaigns, phone number for voice and SMS), and whether Munin will append the campaign CTA link and unsubscribe footer at send time. `contact` gains `phone` alongside `email`.

  Both review surfaces use it. The MCP App panel and the dashboard drawer state the consequence in words — "Approving places a phone call to +1 415 555 9999", "Approving emails jane@acme.com. Munin appends the campaign CTA link, an unsubscribe footer" — and warn in red when the contact has no address or number on file, which is a send that would fail. A voice proposal's approve button reads "Approve & call" rather than "Approve & send", and its missing subject renders as "(spoken call — no subject)" instead of the bare "(no subject)" an email would show.

  This matters most for voice campaigns, where approving dials a real phone number and the panel previously showed nothing but a subject-less body and an Approve button. It is worth having for email too: a reviewer approving a first-touch could not see the recipient address unless the contact happened to have no name.

  The panel's `Proposal.kind` union was also missing `'followup'`, which every follow-up proposal has carried since sequences shipped.

- c5a05c5: SMS channels can set how the agent handles inbound texts

  `defaultAgentMode` has always been a `conv_channels` column, but only the email path could write it — the vendor-backed path that creates every SMS channel had no way to set it, and neither did the dashboard. Every SMS number was stuck on `auto`, replying to inbound texts automatically.

  It is now settable on SMS channels through `conv_configure_channel`, the vendor tools, the `/v1` SMS endpoints, and a control in the Twilio and MessageBird dialogs alongside the one email already had. Set `draft_only` on a number you only run campaigns from and inbound replies are drafted for approval instead of auto-answered.

  Voice channels reject it with an explanation rather than accepting a value that would do nothing: an inbound call is run by the vendor's assistant, not by the Munin agent, so there is no reply for the mode to govern.

  Also corrects `conv_create_channel`'s description, which claimed "the `voice` and `sms` channel types are reserved and not yet wired to an adapter". Both SMS vendors and both voice vendors have shipped adapters; those channels are created with `conv_configure_channel`, which the description now says.

### Patch Changes

- 8e98f2d: Fix several mobile/touch dashboard UI issues

  - Email channel dialog: the focused-input ring on the leftmost field was clipped, because `overflow-y-auto` forces `overflow-x` to compute as `auto` too, and the scrolling wrapper had no padding of its own to give the ring room. Added a small inset/outset pair so the ring renders without shifting any content.
  - Settings topbar: the mobile menu button had a border (`variant="outline"`) inconsistent with the borderless cog icon elsewhere; switched to `variant="ghost"`.
  - Settings topbar back arrow and dashboard topbar cog icon were styled gray-by-default with hover turning them black — correct for a mouse, but permanently gray on a touch device with no hover state. Both now force black via `[@media(hover:none)]`, leaving the hover-capable (desktop) behavior unchanged.
  - Team page: the members and pending-invitations tables used a fixed `min-w-[640px]` with horizontal scroll on narrow viewports. Below `md`, both now render as a stacked card list instead — members show name/email, then role select + edit/remove actions in one row (role stays visible since it's the only place to change it, unlike the edit dialog which only renames); invitations show email, then role chip + revoke in one row, matching the same alignment pattern.

- b98f618: Outbound calls and text messages are approved only by a person in the dashboard

  A proposal whose campaign runs on a voice or SMS channel can now only be approved by a signed-in dashboard user. `outreach_approve_proposal` refuses every other caller — an MCP agent, an unrestricted admin API key on the control plane, a curator, the Slack approval button — and the proposal stays `pending`. Email approval is unchanged, including by agents and admin keys.

  The check lives in `OutreachService.approveProposal`, so it holds regardless of which surface the call arrives through. It is not an MCP tool-visibility hint: hosts that don't implement MCP Apps still list the tool, and calling it on a voice proposal fails there too.

  Slack declines these in-thread with a pointer to the dashboard rather than surfacing a service error. The Inspector panel drops the approve button for voice and SMS proposals — Dismiss stays, since dismissing sends nothing — and says where the call is actually placed.

  Quiet hours and blackout dates are now enforced when a call or text is approved. They were previously stored on the campaign and consulted only when listing due follow-ups, so nothing stopped a call at 3am. `cadenceRules` gains an optional `quietHoursTimezone` (IANA, validated) that quiet hours and blackout dates are read in; without it they are read in UTC, which is not what a Norwegian campaign means by "no calls before 08:00".

- 862b055: Remove the MCP tools that place outbound voice calls

  `conv_call_channel` and `conv_call_contact` no longer exist on the MCP surface, so no connected agent can place a phone call. Anthropic's MCP directory does not list connectors that let an assistant dial third parties on its own, and an in-client tool-approval click does not clear that bar.

  Nothing else changes. The `VoiceCallbackService` and `ChannelAdminService.call` service methods stay, the `/v1/conversations/channels/:id/call` endpoints stay, and the dashboard's per-channel test call keeps working — it is authenticated as a human dashboard session, not as an agent. `conv_request_callback` also stays: it is `self_service`-only, so it is reachable by an org's own end-user agents (the widget's "can you call me?" flow) and refused for admin callers by the audience gate in `dispatch.ts`.

  The dashboard action is renamed from "Place a call" to "Make a test call", matching "Send test email" and "Send test SMS" — verifying a newly configured voice channel is what it is for.

  Outbound calling as a product capability moves to `outreach`, where a voice campaign already drafts a proposal that a human approves before anything is dialed.

- c5a05c5: SMS channel dialogs: agent-reply select on create, sender switching actually clears

  The "Agent replies" select is now on the SMS create dialog, not just edit — a new channel no longer silently starts on `auto` until someone goes back and changes it. Renamed from "Default agent mode" / "Inbound replies" to a shared "Agent replies" across email and SMS dialogs, since "agent mode" is the database column name, not something an operator configuring a phone number has a mental model for.

  Twilio's From-number and Messaging-Service-SID fields are now a single "Send from" choice instead of two always-visible inputs with an "either, both is also OK" caveat. Switching the choice on an existing channel now actually clears the field you switched away from — `updateChannel` previously merged with `?? prev`, so the old value survived a switch and both were sent on every message.

- Updated dependencies [c5a05c5]
- Updated dependencies [c5a05c5]
  - @getmunin/types@4.75.0
  - @getmunin/ui@4.75.0

## 4.74.0

### Minor Changes

- cad7227: Analytics: one row per page view, read depth and route changes tracked by default, canonical subject ids, declarative events, generic search ingest, and identity backfill.

  **Breaking for dashboards, not for code: `views` changes meaning.** Until now every page load wrote at least two rows — the initial view plus an exit beacon carrying `dwellMs`, plus one more per SPA route change — so tracker-sourced `views` was inflated roughly 2×. The tracker now mints a `viewId` per page view and sends it on both beacons; ingest upserts on the new partial-unique `(org_id, client_view_id)`, so the exit beacon enriches the row instead of adding one. Tracker `views` drops ~50% on the deploy date; `visitors` is unchanged. History carries no `viewId` and is not repairable, so don't compare `views` across the upgrade. Beacons without a `viewId` still insert one row each — old cached bundles keep working.

  Enrichment is max-wins for `dwell_ms` / `read_depth` and fill-if-null for attribution (`referrer`, `utm_*`, `path`, `locale`, `country`, `metadata`, `end_user_id`), so an exit beacon that overtakes the initial view — `sendBeacon` guarantees no ordering — can create the row without erasing the real referrer. `clientViewId` is deliberately absent from `analytics_export_events` / `analytics_import`: it is an ingest dedup key, and merging two servers' events would collide on the index.

  **No new flags.** The bundle now measures scroll depth and tracks route changes for every site, and ingest canonicalizes subject ids, all without configuration:

  - **Read depth** — passive `scroll` + `resize` listeners, rAF-throttled, deepest 25/50/75/100 milestone, sent on the exit beacon so it costs no extra row. `avgReadDepth` in `analytics_get_subject_engagement` finally has data.
  - **Exit reporting on two triggers** — dwell and read depth are sent on `visibilitychange` → hidden as well as `pagehide`. Unload-only beacons are why `dwell_ms` was sparse (mobile app-switch and tab-kill often fire only `visibilitychange`), and reporting twice is free because enrichment is idempotent: same `viewId`, max-wins on both columns. The usual hidden-then-`pagehide` pair sends once; a reader who returns and leaves again reports a larger value. `dwell_ms` now accumulates only the time the page was visible, so max-wins can't be poisoned by a tab left open in the background — previously it was wall-clock from view start, which with two triggers would have made the inflated report the winning one.
  - **Route changes** — `history.pushState` / `replaceState` / `popstate` close the previous view and open a new one. Changes that leave `location.pathname` alone are ignored, so query-param filter and tab state costs nothing and a classic multi-page site never triggers it.
  - **Canonical subject ids** — trailing slashes are always folded (`/pricing/` → `/pricing`), and a leading locale segment is folded when it matches the locale the page itself reports via `<html lang>`, which every beacon already carries (`/en/pricing` on `lang="en-US"` → `/pricing`). The match is exact against the full tag or its language subtag, so `/enterprise/pricing` and `/uk/pricing` on `lang="en-GB"` are untouched, ids that don't start with `/` are never rewritten, and `path` always keeps the raw URL. **Existing localized sites will see subject ids move at the deploy date** — `/en/pricing` events start landing on `/pricing`, so one subject goes quiet and another appears.

  `analytics_create_tracker` / `analytics_update_tracker` take `canonicalLocales` for the two cases inference can't reach: pages that set no `lang`, and a URL prefix that disagrees with the tag (`/no/priser` on `lang="nb-NO"`). It applies from the next event with no site redeploy, which is why it lives on the tracker rather than in markup.

  Also new:

  - `data-mn-event` on any element records a click as a view event, with `data-mn-subject-type`, `data-mn-metadata` (defensively parsed JSON object) and `data-mn-once="session"`. `window.mn.trackOnce()` is the JS twin.
  - `POST /v1/a/s` and `window.mn.trackSearch(query, resultCount)` record search events from any search implementation. `analytics_list_zero_result_searches` previously only saw Munin's own CMS delivery search, which left every site running Pagefind/Algolia/a hand-rolled index structurally dark.
  - CMS entry views: `_tracking` now ships the bare `token` alongside `pixelUrl`/`beaconUrl`, and the tracker records entry views with a visitor id via `window.mn.trackEntry(token)` or `<div data-mn-entry-token="…">` — on the page that shows the entry, not on list cards, since a `cms_entry` view means "read this" and tagging an index would rank the homepage highest (the skill says so, and names a separate `subjectType` for impressions). The pixel cannot report `visitors` (it takes no visitor parameter, and a first-party cookie can't survive the cross-origin API) — that limitation is now stated in the skill instead of being discovered from `visitors: 0`.

  Identity linking backfills: `identify` (and the chat widget's own identity resolution) now stamps `end_user_id` on that visitor's anonymous `analytics_view_events` / `analytics_search_events` rows from the last 30 days, in the same transaction as the bridge row. The auto page view always beats the `identify` round-trip, so without this the first event of every new visitor's session stayed anonymous forever. Adds `analytics_search_events_visitor_idx` to keep that update indexed.

### Patch Changes

- c7bf800: CMS: the `cms_list_assets` panel shows two rows and opens an asset in a dialog.

  The panel rendered every asset the tool returned — an org with 60 images got 60 thumbnails, and picking one appended a detail block below the fold, so the thing you clicked and the thing you wanted to read were never on screen together.

  - **Eight thumbnails, then a footer control.** The grid is pinned to four columns (two on narrow hosts) and cut at two rows. The footer carries the state and the action: `8 OF 16 ASSETS` alongside `SHOW ALL 16 ↓`, toggling back to `SHOW FEWER ↑`. Nothing is dropped silently — the count is always the full total, and the toggle only appears when there is something hidden.
  - **Clicking a thumbnail opens a modal over the grid**, not a block under it: scrim, viewport-centered card, image scaled to fit, then the name, mime and size, alt text, the public URL with a copy-to-clipboard button, and the usage line from `cms_list_asset_usage` (still fetched once per asset and cached). Escape, the ✕ and a scrim click all close it. Copy degrades quietly where the host iframe withholds clipboard access.
  - **The backdrop matches the shared dialog** (`packages/ui` `DialogBackdrop`): `ink/40`, no blur, no drop shadow. The design mock called for a blurred scrim and a 60px shadow, but nothing else in the system does that — none of the 21 UI components carry a shadow at all.

- Updated dependencies [cad7227]
  - @getmunin/types@4.74.0
  - @getmunin/ui@4.74.0

## 4.73.0

### Patch Changes

- 62776e2: CMS: `cms_get_entry` no longer renders an MCP Apps panel.

  An entry is a document — long prose, blocks, images, under a user-defined schema — which is the worst fit for a fixed card in a chat transcript. The panel rendered every field stacked at full height and dumped `blocks` fields as raw JSON into a `<pre>` with no height cap, so reading one article produced a screen-and-a-half of transcript.

  The decisive constraint is that the binding is per-tool, not per-call: hosts resolve `_meta.ui.resourceUri` from the tool definition, and neither the MCP Apps spec nor the ext-apps SDK defines a way to suppress rendering for a single call. So a panel that is mildly useful when reviewing one draft is unavoidably also rendered five times when an agent reads five entries for a research pass. There is no setting that makes it appear only when it helps.

  Nothing moves out of reach. `cms_publish_entry` / `cms_unpublish_entry` / `cms_schedule_publish` were never app-only — unlike the outreach and CRM proposal actions — and they carry `destructiveHint: true`, so the human confirmation lives in the host's destructive-tool prompt rather than in a panel button. The tool result is unchanged: the full entry JSON was always in `content`, which is what the model reads.

  The inspector app keeps its other six panel-bound tools (`cms_list_assets`, `kb_list_curation_candidates`, `crm_list_merge_proposals`, `outreach_list_proposals`, and the four analytics reads), all of which wrap bounded, actionable payloads. The entry view, its type guards, its `inspector.entry` translations, and its styles are deleted.

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

- 09a2eeb: Dashboard: consistent load-failure states in the inbox drawers, and one action shape for every integration card.

  ## Inbox drawers

  A failed detail fetch looked like two different products depending on which drawer you were in: the conversation drawer replaced the whole drawer with a left-aligned eyebrow + serif heading + accent Retry + Close, while the queue drawers kept their header and footer and showed a centered icon with one grey line and a small outline Retry. Neither was wrong on its own; together they read as unfinished.

  - **`NETWORK_ERROR` is now a real error code.** `api.ts` stamped a hardcoded English sentence into `ApiError.message` on a fetch rejection, and the conversation drawer rendered that raw string under a localized heading — hence a Norwegian title above "Couldn't reach Munin. Check your connection." The queue drawers dodged the same bug by discarding the error and printing a fixed localized line, so they never told you _why_. The transport layer now sets `code: 'NETWORK_ERROR'` and `errors.NETWORK_ERROR` exists in both locales, so `useTranslateError` localizes it everywhere — including surfaces that were never part of this bug report.
  - **The regex that sniffed for that English string is gone.** `InlineActionError` matched `/reach munin|check your connection|network/i` against the message to decide whether to swap in a terse localized reason; it now reads `code === 'NETWORK_ERROR'`, so `ConvActionError` carries the code alongside the message. Copy changes can no longer silently break the substitution.
  - **One `DrawerLoadFailed` in `queue-drawers/shared.tsx`** replaces both the conversation drawer's local copy and `DrawerErrorState`: destructive eyebrow, serif title, the localized reason, and a retry button that shows its own in-flight label. It tracks that state itself from the promise `onRetry` returns, so no caller has to thread a flag — the conversation drawer previously passed the unrelated action-pending flag, which meant its "Retrying…" label never actually appeared.
  - **The header stays, and it names the conversation.** The conversation drawer discarded its header, taking with it the only clue about which conversation failed — and then had to add its own Close button, a second affordance the queue drawers don't need. It now renders a header like every other drawer, so `close ×` is the single way out. `ConvDrawer` carries an optional `title`, which the recent-conversations row fills with the subject it already renders (the only path that reaches this state — live-now cards always have a seeded stub detail), so the header shows the real subject instead of the word "conversation" stuttering against its own pill.
  - **The dead footer goes.** A queue drawer whose body failed to load kept a footer of disabled Approve/Edit/Dismiss buttons plus a `⌘↵` hint for a shortcut already guarded to a no-op. When the load fails there is nothing to act on, so the footer isn't rendered.
  - One name per value across the drawer boundary: `QueueDrawer`'s `detailError` / `onRetryDetail` props are now `loadError` / `onRetry`, matching what they were already renamed to one level down, and the derived boolean is `loadFailed` in both queue drawers (`convLoadError` in the conversation drawer). The controller keeps `detailErrors` / `queueDetailErrors`, which distinguish per-item detail fetches from the page-level `loadError` on the same object.
  - Drops the duplicate `dashboard.overview.drawer.retry` key in favour of `common.retry` / `common.retrying` — identical strings in both locales, and the divergence started with the two error states each picking a different one.

  ## Integrations page

  A connected Slack card carried three same-weight footer buttons — Configure, Test, Remove — against two on a connected connector, so nothing read as primary, the destructive action sat one pixel from Test at equal visual weight, and a fourth action would have wrapped the row inside a three-across grid.

  - **`IntegrationCard` takes a `menu` slot**, rendered top-right, and every footer is now exactly one button — so the cards line up across the grid and per-vendor differences cost no layout. Slack connected: primary _Configure_, menu _Test_ + _Remove_. Connector: primary _Test_ (or _Enter credentials_ while pending), menu _Remove_. Unconnected cards keep their single _Connect_ and get no menu at all. The trigger reuses the `MoreHorizontal` + `DropdownMenu` idiom the CMS queue drawer already uses, with `Remove` as a `destructive` item below a separator — destructive is never inline now.
  - Slack legitimately has one more capability than a connector (routing lives in Munin; a connector's credentials _are_ its config), so the fix isn't to remove the action — it's to stop the card surface from exposing that as a longer row of identical buttons.
  - **Suppresses the instance suffix when it equals the vendor name.** A connection a customer names after its own vendor rendered as "Shopify · Shopify".
  - **Retitles the page in the house voice.** It was the only settings page whose title was a marketing sentence rather than a short raven-flavoured line ("Keys to the _gate_.", "The _council_.") and the only one whose eyebrow lacked the `Category ·` prefix. Now `Workspace · Integrations` / "Out into the _world_." — the ravens flying out to other systems — with a lede that covers both sections instead of only the operator bridges.

- Updated dependencies [0ac33df]
  - @getmunin/types@4.73.0
  - @getmunin/ui@4.73.0

## 4.72.0

### Minor Changes

- 064cd7b: Show channel and tracker save failures inline in the form instead of replacing the dialog with a full-screen "Save failed" stage. The message (plus `request_id` when the server sent one) now sits above the footer, with the form's own submit button acting as the retry. Removes the `SaveErrorStage` component and its exports.

### Patch Changes

- f7113e4: Connector secrets can no longer transit the conversation

  `connectors_create_connection` and `connectors_update_connection` now reject secret
  config fields outright — the only way a secret enters Munin from an agent flow is the
  one-time credential link. Creating a connection returns the link directly; the
  `connect-external-system` skill is rewritten around that flow (its examples previously
  showed pasting `accessToken` into the tool call, which is why agents offered chat
  paste as an option).

  Two credential-link dead ends are fixed alongside:

  - A pending connection missing required non-secret config (e.g. Shopify without
    `shopDomain`) is now rejected at create time with the missing keys named, instead of
    minting a link whose save step can never validate.
  - The credential-entry page keeps the one-time token on a failed save (the server
    only consumes it on success), so it now offers a retry that resets the form instead
    of stranding the user on an error. Also drops the doubled top padding on the
    status states.
  - The Shopify adapter's default Admin API version moves from the sunset `2025-01`
    to `2026-04`.

- a567576: Move the Slack test action out of the configure dialog onto the Slack card as a "Test" button, matching the data-connector cards. The configure dialog now has Cancel next to Save channel.
  - @getmunin/types@4.72.0
  - @getmunin/ui@4.72.0

## 4.71.0

### Patch Changes

- Updated dependencies [426a66e]
  - @getmunin/types@4.71.0
  - @getmunin/ui@4.71.0

## 4.70.1

### Patch Changes

- @getmunin/types@4.70.1
- @getmunin/ui@4.70.1

## 4.70.0

### Minor Changes

- 5cb5ff3: CMS: lift the dashboard's 100KB image-upload ceiling and stop leaking agent-oriented error strings into the UI.

  The dashboard's cover-image upload previously went through the base64 path shared with the `cms_upload_asset_from_base64` MCP tool, inheriting its 100KB cap (which exists to keep agent tool payloads small) and surfacing its raw error message verbatim. Now:

  - New control-plane endpoints `POST /v1/cms/drafts/:id/assets/upload-request` and `POST /v1/cms/drafts/:id/assets/:assetId/complete` expose the existing presigned upload flow (up to 50MB), and the dashboard uses them. Note for S3-backed deployments: the bucket CORS policy must allow PUT/POST from the dashboard origin.
  - The dashboard downscales images client-side before upload (long edge capped at 2400px, re-encoded as WebP with JPEG/PNG fallback), so stored assets are delivery-ready instead of raw camera files.
  - `CmsInvalidError` carries a specific `code` (`cms_asset_too_large` for size-limit rejections), the CMS drafts controller includes `code` in error bodies, and the dashboard inbox/queue surfaces translate known codes through `useTranslateError` (new `errors.*` copy in English and Norwegian) instead of showing raw backend messages.

- 4601314: Extend the inspector MCP App with five new views: CRM merge-proposal review (side-by-side contact comparison with app-only apply/dismiss), KB curation-candidate review (new `kb_list_curation_candidates` tool, app-only `kb_publish_curation_candidate`), analytics charts (views over time, funnel, traffic by source, contact journey), CMS entry preview with publish/unpublish/schedule actions, and a media-library thumbnail gallery. The panel resource now CSP-allows the asset-storage origin so thumbnails render inside the iframe.
- e123820: Add `outreach_revise_proposal` and `outreach_withdraw_proposal`, the two agent-side corrections to a pending outreach draft.

  `outreach_revise_proposal` rewrites the draft in place on the same proposal id — the contact and campaign are fixed, since a different recipient is a different proposal. A `reason` is required and the revision is recorded (`revisionCount`, `lastRevisedAt`, `lastRevisionReason`, revising actor), so an edit can never be silent. Proposals now also record the first time a human opens them for review; when a revision lands after someone else has already read the draft, `revisedAfterReviewAt` is stamped and both the dashboard review drawer and the MCP Apps inspector panel warn the reviewer that Wednesday's text is not the text they read on Monday.

  `outreach_withdraw_proposal` lets a curator retract its own pending draft — a duplicate, a prospect who turned out not to qualify, a bounced address — under a new terminal `withdrawn` status. Withdrawal is deliberately neutral: it does not suppress the contact, does not touch consent, and does not stop a campaign sequence, so a withdrawn follow-up leaves that step eligible again where a dismissed one ends the sequence for good. Slack approval cards resolve as withdrawn, and `skill://outreach/review-proposals` documents when each of the four verbs applies.

### Patch Changes

- Updated dependencies [e123820]
  - @getmunin/types@4.70.0
  - @getmunin/ui@4.70.0

## 4.69.3

### Patch Changes

- 137fe87: Auth: actually link social sign-ins when the pre-existing local account's email is unverified. better-auth's account linking has a second gate — `requireLocalEmailVerified` (default `true`) — that rejects linking a trusted provider to an existing account whose email isn't verified. Since email/password sign-up runs with `requireEmailVerification: false`, those accounts are unverified, so Google/GitHub sign-in still failed with `account_not_linked`. Set `requireLocalEmailVerified: false` (the incoming provider's verified email is the proof of ownership). Also surface OAuth `?error=` codes on the login page instead of silently showing a clean form.
  - @getmunin/types@4.69.3
  - @getmunin/ui@4.69.3

## 4.69.2

### Patch Changes

- 5b82be8: Auth: link Google/GitHub sign-ins to an existing account with the same verified email instead of failing with `account_not_linked`. OAuth errors now redirect to the app's login/signup page (via `errorCallbackURL`) instead of the API origin root, which returned a 404.
  - @getmunin/types@4.69.2
  - @getmunin/ui@4.69.2

## 4.69.1

### Patch Changes

- @getmunin/types@4.69.1
- @getmunin/ui@4.69.1

## 4.69.0

### Minor Changes

- 7078b30: CMS draft preview links: drafts can now be viewed rendered by the customer frontend before publishing. `cms_get_preview_link` (and `POST /v1/cms/drafts/:id/preview-link`, plus a Preview action in the inbox drawer) mints a signed, entry-scoped token valid for 1 hour; the public delivery API's single-entry route accepts it as `?preview=<token>` and returns the entry regardless of status with `Cache-Control: no-store` and a `status` field. Reference expansion under preview includes draft-status referenced entries so the previewed page is truthful. Collections can carry a `settings.previewUrl` template (`{token}`, `{slug}`, `{locale}`, `{collection}` placeholders) pointing at the frontend's draft-mode endpoint; the full frontend contract is documented in the new `skill://cms/preview-entry`. List and search delivery routes never accept preview tokens.

### Patch Changes

- Updated dependencies [18dc6a6]
- Updated dependencies [6f31549]
  - @getmunin/types@4.69.0
  - @getmunin/ui@4.69.0

## 4.68.0

### Minor Changes

- 8da0e90: Connectors management UI and secure credential handoff. The Integrations settings page gains a Data connectors section to list, add, test, and remove connections. Secrets can be entered inline or handed off: creating a connection without its secret returns a one-time link (`/connect/credentials`) a human opens to enter credentials in the dashboard, so secrets never pass through an agent conversation. Backed by a generic `credential_requests` handoff primitive (reusable by other MCP-set-up integrations) and a `/v1/connectors` control-plane API.
- a66d454: Integration foundations: `EventSink` contract on `WebhookDispatcher` for transactional event fan-out to integration bridges, and the Integrations settings hub page that operator bridges and connectors slot into.
- cdff1ad: Move the Slack card to the Integrations settings page

  Slack was parked on the AI settings page for lack of a better home. It now lives on the **Integrations** page (`/dashboard/settings/integrations`, introduced in the integration foundations release) under the "Operator bridges" section, keeping AI settings to model/persona/skill config. The card moved to `components/integrations/`, its disconnect flow uses the shared confirm dialog, and its i18n moved from `agentSetup.slack.*` to `integrations.slack.*` (en + nb).

- 8037e74: Slack integration phase 1: mirror conversations into Slack threads (operator surface)

  - New `slack` module: per-org workspace connection via Slack OAuth (deployment-level app credentials in `SLACK_CLIENT_ID`/`SLACK_CLIENT_SECRET`), channel routing, and a bridge worker that projects conversation events (`created`, messages, status, assign/claim, handover) into one Slack thread per conversation. Handover requests additionally alert a configurable escalations channel with an optional mention.
  - The bridge registers an `EventSink` on `WebhookDispatcher` (contract introduced in the integration foundations release) — deliveries are enqueued transactionally with the emitted event; the webhooks queue and the Slack bridge are peer consumers.
  - New tables (`slack_integrations`, `slack_channel_routes`, `slack_conversation_links`, `slack_message_links`, `slack_user_links`, `slack_deliveries`) with RLS; a Slack channel can only mirror one org (`(team_id, slack_channel_id)` unique), so one workspace can serve multiple orgs.
  - Admin MCP tools `slack_get_install_url`, `slack_get_status`, `slack_set_routing`, `slack_test`, `slack_disconnect` (scopes `slack:read`/`slack:write`), the `skill://slack/connect-slack` setup skill with the app manifest, `/v1/slack` control endpoints, and a Slack card under AI settings → Integrations.

  Reply-from-Slack and interactive claim/close buttons are follow-up phases; message links already dedupe both directions to keep the loop-prevention invariant.

- 3677620: Slack routing without channel IDs: the configure dialog lists the channels the bot has been invited to (new `GET /v1/slack/channels` + `slack_list_channels` tool), and inviting @Munin to an unrouted channel posts an interactive prompt where an org owner/admin can set default or escalations routing directly from Slack. Also fixes the Slack Web API client to form-encode requests (read methods rejected JSON bodies with invalid_arguments, surfacing as a 500 when saving a route) and sends the OAuth install back to the Integrations page instead of AI settings.

### Patch Changes

- d4bfeb7: 1px hairlines everywhere, tuned rule weight, and honest bookings connector copy:

  - All `0.5px` borders and inset-shadow outlines are now `1px` — sub-pixel widths rendered inconsistently across devices.
  - Rule alpha compensates for the doubled width (light `0.145 → 0.09`, dark `0.2 → 0.13`) and is now single-sourced from the `--munin-rule-*-alpha` tokens; the tailwind preset, Button, and the team-page role select reference the tokens instead of hardcoding alphas.
  - Buttons, pills, auth-shell CTAs, and the team role select draw their outline with a real `border` again instead of the inset box-shadow workaround (iOS Safari only dropped sub-pixel borders; integer widths are safe). Pill padding compensates so rendered size is unchanged; pill outlines soften to 55% `currentColor`.
  - Dashboard/settings topbars adopt the marketing-site chrome: translucent blurred bar with a soft always-on hairline instead of a full-ink border. System-alerts banner border softens from full ink to `ink/20`.
  - Dialog field hints are smaller and grayer (`text-xs text-ink-mute`) to read as metadata next to labels.
  - Gastroplanner connect dialog now advertises the full bookings surface (check availability + book, change/cancel) instead of lookup only, and the "read directly — never copied" note is reworded to "live against the vendor — nothing stored in Munin" since bookings writes. Sonner toasts get their intended ink border (the CSS var name was previously mistyped and ignored).

- ed38e6c: Stack the Live now card actions below the text on small screens so the quote no longer collapses into a narrow column on mobile.
- 47f509d: Norwegian localization: replace the anglicism "team"/"teammedlem" with "medarbeider(e)" across the nav, team page, landing subtitle, and OAuth consent copy.
- 491186c: Multi-step outreach sequences. Campaigns can define ordered `sequenceSteps` (wait period + drafting brief per step, email campaigns only); a daily curator sweep (`skill://outreach/draft-followup-email`, `MUNIN_CURATOR_OUTREACH_FOLLOWUP_CRON`) finds conversations whose next step is due via the new `outreach_list_due_followups` tool and files `kind: 'followup'` proposals with `outreach_propose_followup` into the existing human review queue. Any inbound reply permanently stops a sequence (the reply flow takes over), as does unsubscribe/suppression or dismissing a follow-up draft. Follow-ups thread into the initial's conversation with no subject or unsubscribe footer, and export/import round-trips sequences.
- 8788bd4: Localize the smart/fast model-tier badges (nb: "rask") and surface connector config validation as inline field errors: invalid connector config now returns structured `fieldErrors` instead of a raw zod JSON blob, and the connect dialog highlights the offending inputs with localized per-field messages instead of toasting. The Tailwind preset now defines the `aria-invalid` variant (absent from Tailwind v3 defaults), so the destructive border/ring on invalid inputs actually renders.
- Updated dependencies [d4bfeb7]
- Updated dependencies [491186c]
- Updated dependencies [8788bd4]
  - @getmunin/ui@4.68.0
  - @getmunin/types@4.68.0

## 4.67.2

### Patch Changes

- @getmunin/types@4.67.2
- @getmunin/ui@4.67.2

## 4.67.1

### Patch Changes

- @getmunin/types@4.67.1
- @getmunin/ui@4.67.1

## 4.67.0

### Patch Changes

- @getmunin/types@4.67.0
- @getmunin/ui@4.67.0

## 4.66.1

### Patch Changes

- 3e0b921: Polish Norwegian (nb) dashboard translations. Replace the stiff blanket "tilbakekalle" for _revoke_ with context-appropriate verbs (agents → "Koble fra", tokens/invitations → "Trekk tilbake", API keys → "Slett", tracker keys → "Deaktiver"), rename Trackers to "Sporing"/"Sporingskoder", and fix the anglicised "tokens" plural. Splits the shared `common.revoke` string into per-page `dashboard.agents.revoke` / `dashboard.apiKeys.revoke` keys so each surface can use its own verb.
  - @getmunin/types@4.66.1
  - @getmunin/ui@4.66.1

## 4.66.0

### Minor Changes

- 768642a: Localize the inspector panel from the MCP App host locale.

  - The panel reads `getHostContext()?.locale` after connect (falling back to `navigator.language`, then `en`) and re-renders on `onhostcontextchanged`, so it follows the user's Claude language setting rather than the iframe's browser default.
  - Strings live in a new `inspector.*` namespace in `@getmunin/dashboard-pages`' message catalogs (English + Norwegian), now exposed via a `./messages/*.json` export; the panel bundles only that namespace (~1 kB per locale) through a small `t(key, params)` helper.
  - Ages in the proposal ledger format through `Intl.RelativeTimeFormat` with the host locale instead of hardcoded English abbreviations.

  Server-originated strings (tool error messages) remain English.

### Patch Changes

- fb104ce: fix(docs): use the real `mn_admin_` admin key prefix in MCP connect guides and setup placeholder (was the non-existent `mn_live_`)
- 04cab6d: Resume a pending OAuth authorize instead of dropping it at the login page. When better-auth bounced `/auth/oauth2/authorize` to `/login` and the user already had a session, `redirectIfAuthenticated` ignored the OAuth query and redirected to `/dashboard`, stranding the connector mid-flow. It now detects authorize params (`response_type=code` + `client_id`) and redirects back to the authorize endpoint. The consent page's unauthenticated and switch-account bounces now carry the OAuth query to `/login` (the previous `?next=` param was never read, and its absolute URL would have been rejected anyway), so the existing post-sign-in resume logic completes the flow.
- Updated dependencies [b84577f]
  - @getmunin/ui@4.66.0
  - @getmunin/types@4.66.0

## 4.65.0

### Patch Changes

- 07f1d6e: analytics-tracker: expose a readiness signal. Once the tracker's public API is installed it sets `window.mn.ready = true` and dispatches a `munin:ready` CustomEvent on `document`, so consumers can run identify round trips (or any `window.mn.*` call) as soon as the async script is ready — no polling, no dependence on the loader's own readiness callback:

  ```js
  window.mn?.ready ? go() : document.addEventListener('munin:ready', go, { once: true });
  ```

  `skill://analytics/identify-visitors`, the frontend-integration playbook, and the dashboard embed snippet now show this pattern.
  - @getmunin/types@4.65.0
  - @getmunin/ui@4.65.0

## 4.64.0

### Minor Changes

- 1823364: Security hardening from a full audit.

  - **Voice tool bridges (Vapi, Threll):** enforce tenancy on every self-service tool call. The bridges previously disabled RLS without setting `app.org_id` and granted wildcard scope, allowing cross-tenant reads/writes; they now apply the standard tenancy GUCs and the restricted self-service scope set.
  - **OAuth JWT verification:** pin verification to the algorithm bound to the trusted JWKS key and reject symmetric algorithms, closing an algorithm-confusion gap.
  - **Analytics `identify` (BREAKING):** the identity hash now signs `${externalId}:${visitorId}` so a leaked hash can't link a different visitor. Compute `HMAC(secret, "<externalId>:<visitorId>")` where `visitorId` comes from the new `window.mn.getVisitorId()`. The server-rendered `data-external-id`/`data-user-hash` auto-identify is removed — do the read-visitor-id → sign → `window.mn.identify()` round trip instead.
  - **Webhook replay guidance:** documented that receivers should reject deliveries whose signed `createdAt` is outside a freshness window (in addition to the existing `x-munin-delivery-id` idempotency). No wire-format change — the signature scheme is unchanged.
  - **MCP scopes:** `webhooks_*`, `feedback_*`, and `system_alerts_*` tools now require real `webhooks:*` / `feedback:*` / `system_alerts:*` scopes instead of being gated by audience alone.
  - **Capability tokens:** view, unsubscribe, and email-open tokens now enforce a max age (and reject future-dated tokens), preventing indefinite replay of leaked links.
  - **Tool hints:** `conv_test_channel` and `conv_test_email_channel` are marked destructive (they open outbound vendor connections) so they prompt before running.
  - **Input validation:** a caller-supplied `endUserId` is validated against the caller's org in delegated-token minting and `crm_create_contact`.

### Patch Changes

- b4978ab: Format `date` and `datetime` fields in the read-only CMS entry drawer using the viewer's locale instead of printing the raw stored ISO string (e.g. `Jun 29, 2026, 12:00 PM` rather than `2026-06-29T12:00:00.000Z`), matching how the edit-mode date picker displays them.
- bd0cb38: fix(channels): stop the email channel dialog button label flashing on cancel

  The "Edit email channel" dialog derived its edit/create state live from the
  `editChannel` prop. Cancelling cleared that prop before the dialog's close
  animation finished, briefly re-rendering the still-mounted dialog in create
  mode (the footer button flashed from "Save changes" to "Create"). The edit
  state is now frozen while the dialog is open.
  - @getmunin/types@4.64.0
  - @getmunin/ui@4.64.0

## 4.63.1

### Patch Changes

- 0d56ab7: Fix two rendering gaps in the CMS draft-approval block editor. Array (string-list) and `multi_select` fields — and array-of-text block props such as a stat block's `items` — no longer fall through to a raw JSON dump: they render as a clean list / comma-separated values, and in edit mode get a proper list editor (add / remove / reorder) and a checkbox group. Markdown prose now renders GitHub-flavored markdown (tables, strikethrough) via `remark-gfm`, so a comparison table in a prose block shows as a table instead of raw pipe-delimited text. The GFM upgrade applies to all shared markdown rendering in the dashboard drawers (KB, outreach, conversation drafts, message bubbles).
- 9a87f0b: Fix dashboard overview row heights and pill text centering. Queue rows no longer grow taller on hover — the right-hand slot now always reserves the action buttons' height (`h-7`) whether it shows the timestamp or the hover-revealed approve/dismiss buttons. The "open conversations" rows now reserve the same height, so both sections line up at a consistent row height. Pills (e.g. the `CMS` badge) get `leading-none` so their uppercase text is vertically centered within the badge instead of floating high.
- Updated dependencies [9a87f0b]
  - @getmunin/ui@4.63.1
  - @getmunin/types@4.63.1

## 4.63.0

### Minor Changes

- 499cce8: Render and edit CMS blocks in the draft approval drawer. Block-typed fields (e.g. an article body) previously fell through to a raw JSON dump; they now render as labeled block cards — each prop shown through its own field viewer (markdown, assets, etc.). In edit mode you can change block prop values, replace inline assets, add blocks (by type), remove them, and reorder them. Saving converts expanded asset props back to ids and restores inline `asset://` references so block content round-trips without losing asset links.

  Also: the CMS draft drawer's `select` fields now use the shared `NativeSelect` (consistent chevron with the rest of the dashboard instead of the browser-default arrow), and the outreach draft drawer's "Edit" action is now disabled while an approve/dismiss is in flight, matching the other queue drawers.

- 5902396: Show who a conversation is with in the inbox drawer instead of a bare end-user id.

  `GET /v1/conversations/:id` (and the `ConversationDetail` it returns) now carries
  the resolved counterpart identity — `contactEmail`, `contactName`, `contactPhone`
  — preferring the linked `conv_contacts` row and falling back to the `end_users`
  row. Both the full and simplified conversation drawers render the email (then
  name) in the header rather than the raw end-user id.

  Also tightens the queue row layout so long titles truncate and the row actions
  swap in on hover without overlapping the timestamp.

### Patch Changes

- @getmunin/types@4.63.0
- @getmunin/ui@4.63.0

## 4.62.1

### Patch Changes

- @getmunin/types@4.62.1
- @getmunin/ui@4.62.1

## 4.62.0

### Patch Changes

- @getmunin/types@4.62.0
- @getmunin/ui@4.62.0

## 4.61.1

### Patch Changes

- 47eb749: Keep the dashboard's recent open conversations list in sync with realtime conversation events, so closing a conversation removes it from the list without a page reload.
- 308d78e: Share a single realtime WebSocket connection across all `useRealtime` callers instead of opening one socket per component. The dashboard previously held several concurrent connections (inbox, usage summary, recent conversations, system alerts, activity rail); they now multiplex over one connection, with each `event` frame routed to only the listeners subscribed to its channel. The `useRealtime` API is unchanged.
  - @getmunin/types@4.61.1
  - @getmunin/ui@4.61.1

## 4.61.0

### Patch Changes

- 7576050: fix(setup): show the managed provider name in the onboarding summary

  The "Lift-off" summary on the setup wizard always rendered the host of `providerBaseUrl`, so when the workspace was configured to use the managed AI provider it still displayed a stale bring-your-own-key host. The summary now renders the managed provider's name when no API key is set, falling back to the base-URL host for self-configured providers.
  - @getmunin/types@4.61.0
  - @getmunin/ui@4.61.0

## 4.60.0

### Patch Changes

- 84ee716: feat(access): show the authorizing member on each flock row

  The flock (Settings → Agents) groups OAuth connections by client _and_ the org member who authorized them, but only the client name was shown — so two members who each connected, say, Claude produced two visually identical rows with no way to tell whose access a revoke would cut off.

  `GET /v1/tokens` now joins the authorizing user and returns `user: { name, email }` per row. The Agents page shows that member inline after the client name ("Claude · Kjell Rune Monsø", with the email on hover and as the fallback when no name is set), replacing the "· N connections" count — which only reflected dynamic-client-registration reconnects and wasn't actionable, since a row already represents one member's access to one client and revoke cuts off that whole group.

- 6719043: Dashboard: replace the single "last conversation" widget with "Last open conversations" — the 20 most recently active open conversations, newest first, with closed/snoozed/spam filtered out.

  Conversations: add a snooze-wake worker that reopens snoozed conversations once their `snoozeUntil` elapses, flagging them as needing human attention so they resurface in the inbox. Previously `snoozeUntil` was stored but never honored, so timed snoozes never woke on their own.
  - @getmunin/types@4.60.0
  - @getmunin/ui@4.60.0

## 4.59.2

### Patch Changes

- 3546224: feat(dashboard-pages): export skeleton loading components

  `Skeleton`, `TableSkeleton`, `CardSkeleton`, `CardListSkeleton`, and the `SkeletonColumn` type are now re-exported from the package barrel so downstream consumers can reuse them. Previously they lived in `components/skeleton.tsx` and were only reachable via relative imports inside the package — the `exports` map exposes only `.` and `./server`, so deep imports were blocked too.

- 6f941e1: feat(access): OAuth-only flock with client identity; tidy end-user display

  **The flock (Settings → Agents)** now lists only OAuth-authorized agents. Delegated end-user tokens are no longer mixed in — they're managed on the End-users page. Each row leads with the OAuth client's name (e.g. "Claude · 3 connections") and a small client icon/glyph (matching the consent screen) instead of a generic "OAuth refresh token" label, the Origin column is dropped (its info moved into the primary label), and the table uses a fixed layout so the scopes list wraps inside the Token column instead of squeezing the other columns. `GET /v1/tokens` returns only OAuth agents (with `iconUrl`) and no longer merges the `tokens` table.

  **The End-users page** now shows a single identity line (name, else email, else phone, else "—") with an avatar of initials derived from the name ("Jens Pettersen" → "JP") or the email's first letter ("kjell@apps.no" → "K").
  - @getmunin/types@4.59.2
  - @getmunin/ui@4.59.2

## 4.59.1

### Patch Changes

- 7c3fa39: Refresh stale product copy: drop the hardcoded "~80 tools" count from the MCP server instructions (the surface has long since outgrown it) and replace the old "agent-native business apps" tagline with "the customer platform for the agentic era" in the dashboard metadata titles.
- 1940b63: fix(control): list OAuth agents from refresh tokens, not access tokens

  The previous fix read `oauth_access_token`, but MCP clients (Claude Code, Cursor, …) send a `resource` parameter per RFC 8707, so BetterAuth issues them **stateless JWT access tokens that are never persisted** — that table is empty in practice, so the flock still showed "Agents · 0".

  `GET /v1/tokens` now lists live (non-expired, non-revoked) **refresh tokens** — the durable record of a connected OAuth agent. Because dynamic client registration mints a fresh `client_id` on every connect, grants are collapsed into one row per (client name, user) with a connection count. Revoking a row soft-revokes (`revoked = now()`) every live refresh token in that group, so the agent can't refresh back in once its short-lived JWT expires.
  - @getmunin/types@4.59.1
  - @getmunin/ui@4.59.1

## 4.59.0

### Minor Changes

- 2e3b87a: feat(conv): per-channel default agent mode

  Add `defaultAgentMode` (`auto` | `draft_only` | `off`) to conversation channels. New conversations inherit the channel's mode when no explicit mode is passed — including inbound replies that fail threading and open a fresh conversation. Set an outreach-only inbox to `draft_only` so prospect replies are always drafted for human approval and never auto-sent, even when threading can't link the reply to its originating conversation. Configurable via `conv_setup_email_channel` and the email channel dialog.

### Patch Changes

- 0fb358d: fix(control): show OAuth-authorized agents in the flock

  The Settings → Agents page ("The flock") read only the `tokens` table, which is populated solely by delegated end-user tokens. OAuth-authorized MCP clients (Claude Code, Cursor, Claude Desktop, …) have their access/refresh tokens persisted by BetterAuth in the separate `oauth_*` tables, so a fully-connected agent always showed up as "Agents · 0 / No connected agents yet".

  `GET /v1/tokens` now also lists live (non-expired) OAuth access tokens — one row per (client, user), scoped to the calling org via `org_members` — with the OAuth client name as the origin. Revoking such a row (`DELETE /v1/tokens/:id` for an `oat_*` id) deletes both the access and refresh tokens so the agent can't silently refresh back in.

- ad62308: feat(settings): standardize settings page loading with content-shaped skeletons

  Replaces the inconsistent per-page "Loading…" text with content-shaped skeletons across every settings page (API keys, channels, trackers, team, end-users, activity, audit log, usage, agents, AI, account). Table pages render proportional column-width row skeletons, list pages render card placeholders, the usage page shows tile and by-agent placeholders, and the activity feed shows row placeholders with a vertically-centered empty state. The AI settings page now renders each section header with its own per-section loading instead of a single global loader.

- edabd57: fix(auth): move Turnstile widget below the footnote links on auth forms

  Repositions the Cloudflare Turnstile widget to render below the "Create an account · Forgot password?" (and equivalent) footnote links on the login, signup, and forgot-password forms, instead of between the password field and the submit button. Submit gating is unchanged — the button still stays disabled until a captcha token is present.

- Updated dependencies [2e3b87a]
  - @getmunin/types@4.59.0
  - @getmunin/ui@4.59.0

## 4.58.0

### Minor Changes

- cd6b338: feat(auth): optional Cloudflare Turnstile captcha on email auth endpoints

  Adds opt-in captcha protection to the BetterAuth email flows (`/sign-up/email`, `/sign-in/email`, `/request-password-reset`). It is disabled by default and turns on only when both `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY` are set — the server verifies the token via the captcha plugin, and the shared login / signup / forgot-password forms render the Turnstile widget using the public site key exposed through `/v1/auth/providers`. Requiring both keys avoids a lockout where the server enforces a captcha the client cannot produce. Self-hosters who set neither key see no change.

### Patch Changes

- 238d889: fix(auth): carry the pending OAuth authorize request through Google/GitHub social login

  When a client (e.g. an MCP server in Claude) starts the OAuth 2.1 authorization flow and the user signs in with a social provider, the social `callbackURL` now resumes the original `/auth/oauth2/authorize` request instead of dropping to the dashboard. Previously only the email/password path preserved the pending authorize request, so social logins skipped the consent screen and never completed authorization.

- Updated dependencies [3d91858]
  - @getmunin/types@4.58.0
  - @getmunin/ui@4.58.0

## 4.57.1

### Patch Changes

- @getmunin/types@4.57.1
- @getmunin/ui@4.57.1

## 4.57.0

### Patch Changes

- bbfbdba: Fix infinite /setup ↔ /oauth/consent redirect loop for managed-provider orgs.

  The server-side onboarding gate (`redirectIfSetupIncomplete`) still keyed off `providerApiKeySet`, while the client setup/dashboard gates were migrated to `providerConfigured` (= own key OR a usable host-supplied default provider) in #513. For orgs running on a managed default provider — which never set their own key — the two gates permanently disagreed: the setup page considered onboarding complete and forwarded to OAuth consent, while the consent page considered it incomplete and bounced back to setup. `redirectIfSetupIncomplete` now reads `providerConfigured`, matching the client gates.
  - @getmunin/types@4.57.0
  - @getmunin/ui@4.57.0

## 4.56.1

### Patch Changes

- 2a7498b: Show a "Saved" confirmation after selecting the managed provider in AI settings. Previously the confirmation only appeared for BYOK providers, because the managed save path never set the message.
- ccafe38: Tidy up the origin-allowlist create forms. The "Leave empty to allow any origin" hint is gone from both the widget channel and analytics tracker forms — it's misleading when the deployment requires an allowlist. When an allowlist is required — `NEXT_PUBLIC_WIDGET_REQUIRE_ALLOWLIST=1` for the widget form (mirroring backend `MUNIN_WIDGET_REQUIRE_ALLOWLIST`), `NEXT_PUBLIC_TRACKER_REQUIRE_ALLOWLIST=1` for the tracker form (mirroring `MUNIN_TRACKER_REQUIRE_ALLOWLIST`) — the origin field is marked `required`, so an empty submit is blocked client-side with the browser's native "Please fill in this field" prompt instead of a round trip to the server. The bespoke "at least one origin required" message has been removed in favour of the native one.

  Also fix the full-page loading spinner background. In light mode it rendered `bg-bone` (`#E8E4DC`, the warm outer chrome) while the body and page content are `bg-background` (`#FBFAF7`), so the spinner was a visibly different shade than the page it was loading. All full-page spinners now use `bg-background`, matching the body exactly in both light and dark mode.

  And fix the agent-recipe links on the dashboard Get Started screen, which pointed at `/guides/recipe-*` (a 404) when `NEXT_PUBLIC_DOCS_URL` was unset. They now use the same resolved docs host as the MCP setup snippets (`DEFAULT_DOCS_HOST`, which includes the `/docs` base), so they correctly land on `/docs/guides/recipe-*`.
  - @getmunin/types@4.56.1
  - @getmunin/ui@4.56.1

## 4.56.0

### Patch Changes

- ccbc3a4: Update UI runtime dependencies within range: lucide-react 1.21, @base-ui/react 1.6, tailwind-merge 3.6, next-intl 4.13, and @react-email/render 2.0.9.
- Updated dependencies [ccbc3a4]
  - @getmunin/ui@4.56.0
  - @getmunin/types@4.56.0

## 4.55.0

### Minor Changes

- e64b320: The setup/onboarding gate now treats an org as configured when the agent has a usable provider — not only when an org-level API key is set. `/v1/agent-config` exposes `providerConfigured` (`providerApiKeySet` OR a host-supplied `defaultProviderAvailable`), and `AgentHostModule.forRoot`/`forRootAsync` accept a `defaultProviderAvailable` flag. Hosts that supply a default provider can let key-less orgs finish onboarding and reach the dashboard; self-hosted setups (no flag) are unchanged.

### Patch Changes

- @getmunin/types@4.55.0
- @getmunin/ui@4.55.0

## 4.54.0

### Patch Changes

- @getmunin/types@4.54.0
- @getmunin/ui@4.54.0

## 4.53.0

### Minor Changes

- c3a62e1: Add host extensibility hooks for the agent runner and provider configuration:
  - Rate-limit counters can be incremented by an arbitrary amount (`record(bucket, amount)`); add monthly `ai_tokens` and per-minute `ai_generates` buckets.
  - The usage summary (`/v1/usage/summary`) reports monthly AI token usage, surfaced as a tile on the usage and overview pages.
  - Agent passes can report a `quota_exceeded` skip outcome.
  - The agent host accepts an optional provider factory, credential resolver, and pre-generate gate via `runnerOptions`. The gate is consulted for both live chat and scheduled background work (distinguished by a `trigger` argument), so a host can supply its own provider implementation and meter or limit usage per org without forking the runner.
  - The provider picker accepts host-supplied presets — including a credential-less "managed" preset that renders host content and clears the org key on selection — plus a default selection. The AI settings and usage pages accept an optional content slot.

- 82fef68: Redesign the onboarding "Lift-off" summary's website-import section into three real states — importing, failed, and succeeded — driven by live crawl progress.

  The web crawler now emits incremental progress (`{ total, done, recentPaths }`) as it reads pages; the runner persists it to a new nullable `curator_jobs.progress` column (throttled, best-effort), and the curator-job DTO surfaces it via `GET /v1/curator/jobs/:id`. The summary screen polls that to show a live `done / total` counter, a progress bar, and the paths being read while importing; the imported page count and duration on success; and the failure reason plus an inline **Retry import** on failure. A new internal `POST /v1/curator/jobs/:id/progress` endpoint backs the out-of-process runner path.

  Also align the full-screen loading screens with the page background: `AuthLoading` (and the root route loader) now paint `bg-bone` so the loader no longer flashes the lighter paper surface before the bone-backed page resolves.

### Patch Changes

- 1e51d24: Give the settings shell's full-screen loading spinner the same `bg-bone dark:bg-background` backdrop as the dashboard and onboarding spinners, so initial loads no longer flash a mismatched background.
- a8f1469: Rename the "Page views" nav label and section eyebrow to "Trackers" (nb: "Målepunkter") to match the section header and actions, and reword the subtitle to lead with the action.
- Updated dependencies [95f2983]
- Updated dependencies [82fef68]
  - @getmunin/types@4.53.0
  - @getmunin/ui@4.53.0

## 4.52.1

### Patch Changes

- @getmunin/types@4.52.1
- @getmunin/ui@4.52.1

## 4.52.0

### Minor Changes

- e0a87c0: Replace the one-way data export with bidirectional per-module import/export.

  Removes the dashboard "Data export" page and `GET /v1/export`. Adds symmetric
  `*_export` / `*_import` MCP tools and `/v1/<module>/export|import` REST endpoints
  for KB, CRM, CMS, Conversations, Outreach, and Analytics so an agent can move an org's data
  between a self-hosted server and the cloud in either direction. Imports upsert by
  natural key where one exists and return an `idMap` for foreign-key remapping;
  embeddings are regenerated on import; secrets are redacted and re-entered on the
  target; CMS asset bytes are copied to the target's storage. Adds
  `skill://playbooks/data-migration`.

### Patch Changes

- @getmunin/types@4.52.0
- @getmunin/ui@4.52.0

## 4.51.4

### Patch Changes

- @getmunin/types@4.51.4
- @getmunin/ui@4.51.4

## 4.51.3

### Patch Changes

- be9e0b3: Rename the analytics section label to be more concrete and natural. The nav item and section eyebrow change from "Analysesporing" to "Sidevisninger" (Norwegian) and from "Analytics trackers" to "Page views" (English), matching the existing "page-view analytics" subtitle. The individual-item term ("Målepunkter" / "Trackers") is unchanged.
- 139d00e: feat(channels): pick voice options from a dropdown, discover them over MCP, and dedup the Threll webhook

  Setting up a voice channel no longer makes you hand-type opaque ids. For Threll you now enter just the API key and press Continue — the account is resolved from the key (via `GET /v1/accounts/current`, since a key maps 1:1 to an account) and the dialog fetches that account's workers into a dropdown; nothing is persisted until you pick a worker and confirm, so cancelling leaves no channel and no webhook subscription behind. Vapi follows the same two-step shape: enter the API key (and optional public key / phone number id), press Continue, then pick the assistant from a dropdown — no more hand-typed assistant id. Edit dialogs load the same dropdowns from the channel's stored credentials.

  The Threll account ID is no longer required input anywhere (MCP `conv_configure_channel` / control-plane / dashboard) — it's derived from the key when omitted (still accepted as an optional override, and re-derived if the API key is rotated on edit). It's still persisted and shown as a chip on the channel row.

  Option discovery is exposed generically so agents get parity with the dashboard: a new `conv_list_channel_options` MCP tool returns a vendor's selectable options (Threll `workers`, Vapi `assistants`) as `{ value, label, hint }` groups — pass `vendor` + credentials before the channel exists, or `channelId` for an existing one. Adding discovery for a new vendor is just a `listOptions` method on its `ChannelAdminProvider`. The control plane exposes the same via `POST /v1/conversations/channels/options` and `POST /v1/conversations/channels/:id/options`.

  Threll webhook auto-setup now lists the account's existing subscriptions and reuses a matching one's signing secret instead of blindly creating another. The post-setup "webhook URL" screen is gone — Munin registers the webhook with Threll automatically.

  Vapi now auto-configures its webhook too: on create, Munin points the chosen assistant's `server` at the channel's webhook URL (with the shared-secret header) — but only when that server is unset or already a Munin URL, so it never clobbers an assistant you've wired elsewhere (in which case it falls back to the manual connection screen). The prior server config is stashed and restored when the channel is archived, via a new best-effort `onArchive` provider hook.

  When auto-setup would collide with an existing webhook, Munin now asks instead of failing. Threll rejects a second account-wide `*` subscription, and Vapi's server URL may already point elsewhere — in both cases setup now returns a `409 webhook_conflict` and the dashboard shows a "Replace existing webhook?" confirm. Confirming retries with `replaceWebhook: true` (Threll deletes the conflicting subscription and registers its own; Vapi overwrites the assistant's server URL); cancelling goes back with nothing changed. The flag is exposed on `conv_configure_channel` too, so agents can resolve the conflict the same way.

  Internal: the Threll and Vapi HTTP clients now route every call through one `request` helper that centralizes auth headers, timeouts, and status→error mapping; the dashboard `ApiError` now surfaces the response `code` so callers can branch on `webhook_conflict`.

- Updated dependencies [139d00e]
  - @getmunin/types@4.51.3
  - @getmunin/ui@4.51.3

## 4.51.2

### Patch Changes

- @getmunin/types@4.51.2
- @getmunin/ui@4.51.2

## 4.51.1

### Patch Changes

- 7744261: Render markdown in the dashboard conversation drawer. Message bubbles, internal notes, and the agent draft preview now render bold, italics, lists, links, code, and rules instead of showing raw markdown source — matching how the chat widget displays the same content.
- 1ee9d7f: Split the 1.7k-line `inbox-sections.tsx` into focused modules (`inbox-types`, `inbox-helpers`, `inbox-data` hook, `inbox-message-bubble`, `inbox-activity-rail`, `inbox-conv-drawers`), with `inbox-sections` retained as the section/list components plus a re-export of the public API. Pure refactor — no behavior change.
  - @getmunin/types@4.51.1
  - @getmunin/ui@4.51.1

## 4.51.0

### Patch Changes

- @getmunin/types@4.51.0
- @getmunin/ui@4.51.0

## 4.50.1

### Patch Changes

- @getmunin/types@4.50.1
- @getmunin/ui@4.50.1

## 4.50.0

### Minor Changes

- 3f034de: Auto-provision the Threll webhook subscription when creating a Threll voice channel.

  Munin now uses the Threll API key to register the webhook subscription with Threll (`POST /accounts/{accountId}/webhook-subscriptions`, `eventType: "*"`) and stores the signing secret Threll returns — the admin no longer generates a secret and pastes it into Threll. Provisioning happens atomically during channel create: the channel id is minted up front and the Threll call runs before the row is inserted, so if provisioning fails nothing is persisted and the dashboard shows a retry-only error. The webhook URL is built from the canonical server-side API base (`readApiBaseUrl()` / `MUNIN_API_URL`). The webhook signing secret is now Threll-owned and immutable, so the manual webhook-secret field is removed from the Threll create and edit dialogs. `ConfigureThrellBody` and the Threll MCP configure tool no longer accept `webhookSecret` on create. The Vapi flow is unchanged.

### Patch Changes

- 3e3c76a: Polish channel and analytics UI in the dashboard.
  - Unify the SMS/voice vendor picker into a gapless segmented control matching the MCP client selector (no gaps between buttons).
  - Make Threll the first voice provider and the default selection when the add-voice dialog opens; display it as "Threll.ai".
  - Improve the Norwegian analytics-tracker terminology: "Analytikk-sporere"/"Sporere" become "Analysesporing"/"Målepunkter", and "Sporenøkkel" becomes "Sporingsnøkkel".

- Updated dependencies [3f034de]
  - @getmunin/types@4.50.0
  - @getmunin/ui@4.50.0

## 4.49.0

### Patch Changes

- 5c7ef9c: Fix the CMS and KB queue drawers hanging on "Loading…" when their detail fetch fails. Previously a failed `/v1/cms/drafts/:id` or `/v1/kb/curation/candidates/:id` request (e.g. a 404) was swallowed, leaving the drawer stuck on the loading text indefinitely with the approve/dismiss actions still clickable.
  - Surface detail-fetch errors instead of swallowing them, keyed per queue item.
  - Replace the inline "Loading…" text box with a centered spinner in the middle of the drawer.
  - Show a centered error message with a retry button when the detail fails to load.
  - Disable the approve/dismiss/edit/schedule actions (and the ⌘↵ shortcut) while the detail is loading or errored.

- d5d03e9: Fix Norwegian (nb) localization terminology. "credentials" was translated as "legitimasjon" (an ID document) across the dashboard — now uses "påloggingsinformasjon". Also corrected two related strings: the audit-log subtitle's "Vedheft-bare" ("attach-only") → "kun-tillegg" for "append-only", and the tracker origins hints' "skjema" → "scheme" for URL scheme, matching the channels module.
  - @getmunin/types@4.49.0
  - @getmunin/ui@4.49.0

## 4.48.0

### Patch Changes

- fdf2e9c: Fix misaligned usage-KPI sparklines on the dashboard. Three causes were making the four cards' sparklines sit at inconsistent vertical positions:
  - **Stroke clipping** — the polyline mapped values to the full `0–22` viewBox height, so the 1.2px stroke was sliced in half at peaks and troughs. Values now inset into a `2–20` band so the line never touches the edges.
  - **Floating flat lines** — a constant series (`max === min`) no longer floats at an arbitrary height; it rests on the baseline like every other card's minimum.
  - **Collapsing delta row** — a tile with no comparison (e.g. API calls, whose previous period is 0) rendered an empty space that HTML collapsed to zero height, shifting its sparkline up by one line. The placeholder is now a non-breaking space so the row keeps its height.

- Updated dependencies [dc70c67]
  - @getmunin/types@4.48.0
  - @getmunin/ui@4.48.0

## 4.47.0

### Patch Changes

- 461a7fc: Align the dashboard "agent recipes" starter list with the recipe guides shipped in `@getmunin/docs-pages`. The panel had drifted: it still listed **Content Marketer** (renamed to Conversation Distiller), **CRM Deduper**, and **KB Curator** (both dropped — the built-in curator now runs `skill://crm/clean-contact-data` and `skill://kb/review-content` automatically), and their "view prompt" links pointed at guide slugs that no longer exist (404).

  Replaces those with current recipes (Lead Research, Lead Scoring, Conversation Distiller) alongside the still-valid Bug Triage, Renewal Watch, and SDR — keeping the list at 6, every `id` now resolving to a real `recipe-*` guide, and tool chips using current MCP tool names.

- 4b889cf: Rename MCP tools for naming consistency. The dominant convention is `<module>_<verb>_<object>`; these tools deviated and have been renamed:
  - `crm_propose_merge_candidate` → `crm_propose_merge` (the other merge tools all say "proposal", not "candidate")
  - conv channel admin (verb/object order): `conv_channel_configure` → `conv_configure_channel`, `conv_channel_test` → `conv_test_channel`, `conv_channel_send_test` → `conv_send_channel_test`
  - conv email: `conv_email_setup_channel` → `conv_setup_email_channel`, `conv_email_test_channel` → `conv_test_email_channel`, `conv_email_send_test` → `conv_send_email_test`
  - voice ("call", not voice/phone split): `conv_voice_call` → `conv_call_channel`, `conv_voice_call_contact` → `conv_call_contact`
  - end-user self-service (drop awkward possessive/suffix): `crm_log_activity_self` → `crm_log_my_activity`, `conv_request_handover_in_my_conversation` → `conv_request_human`, `conv_request_phone_call_for_my_conversation` → `conv_request_callback`
  - analytics report tools (add the verb the rest of the surface uses): `analytics_top_subjects` → `analytics_list_top_subjects`, `analytics_top_countries` → `analytics_list_top_countries`, `analytics_traffic_by_source` → `analytics_get_traffic_by_source`, `analytics_referrer_hosts` → `analytics_list_referrer_hosts`, `analytics_views_over_time` → `analytics_get_views_over_time`, `analytics_subject_engagement` → `analytics_get_subject_engagement`, `analytics_contact_journey` → `analytics_get_contact_journey`, `analytics_zero_result_searches` → `analytics_list_zero_result_searches`

  Breaking for MCP clients pinned to the old tool names.

- 448953f: Rename REST control-plane routes for naming consistency, following the same
  `<module>/<resource>` + spelled-out-verb conventions used across the rest of the `/v1` surface:
  - `v1/cms-drafts/*` → `v1/cms/drafts/*` (nest under the module like `crm/segments`, `kb/spaces`)
  - `v1/curation/jobs/*` → `v1/curator/jobs/*` (match the module name; frees "curation" to mean only the KB-nested qualifier)
  - `v1/curator/jobs/:id/ack` → `:id/acknowledge` (match `system/alerts/:id/acknowledge`; no more clipped verb)
  - `v1/admin/audit-logs` → `v1/audit-logs` (drop the lone `admin/` tier — every other admin resource sits directly under `v1/`)
  - feedback "reject" → "dismiss" to match the proposal-queue convention (`dismiss` everywhere else): REST `v1/feedback/:id/reject` → `:id/dismiss`, **and** the MCP tool `feedback_reject` → `feedback_dismiss`.

  The two controllers that both mounted `v1/usage` are merged into a single `UsageController`
  (routes unchanged — non-breaking).

  Breaking for REST clients pinned to the old paths and MCP clients pinned to `feedback_reject`.
  No deprecation aliases.
  - @getmunin/types@4.47.0
  - @getmunin/ui@4.47.0

## 4.46.0

### Patch Changes

- 32c883e: Log previously swallowed errors in widget realtime, dashboard, and voice session paths. Empty `catch {}` blocks now emit `console.warn` for socket lifecycle/fetch failures and `console.debug` for listener-loop exceptions so issues surface during debugging instead of disappearing.
  - @getmunin/types@4.46.0
  - @getmunin/ui@4.46.0

## 4.45.1

### Patch Changes

- f1b4446: Surface the backend's 4xx error message in the dashboard's `SaveErrorStage` instead of always rendering the generic "couldn't reach the server" copy. The shared dialog was discarding `ApiError.message` even when the server returned an actionable validation error. `SaveErrorDetail` now carries an optional `message`, and the channel and tracker save flows populate it from the parsed server body for 4xx responses (5xx and network errors keep the original "try again" copy).

  Also stops the widget channel create form from POSTing with an empty origin allowlist when the deployment requires one. Set `NEXT_PUBLIC_WIDGET_REQUIRE_ALLOWLIST=1` on the dashboard to mirror the existing backend `MUNIN_WIDGET_REQUIRE_ALLOWLIST` and the form will show an inline "at least one origin required" error before submit.
  - @getmunin/types@4.45.1
  - @getmunin/ui@4.45.1

## 4.45.0

### Patch Changes

- @getmunin/types@4.45.0
- @getmunin/ui@4.45.0

## 4.44.1

### Patch Changes

- @getmunin/types@4.44.1
- @getmunin/ui@4.44.1

## 4.44.0

### Minor Changes

- bb38781: Route incomplete-setup users through onboarding before the OAuth consent page.

  If an owner/admin with an unconfigured org (no provider API key, or empty org name) hit the OAuth authorize flow — e.g. adding the Munin MCP to an AI agent — they landed directly on `/dashboard/oauth/consent` and could grant access before completing onboarding. New accounts created during the OAuth flow already get routed through `/setup?<oauth_params>` from the signup form, then back to consent once `useSetupGate` clears; existing accounts with incomplete orgs skipped that step entirely because the consent page is exempted from `useDashboardGate`.

  Adds a server-side gate (`redirectIfSetupIncomplete`) used by `apps/web/app/[locale]/dashboard/oauth/consent/page.tsx`. The Server Component forwards the session cookie to `/v1/agent-config` and `/v1/me/memberships`, and when setup is incomplete for an owner/admin it `redirect()`s to `/setup?<oauth_params>` before any consent HTML is sent. Once setup completes, `useSetupGate` already routes back to `/dashboard/oauth/consent?<oauth_params>`, so the consent UI shows on the next pass.

- 70d50ed: Add tracker key rotation for analytics trackers.

  Settings → Channels has long exposed a "Rotate key" action that revokes the active `mn_widget_*` key and mints a fresh one. Settings → Analytics trackers had no equivalent — only the identity-verification secret could be rotated, leaving operators stuck with `analytics_revoke_tracker` + `analytics_create_tracker` (which loses the tracker's name and config) if a `mn_track_*` key leaked.

  Adds the missing symmetric action:
  - New `analytics_rotate_tracker_key` MCP tool that revokes the tracker's active `mn_track_*` keys and mints a fresh one.
  - New `POST /v1/analytics/trackers/:id/rotate-key` endpoint.
  - Dashboard now shows "Rotate tracker key" above "Rotate identity secret" on each tracker row, with a one-time copy dialog matching the channels flow.

### Patch Changes

- @getmunin/types@4.44.0
- @getmunin/ui@4.44.0

## 4.43.2

### Patch Changes

- ff825e8: Fix prerender failure on `/setup` (round 2).

  `useSetupGate` called `useSearchParams()` at the top level to detect a resumed OAuth-authorize flow. Even though consumers render the gate via a one-line `'use client'` page, that hook still triggers Next.js's SSG bailout — the wrapped `<Suspense>` around the wizard's `ReadyCard` (from 4.43.1) doesn't help because the gate runs before the wizard mounts.

  Since the params are only read inside a `useEffect` (for navigation side effects), there's no need to subscribe to a reactive hook. Read `window.location.search` lazily inside the effect instead, removing the SSG bailout from the gate entirely.
  - @getmunin/types@4.43.2
  - @getmunin/ui@4.43.2

## 4.43.1

### Patch Changes

- 85245b2: Fix prerender failure in consumer apps that statically render `/setup`.

  `AgentSetupWizard`'s `ReadyCard` calls `useSearchParams()` to detect a resumed OAuth-authorize flow. In Next.js 16, that hook bails out of SSG and requires a `<Suspense>` boundary; without one, consumers that prerender the wizard page fail their build with `useSearchParams() should be wrapped in a suspense boundary`.

  The OSS test app (`apps/web`) hides this by setting `export const dynamic = 'force-dynamic'` in `[locale]/layout.tsx`, so it never exercises the SSG path. Consumer apps that don't opt out of static rendering hit the failure as soon as they upgrade to the version where `useSearchParams` was introduced.

  Wrap the `ReadyCard` instance in a `<Suspense fallback={null}>` so the wizard works regardless of the consumer's static/dynamic configuration.
  - @getmunin/types@4.43.1
  - @getmunin/ui@4.43.1

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

### Patch Changes

- f470743: Send the email verification callback to the web app's `/verify-email` page instead of leaving it relative to the API host (where it 404'd).
- de6865f: Fix the default OpenRouter provider base URL — was `https://openrouter.ai/v1`, should be `https://openrouter.ai/api/v1`.

  `PerOrgConfigRepository` materialized new `agent_config` rows with the wrong host, so hitting `/models` returned OpenRouter's marketing HTML page and `AgentModelsService` choked when parsing it. Same typo in the dashboard's `PROVIDER_PRESETS` and in two `shouldEnablePromptCache` test fixtures.

  Existing rows already persisted with the wrong URL are backfilled by an idempotent `UPDATE` inside `AGENT_HOST_MULTI_TENANT_DDL` (multi-tenant only — the OSS singleton DDL defaults to Anthropic).

- b8119f3: Onboarding wizard: drop the "Customize chatbot" / "Tweak settings" buttons from the lift-off card; keep only "Go to dashboard" + "Back". When the user arrived through an OAuth authorize flow (e.g. signing up via an MCP client), preserve OAuth params through the signup → setup chain and replace "Go to dashboard" with a "Continue" button that lands on the OAuth consent page.
- Updated dependencies [3858d3e]
  - @getmunin/types@4.43.0
  - @getmunin/ui@4.43.0

## 4.42.0

### Patch Changes

- @getmunin/types@4.42.0
- @getmunin/ui@4.42.0

## 4.41.1

### Patch Changes

- @getmunin/types@4.41.1
- @getmunin/ui@4.41.1

## 4.41.0

### Patch Changes

- @getmunin/types@4.41.0
- @getmunin/ui@4.41.0

## 4.40.4

### Patch Changes

- @getmunin/types@4.40.4
- @getmunin/ui@4.40.4

## 4.40.3

### Patch Changes

- @getmunin/types@4.40.3
- @getmunin/ui@4.40.3

## 4.40.2

### Patch Changes

- cdb5793: OAuth consent + auth-shell mobile polish:
  - OAuth consent page now uses the dashboard's 0.5px hairline convention (`border-[0.5px]` + `dark:border-rule-on-dark`) on the section card, identity row, avatar tile, trust timeline, permission rows, scope pills, reassurance block, buttons, and result-pane status circle.
  - Long client IDs no longer overflow: the H1, lede paragraphs, identity-card display name, trust-timeline body, reassurance block, and result-pane panel get `[overflow-wrap:anywhere]` (and `min-w-0 [word-break:break-word]` on the 72px H1 so single unbreakable client IDs wrap inside the 720px column).
  - Auth-shell submit buttons (`AuthSubmit` + the inline `Link` CTAs on verify-email and reset-password success states) render their hairline via `shadow-[inset_0_0_0_0.5px_…]` instead of `border-[0.5px]`, matching the shared `@getmunin/ui` Button pattern — fixes iOS Safari dropping border edges on the ghost "Resend link" button.
  - @getmunin/types@4.40.2
  - @getmunin/ui@4.40.2

## 4.40.1

### Patch Changes

- 328cae6: OAuth consent identity card polish: the icon container now has a white background with the favicon inset (h-9 w-9 inside the 50×50 frame) so vendor logos sit on a neutral surface with breathing room, instead of bleeding to the dark edge. Tightened the gap between the client name and the "Registered …" line. Reassurance footer now links to **Settings → Agents** (`/dashboard/settings/agents`) — the actual revocation surface — instead of the stale "Connected Apps" label and path.
  - @getmunin/types@4.40.1
  - @getmunin/ui@4.40.1

## 4.40.0

### Minor Changes

- f8e82f2: OAuth consent page redesigned end-to-end. Three concrete changes:
  1. **Backend — enriched client lookup.** `GET /v1/oauth/clients/:id` now returns `{ client_id, name, uri, icon_url, redirect_uri_host, created_at }`. `name` falls back to a host-derived label when the client's DCR didn't include `client_name` (well-known hosts like `claude.ai`/`chatgpt.com`/`cursor.sh` get a branded label; anything else falls back to the bare host). `redirect_uri_host` is the host portion of the first registered redirect URI — the full URI stays off the wire.
  2. **Backend — favicon proxy.** New `GET /v1/oauth/clients/:id/icon` route. Server-side fetches `oauth_client.icon` if present, otherwise `https://<redirect_uri_host>/favicon.ico` using `safeFetch` (SSRF-guarded). Validates MIME (`image/*` only), caps response size, falls back to a generic SVG on any failure. Served from our origin with a 24h browser cache — keeps the user's IP off third-party hosts pre-authorization.
  3. **Frontend — SSR refactor + new layout.** The page is now an async server component (`apps/web/.../consent/page.tsx`) that fetches the enriched client info before render. The fixed CORS bug along the way: cookies are no longer sent on the lookup (closes the `Access-Control-Allow-Credentials` failure path that was leaving the page stuck on the raw `client_id`). New three-state machine (`new` / `granted` / `denied`) with intermediate result panes — instead of redirecting immediately on Authorize/Deny, the page shows a brief "Access granted/denied · Returning to claude.ai…" panel with spinner, then redirects. Layout matches the editorial design: serif headline that shifts copy per state, identity card with app icon, trust-timeline strip, grouped per-module permissions with `Read`/`Write` pills, reassurance block, and an actions footer.

  Also adds an `anonymous: true` opt-out on the `api()` helper for callers of `@PublicController` endpoints that shouldn't send the BetterAuth session cookie.

  i18n strings in `en.json` and `nb.json` updated to match the new copy; the keys are different from before (`title`, `lede`, `scopesLabel`, etc. reshaped — see the keys under `dashboard.oauthConsent`).

### Patch Changes

- @getmunin/types@4.40.0
- @getmunin/ui@4.40.0

## 4.39.0

### Patch Changes

- @getmunin/types@4.39.0
- @getmunin/ui@4.39.0

## 4.38.0

### Patch Changes

- @getmunin/types@4.38.0
- @getmunin/ui@4.38.0

## 4.37.0

### Patch Changes

- @getmunin/types@4.37.0
- @getmunin/ui@4.37.0

## 4.36.0

### Patch Changes

- @getmunin/types@4.36.0
- @getmunin/ui@4.36.0

## 4.35.0

### Patch Changes

- @getmunin/types@4.35.0
- @getmunin/ui@4.35.0

## 4.34.0

### Patch Changes

- @getmunin/types@4.34.0
- @getmunin/ui@4.34.0

## 4.33.0

### Minor Changes

- 9042f0e: Schema-driven CMS draft drawer + safeFetch streaming fix.

  **`@getmunin/core` — `safeFetch` body-stream lifecycle fix.** The undici agent was closed in a `finally` block as soon as `safeFetch` returned, so any response body larger than the initial socket receive buffer got cut off mid-stream and the body reader hung until the caller's `AbortSignal.timeout` fired. `safeFetch` now hands the agent's lifetime over to the response body via a `ReadableStream` wrapper that closes the agent on stream end, error, or cancel; small bodies and redirect/error paths still close immediately. New regression test exercises a 2 MB payload flushed in two halves with a 50 ms gap so this class of bug can't sneak back in. As part of the cleanup the same module dropped two silent `catch (() => {})` swallows in favour of `console.warn`, and the redirect/agent-cleanup logic was DRYed up.

  **`@getmunin/backend-core` — CMS draft + asset endpoints.**
  - `GET` and `PATCH /v1/cms-drafts/:id` now return `CmsDraftDetailDto extends EntryDto { fields: FieldDef[] }` so the dashboard always has the collection schema in hand.
  - New `POST /v1/cms-drafts/:id/assets` uploads an asset (`{ name, mime, base64Body, altText? }` JSON) and returns the `AssetDto`. It does not touch the entry — the dashboard stages the new asset locally and commits it on Save.
  - `CmsService.updateEntry` now runs `expandAssetsInDtos` before returning, so the PATCH response carries fully-expanded asset objects (previously the bare id string).
  - `CmsService.listDraftEntries` derives a fallback `title` (and exposes `titleFieldName`) via `title → name → headline → subject → first required text field → slug`, so collections without a hardcoded `title` field still surface a sensible header.
  - `validateEntryData` treats `""` / `[]` as "not present" for required-field purposes — previously a required text field with empty string passed validation.
  - `CmsInvalidError` carries structured `fieldErrors`, and the controller surfaces them as `{ message, fieldErrors: [{ field, message }] }` on 400 responses so the dashboard can highlight the offending field instead of dropping a toast.
  - `cms_create_collection` / `cms_update_collection` MCP descriptions now spell out that `fields` is an **ordered** array — order = render order in editor and public surfaces — and that `cms_update_collection` REPLACES the existing array.

  **`@getmunin/dashboard-pages` — schema-driven CMS draft drawer.**
  - Replaced the body-only editor with a per-field editor driven by `detail.fields`. Editors per type: `text` → input, `markdown` / `rich_text` → textarea (markdown is multi-row), `integer` / `number` → number input, `boolean` → checkbox, `select` → dropdown of `options.choices`, `date` / `datetime` → matching inputs, `asset` → drop-zone with click-to-pick, drag-and-drop, in-place replace, and uploading state.
  - Read-mode renders each field in a consistent `ValueBox` (matches body's existing border treatment); markdown via `ReactMarkdown`; assets as a 16:9 figure. Empty optional fields are hidden in read mode; the field whose name matches `titleFieldName` is also hidden (drawer header already shows it).
  - Save sends only the diffed fields as a single `PATCH /v1/cms-drafts/:id` with `{ data: ... }`. Asset fields serialize back to their id string.
  - Backend `fieldErrors` surface inline: red label + destructive border + `aria-invalid` + a `role="alert"` message under each editor (no more "validation failed: x" toast).
  - Asset drop-zone now reveals its "Replace cover image" label on hover with a paper-tinted overlay, instead of always overlaying text on the image.
  - Drawer header close button gets `shrink-0 whitespace-nowrap` so "close ×" stays inline next to long wrapping titles.
  - Inbox drawer reads its queue item from the live queue (by id) instead of holding a snapshot, so post-save header refreshes are visible.
  - New `ApiError.fieldErrors` carries structured field errors through the fetch helper. Unused i18n keys (`cmsBody`, `cmsBodyPlaceholder`, `cmsCoverImage`, `cmsCoverEmpty`) removed.

### Patch Changes

- 3c83ffe: Dashboard polish: four small bug fixes.
  - **`LoadFailed` red dot was invisible.** The eyebrow dot's class string was a concatenation typo (`bg-alert-bad-border-[0.5px]` — `bg-alert-bad-border` ran into a stray `border-[0.5px]`), so the dot rendered without a background colour. Fixed to `bg-alert-bad-border animate-pulse` to match the live-state dot pattern used elsewhere.
  - **`AuthForm` invalid border was invisible.** Same concatenation typo (`border-alert-bad-border-[0.5px]`) meant invalid inputs in the auth flow didn't actually get a red border. Now uses `border-alert-bad-border` (with the border-width already declared on the base class).
  - **Inbox `LoadFailed` no longer hugs the top-left.** When the overview can't load, the error card now sits in a `flex min-h-[70vh] items-center justify-center` wrapper so it's centred both horizontally and vertically.
  - **`SystemAlertsBanner` no longer flickers on transient reconnects.** A short WS blip used to flash the yellow "Connection lost. Reconnecting…" banner. The component now debounces the disconnected state by 1.5 s — if the socket reconnects within that window, the banner never shows; it still hides immediately on reconnect.
  - @getmunin/types@4.33.0
  - @getmunin/ui@4.33.0

## 4.32.0

### Minor Changes

- bd8cd79: Surface CMS draft entries in the dashboard approval queue. Adds `CmsService.listDraftEntries` + `archiveEntry`, a new `/v1/cms/drafts/*` control endpoint family for approve/schedule/dismiss/patch, and a dedicated CMS drawer with metadata grid, cover-image preview, inline body editor, and a schedule popover. The shared `QueueDrawer` is also split into per-kind files (`queue-drawers/{kb,crm,outreach,feedback,cms}.tsx`) backed by a small dispatcher so adding the next kind is a new file rather than another branch.

### Patch Changes

- f6cb178: Dashboard overview: the Live Now section's tinted background now spans the full page width instead of stopping at the page's `max-w-7xl` content cap. The section uses a full-bleed `w-screen` breakout and keeps inner content aligned via an inner `max-w-7xl` container. The dashboard shell `<main>` gets `overflow-x-clip` so the breakout can't introduce a horizontal scrollbar on browsers that reserve space for the vertical scrollbar.
- f6cb178: Inputs and dashboard reply/edit textareas now render at `text-base` (16px) on mobile and `md:text-sm` (14px) from the `md` breakpoint up. iOS Safari auto-zooms on focus whenever the focused field's effective font-size is below 16px; bumping mobile sizes avoids that without disabling viewport zoom (which is a WCAG 1.4.4 regression). Desktop density is unchanged.
- Updated dependencies [bd8cd79]
- Updated dependencies [f6cb178]
- Updated dependencies [03d62af]
  - @getmunin/ui@4.32.0
  - @getmunin/types@4.32.0

## 4.31.0

### Patch Changes

- @getmunin/types@4.31.0
- @getmunin/ui@4.31.0

## 4.30.0

### Minor Changes

- 56c588c: Auth pages now redirect already-signed-in users away from `/login` and `/signup` on the server, before any UI renders. Adds a new `@getmunin/dashboard-pages/server` subpath export with `getServerSession()` and `redirectIfAuthenticated({ locale, redirectParam })`, which forward the request cookies to the BetterAuth `/auth/get-session` endpoint and call the i18n-aware `redirect()` to `safeRedirect(redirectParam)` (defaults to `/dashboard`). The OSS `apps/web` login and signup pages adopt the helper. The server-only entry is kept off the main barrel export so client bundles aren't pulled into the `next/headers` graph.

### Patch Changes

- @getmunin/types@4.30.0
- @getmunin/ui@4.30.0

## 4.29.2

### Patch Changes

- 191a876: Auth-shell polish: nudged the logo to `left-8` on mobile (`md:left-14` from medium up) so it no longer clips into the left safe area on small screens, autoFocused the primary action on the forgot-password "sent", reset-password "done", and verify-email "done" success states so keyboard users land on the next step, restyled the reset/verify success CTAs to the ink/paper button treatment used elsewhere (dropping the legacy `auth-navy` token), and replaced the bordered info pill on the "email sent" state with a flat block that reads cleaner against the auth panel.
  - @getmunin/types@4.29.2
  - @getmunin/ui@4.29.2

## 4.29.1

### Patch Changes

- @getmunin/types@4.29.1
- @getmunin/ui@4.29.1

## 4.29.0

### Minor Changes

- bc0d601: Introduces `org_alerts`, a first-class operational alerts surface (new `system_alerts_*` MCP tools, `GET /v1/system/alerts`, `org_alert.opened|resolved|acknowledged` realtime events). LLM-provider and channel-inbound failure paths now write to alerts instead of dedicated `last_error` columns on `agent_health` / `conv_inbound_state`, which are dropped. The dashboard banner reads from the alerts feed and renders per-source CTAs.

  Auto-deactivates an inbound poll channel after 5 consecutive failures: `conv_channels.active` flips to `false` (so the worker stops hammering broken credentials), the existing alert metadata records `deactivatedAt` + `attemptCount`, and the channels settings page renders an `ACTIVATE` button. `POST /v1/conversations/channels/:id/activate` re-enables the channel and resolves the alert.

  Also fixes an `imapflow` crash loop in the email adapter: a late TLS socket error after `tick()` returned was emitted with no listener attached, terminating the Node process. The adapter now attaches an `error` listener at construction and tears down the client on `connect()` failure.

### Patch Changes

- @getmunin/types@4.29.0
- @getmunin/ui@4.29.0

## 4.28.0

### Patch Changes

- @getmunin/types@4.28.0
- @getmunin/ui@4.28.0

## 4.27.1

### Patch Changes

- cc3ac20: Fix two URL regressions in the dashboard.
  - **OAuth sign-in landed on the API host.** `LoginForm` and `SignupForm` were passing a path-only `callbackURL: '/dashboard'` to `authClient.signIn.social({ provider: ... })`. BetterAuth's backend resolves a relative callback against its own baseURL, so post-OAuth users were redirected to `<auth-host>/dashboard` (404) instead of the dashboard host they signed in from. Both forms now wrap `redirectTo` with `absoluteCallbackUrl(...)` so the value sent to the backend is fully qualified against `window.location.origin`.
  - **"View prompt" on the dashboard home pointed at the dashboard host.** The recipe links in `GetStarted` used a relative `href` of `/docs/guides/recipe-<id>`, which the browser resolved against the dashboard host instead of the docs host. They now prepend `process.env.NEXT_PUBLIC_DOCS_URL` (already read for the MCP-setup `docsHref`), matching how the MCP `docsHref` is constructed.

  Both regressions were latent until 4.25/4.26 (when the recipes moved to docs and the auth pages consolidated into this package); the first deploy of either path against a backend-on-a-different-host surfaced them.
  - @getmunin/types@4.27.1
  - @getmunin/ui@4.27.1

## 4.27.0

### Minor Changes

- b46a41c: Rename agent recipes to role/task-shaped names that match how teams already describe the work: Lead Enricher → **Lead Research**, Lead Scorer → **Lead Scoring**, Bug Spotter → **Bug Triage**, Renewal Watcher → **Renewal Watch**, Win-Back Agent → **Win-Back**, Outreach Drafter → **SDR**. Recipe slugs in `packages/docs-pages/src/guides/` follow (e.g. `recipe-bug-spotter` → `recipe-bug-triage`, `recipe-outreach-drafter` → `recipe-sdr`); `dashboard-pages` `RECIPES` data updated to match. Cloud-side dependants need a coordinated bump of `@getmunin/docs-pages` to pick up the new exports.

  Add two client guides: **Connect Hermes Agent** (Nous Research) and **Connect OpenClaw**, each with config snippets verified against the upstream MCP reference docs and the standard mint-key / verify / scope flow. Sort the Recipes and Clients categories alphabetically in `guidesByCategory()` so the sidebar and overview grid stay predictable as the library grows.

  Tighten cloud landing-page copy and tool chips to match the actual recipes: drop the non-existent `task://web/scrape-website` chip from Lead Research; fix Bug Triage's italic ("hiding in conversations", not "tickets") and body (filed as internal notes via `conv_send_message`, not "structured proposals"); soften Renewal Watch's body ("account signals" rather than a fabricated "usage + sentiment + open issues"); fill in tool chips that were omitted (Lead Scoring, Renewal Watch, Event Follow-up, SDR, Conversation Distiller).

  When the AI provider is unreachable on a brand-new conversation, the runtime now posts a generic hardcoded greeting (`"Hi, what can we do for you?"`) instead of escalating to a human — there is nothing for an operator to reply to before the visitor has said anything. The handover fallback path is unchanged for visitor replies: those still escalate with `"I'm having trouble responding right now. A teammate will follow up shortly."` (the trailing `"Thanks for your message —"` opener was dropped — the lead-in doesn't fit a turn where the visitor hasn't messaged us yet).

### Patch Changes

- @getmunin/types@4.27.0
- @getmunin/ui@4.27.0

## 4.26.0

### Patch Changes

- @getmunin/types@4.26.0
- @getmunin/ui@4.26.0

## 4.25.0

### Patch Changes

- @getmunin/types@4.25.0
- @getmunin/ui@4.25.0

## 4.24.3

### Patch Changes

- @getmunin/types@4.24.3
- @getmunin/ui@4.24.3

## 4.24.2

### Patch Changes

- 70a7388: fix(dashboard): keep agent-health banner at a stable 48px height across state changes, match topbar's mobile padding, and hide the CTA below `md` so the message text gets the freed width
  - @getmunin/types@4.24.2
  - @getmunin/ui@4.24.2

## 4.24.1

### Patch Changes

- @getmunin/types@4.24.1
- @getmunin/ui@4.24.1

## 4.24.0

### Minor Changes

- 20ab00c: Promote the auth pages — `LoginForm`, `SignupForm`, `ForgotPasswordPage`, `ResetPasswordPage`, `VerifyEmailPage`, and `AuthLoading` — into `@getmunin/dashboard-pages` so OSS and cloud can share one implementation. Each accepts the brand footer as a prop (`OSS_AUTH_FOOTER` or `CLOUD_AUTH_FOOTER`); the signup form keeps OSS's invite-token lookup and gains OAuth provider buttons; the login form keeps `redirectTo` handling and moves the forgot-password link into the footnote next to "Create an account" (shortened from "Forgot your password?" to "Forgot password?"). The shared `useTranslateError` (and the pure `translateError` / `getErrorCode` helpers) are now re-exported from the package root, replacing the per-app duplicates.

### Patch Changes

- cb596ae: Stop the agent-health banner from pushing the settings-page Sign out button below the viewport. The banner now sticks to viewport top alongside the topbar, has a fixed `h-12` (with `truncate` on the message so long provider-error reasons ellipsize instead of wrapping), and exposes its presence via a stable `.agent-banner` marker class that downstream layout reads with Tailwind's `group-has-[]:` modifier. The `DashboardShell` wrapper gets a `group` class; both topbar variants and the settings sidebar shift down by exactly `3rem` (the banner height) only when the banner is rendered — no JavaScript measurement, no `ResizeObserver`, no CSS custom properties. Pure CSS, so the layout shift happens in the same paint that mounts the banner.
  - @getmunin/types@4.24.0
  - @getmunin/ui@4.24.0

## 4.23.5

### Patch Changes

- @getmunin/types@4.23.5
- @getmunin/ui@4.23.5

## 4.23.4

### Patch Changes

- 6dfabd2: Introduce `@getmunin/emails`: a shared React Email package that owns every transactional template Munin sends.
  - New templates (en + nb where applicable, all returning `{ subject, html, text }`):
    `renderResetPasswordEmail`, `renderVerifyEmail`, `renderDeleteAccountEmail`,
    `renderOrgInviteEmail`, `renderChannelTestEmail`, `renderPartnerClaimEmail`.
  - Org invite + channel-test now ship HTML alongside plaintext, matching the design system (serif heading, mono eyebrow, accent CTA, fallback URL block, footer attribution).
  - Org invite is now localized (en + nb) — was English-only. The "inviter name" prefix is rendered when the controller can resolve the inviting user.
  - `apps/backend/src/auth/email-templates.ts` deleted; OSS auth flow now calls into `@getmunin/emails`.
  - `MUNIN_EMAIL_LOGO_URL` env (optional) overrides the raven asset URL — useful for self-hosters that don't want the request to leave their network.
  - Self-host setting: BetterAuth's `sendResetPassword` and `sendVerificationEmail` hooks now produce HTML mail in addition to text.
  - OSS dashboard gains `(auth)/forgot-password` and `(auth)/reset-password` pages (ported from cloud) plus a `(auth)/verify-email` landing page; "Forgot your password?" link added under the login password field. `auth.forgotPassword`, `auth.resetPassword`, and `auth.verifyEmail` i18n keys added to `dashboard-pages/src/messages/{en,nb}.json`.
  - @getmunin/types@4.23.4
  - @getmunin/ui@4.23.4

## 4.23.3

### Patch Changes

- @getmunin/types@4.23.3
- @getmunin/ui@4.23.3

## 4.23.2

### Patch Changes

- f0e5389: Security: close widget→admin escalation, SSRF in website-import, upload signing weaknesses, and control-plane authorization gaps.
  - Public `mn_widget_*` keys now resolve as a new `widget_agent` actor (not `admin_agent`), with audience forced to `self_service` and scopes narrowed to `conv:widget:write`. New `ControlPlaneGuard` rejects widget/end-user/partner actors and scoped admin keys (must have `*`) on `/v1/*` admin routes, so embedded widget keys can no longer mint, list, or revoke admin API keys, configure channels, or enqueue curator jobs.
  - Website-import enqueue and the underlying crawler validate URLs against private/loopback/link-local/cloud-metadata ranges. A new `safeFetch` helper enforces an undici dispatcher that re-validates the resolved IP at connect time (DNS-rebinding-safe) and walks redirects manually.
  - Local-storage upload signing switched from plain SHA-256 to HMAC-SHA256; `LocalFsStorage` throws on startup if `MUNIN_STORAGE_LOCAL_SECRET` is missing under `NODE_ENV=production`. Static asset serving sets `X-Content-Type-Options: nosniff`.
  - S3 uploads switched from presigned PUT to presigned POST with a `content-length-range` policy condition pinned to the declared size, so an oversized body is rejected by S3 itself. `cms_complete_asset_upload` HEADs the object and rejects (deleting the storage object) on size mismatch. `AssetStorage.presignedUpload` now returns `{ uploadUrl, uploadMethod, uploadFields, … }`; `AssetStorage.statBytes` is now required on the interface.

- Updated dependencies [f0e5389]
  - @getmunin/types@4.23.2
  - @getmunin/ui@4.23.2

## 4.23.1

### Patch Changes

- @getmunin/types@4.23.1
- @getmunin/ui@4.23.1

## 4.23.0

### Patch Changes

- @getmunin/types@4.23.0
- @getmunin/ui@4.23.0

## 4.22.0

### Patch Changes

- 6b4276d: Extend the feedback MCP surface with global roadmap search and voting.
  - `feedback_search` queries the public Munin roadmap (`GET /v1/public/feedback`) so agents can find an existing item to vote on before filing a duplicate. Supports `q`, `appScope`, `status`, `sort` (`votes`|`recent`), and `limit` (≤100).
  - `feedback_vote` casts the instance's vote on a published item via the HMAC-signed `POST /v1/public/feedback/:id/vote` endpoint. Idempotent on `(feedbackId, instanceId)`; surfaces 404 (item missing or not public) and 429 (per-instance quota) as typed errors.
  - `FeedbackForwarder` keeps a single HTTP entry point for submit/search/vote; reuses the existing `munin-feedback-intake-v1` HMAC derivation so both directions share one key and constant.
  - OSS landing page gains a "Read the docs →" link under the Get started / Sign in buttons (en + nb).
  - @getmunin/types@4.22.0
  - @getmunin/ui@4.22.0

## 4.21.0

### Patch Changes

- @getmunin/types@4.21.0
- @getmunin/ui@4.21.0

## 4.20.0

### Minor Changes

- cedba8d: Adds an opt-in feedback module: OSS instances can collect feedback locally and, with an org admin's explicit approval, forward each item to `feedback.getmunin.com`. Gated by `MUNIN_FEEDBACK_ENABLED` (default `false`) — when disabled, no controllers, no MCP tools, no outbound code path is loaded.
  - `db`: new `feedback_outbox` table (org-scoped, RLS) for pending items and `system_config` for the deployment-wide `instance_id`. Drizzle migration `0032_feedback_outbox.sql`.
  - `backend-core`: `@Global() FeedbackModule` exposing `feedback_{create,list,get,approve,reject}` MCP tools and `POST /v1/feedback` + `/:id/{approve,reject}` REST routes. `InboxController` takes `@Optional() FeedbackService` so pending items appear inline in `GET /v1/inbox`'s queue when the module is loaded. Approval signs the outbound payload with `HMAC(instance_id, "munin-feedback-intake-v1")` so cloud can verify by re-deriving. Also renames `assistants.controller`'s `getOrCreate()` → `findOrCreateAssistant()` to match the dominant `findOrCreate*` convention.
  - `dashboard-pages`: extends `QueueItem` / `useQueueBuilder` / `QueueRow` / `QueueDrawer` with a `feedback` kind so pending items render in the unified inbox queue, with attribution copy disclosing data flow to Munin developers.
  - `ui`: new `feedback` tone variant on `Pill`.

- 75ad065: Add GitHub OAuth sign-in alongside Google and expose a public `/v1/auth/providers` endpoint so the login UI can show only the providers the deployment has actually configured.
  - `backend-core`: new `readGithubProviderFromEnv()` reading `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET`, and a new anonymous `AuthProvidersController` at `GET /v1/auth/providers` returning `{ google, github }` booleans.
  - `dashboard-pages`: split `use-auth-providers.tsx` into a `'use client'` hook module and a server-safe `fetch-auth-providers.ts` so server components (e.g. the OSS login page in Next 16) can call `fetchAuthProviders()` without tripping the RSC client-boundary check. Adds `GoogleLogo` / `GithubLogo` exports, `or` + `googleButton` / `githubButton` i18n strings (en + nb), and uppercases the first OSS auth footer item.

### Patch Changes

- Updated dependencies [cedba8d]
  - @getmunin/ui@4.20.0
  - @getmunin/types@4.20.0

## 4.19.4

### Patch Changes

- @getmunin/types@4.19.4
- @getmunin/ui@4.19.4

## 4.19.3

### Patch Changes

- @getmunin/types@4.19.3
- @getmunin/ui@4.19.3

## 4.19.2

### Patch Changes

- @getmunin/types@4.19.2
- @getmunin/ui@4.19.2

## 4.19.1

### Patch Changes

- @getmunin/types@4.19.1
- @getmunin/ui@4.19.1

## 4.19.0

### Minor Changes

- 0501880: Rename the Partner-access settings nav label key and adjust the MCP
  tool-name guard test.
  - `dashboard-pages`: `nav.partnerAccess` → `nav.partner` (en + nb). The
    cloud overlay now uses `labelKey: 'partner'` and a shorter "Partner"
    label, moved from the Workspace group to Access & integrations.
  - `backend-core`: the OSS MCP integration test's negative assertion is
    updated to `feedback_create` to match the cloud-feedback module's
    renamed tools (`suggestion_*` → `feedback_*`). OSS behavior is
    unchanged — the guard still verifies cloud-only tools don't leak.

  No production users yet, so no backwards-compat aliasing.

### Patch Changes

- @getmunin/types@4.19.0
- @getmunin/ui@4.19.0

## 4.18.0

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

- @getmunin/types@4.18.0
- @getmunin/ui@4.18.0

## 4.17.0

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

- Updated dependencies [f1cff47]
  - @getmunin/ui@4.17.0
  - @getmunin/types@4.17.0

## 4.16.0

### Patch Changes

- @getmunin/types@4.16.0
- @getmunin/ui@4.16.0

## 4.15.0

### Patch Changes

- @getmunin/types@4.15.0
- @getmunin/ui@4.15.0

## 4.14.0

### Minor Changes

- 1fe1031: Make public-facing URLs configurable instead of hardcoding `api.munin.eu` / `docs.getmunin.com`.
  - `packages/docs-pages/src/page.tsx` and `_components/rest-endpoint.tsx`: the example `curl` URL is built from `process.env.NEXT_PUBLIC_API_URL` (defaulting to `http://localhost:3001`), matching the existing pattern in `guides/chat-widget/page.tsx`.
  - `packages/backend-core/scripts/generate-openapi.ts`: the OpenAPI spec's `servers[0]` is built from `MUNIN_OPENAPI_SERVER_URL` / `MUNIN_OPENAPI_SERVER_DESCRIPTION` (defaulting to `http://localhost:3001` / `local dev`). Cloud deploys set these at build time to render docs against the right host.
  - `packages/dashboard-pages/src/data/mcp-setups.ts`: `buildMcpSetups` takes an optional second `docsHost` argument; `MCP_SETUPS` keeps using the cloud-prod default. `get-started.tsx` reads `process.env.NEXT_PUBLIC_DOCS_URL` so dev points at `docs.dev.getmunin.com` and prod at `docs.getmunin.com`.

  Brand-attribution links (`getmunin.com` in the chat-widget "Powered by" footer, the web-crawler User-Agent) stay hardcoded — they identify Munin itself, not the deployment.

### Patch Changes

- @getmunin/types@4.14.0
- @getmunin/ui@4.14.0

## 4.13.0

### Minor Changes

- 7977f92: Rename the env var `MUNIN_PUBLIC_URL` → `MUNIN_MCP_URL`.

  The old name didn't say what surface it pointed at; the new name is symmetric with `MUNIN_API_URL` and `MUNIN_WEB_URL` and reflects that the value is the canonical MCP resource URL (used by the JWT issuer, OAuth audience, bootstrap rewriter `→ /mcp`, RFC 9728 metadata, and the SMS/outreach webhook bases that piggyback on the backend's external host).

  **Breaking** — `process.env.MUNIN_PUBLIC_URL` is no longer read. Set `MUNIN_MCP_URL` instead. No backwards-compat alias (no production users yet). Internal constants `PUBLIC_URL_FALLBACK` and `DEFAULT_PUBLIC_URL` renamed to `MCP_URL_FALLBACK` / `DEFAULT_MCP_URL` for consistency.

  Cloud consumers should bump `@getmunin/*` and rename the env in their deployment config.

### Patch Changes

- @getmunin/types@4.13.0
- @getmunin/ui@4.13.0

## 4.12.0

### Patch Changes

- @getmunin/types@4.12.0
- @getmunin/ui@4.12.0

## 4.11.0

### Patch Changes

- @getmunin/types@4.11.0
- @getmunin/ui@4.11.0

## 4.10.0

### Patch Changes

- @getmunin/types@4.10.0
- @getmunin/ui@4.10.0

## 4.9.0

### Patch Changes

- 6cdc2fc: Expose `safeRedirect` and `resumeOauthAuthorizeUrl` from `@getmunin/dashboard-pages` so OSS and cloud auth pages can share the same post-sign-in redirect logic instead of each inlining a copy.

  `safeRedirect(raw, fallback?)` guards against open-redirects by only honoring same-origin paths (`/...`, not `//...`); defaults to `/dashboard`.

  `resumeOauthAuthorizeUrl(params)` returns the upstream `auth/oauth2/authorize` URL when the user landed on sign-in/sign-up while resuming an OAuth flow (i.e. `response_type=code` + `client_id` are present in the query), or `null` otherwise. Reads the API base from `NEXT_PUBLIC_API_URL`.
  - @getmunin/types@4.9.0
  - @getmunin/ui@4.9.0

## 4.8.0

### Patch Changes

- @getmunin/types@4.8.0
- @getmunin/ui@4.8.0

## 4.7.1

### Patch Changes

- @getmunin/types@4.7.1
- @getmunin/ui@4.7.1

## 4.7.0

### Patch Changes

- 5108510: `MUNIN_PUBLIC_URL` is now the **canonical MCP resource URL** verbatim — no implicit `/mcp` appending. Adds an optional `MUNIN_API_URL` for a canonical REST URL.

  **Backend (`@getmunin/backend-core`)**
  - `mcpResourceUrl()` returns `MUNIN_PUBLIC_URL` exactly. `authorizationServerUrl()` (and `readPublicBaseUrl()`) return its origin.
  - New `publicUrlRewriteMiddleware` maps the canonical external URLs onto the internal Nest mount points — `/mcp` for MCP, `/api/v1` for REST. So a deploy can advertise `https://mcp.example.com` (no path) and `https://api.example.com/v1` while every controller stays mounted at its original internal path. Pass-through when the env vars name the same internal path (OSS default).
  - Adds `MCP_INTERNAL_PATH` (`'/mcp'`) and re-exports the old `MCP_RESOURCE_PATH` for back-compat.

  **Default change** — OSS default `MUNIN_PUBLIC_URL` is now `http://localhost:3001/mcp` (path included). Existing self-hosters who set `MUNIN_PUBLIC_URL=http://localhost:3001` (no path) will see their OAuth resource URL change from `…/mcp` to bare host — every active token will need refreshing. To keep the old behavior verbatim, set `MUNIN_PUBLIC_URL=http://localhost:3001/mcp`.

  **Dashboard (`@getmunin/dashboard-pages`)**
  - `GetStarted` fetches the canonical MCP URL from `/.well-known/oauth-protected-resource` and renders it in the Claude / ChatGPT / Gemini config snippets. OSS self-host now shows `http://localhost:3001/mcp` (or whatever the local backend advertises); cloud shows `mcp.getmunin.com`.
  - `mcp-setups.ts` ships a `buildMcpSetups(host)` helper alongside the static fallback.
  - @getmunin/types@4.7.0
  - @getmunin/ui@4.7.0

## 4.6.1

### Patch Changes

- @getmunin/types@4.6.1
- @getmunin/ui@4.6.1

## 4.6.0

### Minor Changes

- b770bce: OAuth consent UX rework and bootstrap MCP removal.

  **Backend**
  - New `GET /api/v1/oauth/clients/:clientId` endpoint (anonymous, on `OAuthModule`) returns the disclosure-safe fields `{ client_id, name, uri, icon }` from the `oauth_client` table. Lets the consent page render the registered client name + URL + logo instead of the random RFC 7591 `client_id`.
  - `SUPPORTED_SCOPES` gains `outreach:read` / `outreach:write`. Outreach MCP tools are retagged from `crm:*` to `outreach:*` so an external connector can be granted outreach access without inheriting CRM access.

  **Dashboard pages**
  - `OAuthConsentPage` rewritten:
    - Fetches the new client-info endpoint on mount, falls back to `client_id` if missing.
    - Hides scopes that aren't user-tunable on the consent screen — `openid`, `profile`, `email`, `offline_access` (OIDC/OAuth standards required by any connector), and `mcp:tools` / `mcp:admin` / `mcp:self_service` (the MCP umbrella + audience-decided-by-user, not by-scope).
    - Groups remaining scopes by user-facing app: Knowledge Base, Conversations, Contacts, Content, Outreach. Internal modules (`curator`, `playbooks`, `web`) are not surfaced — they remain reachable via the `mcp:tools` umbrella.
    - Disclosure footer: "Sign-in identity and session refresh are also granted."

  Scope-narrowing checkboxes at consent time are still deferred — needs upstream `@better-auth/oauth-provider` support or a wrap-and-mutate layer in the consumer.

  **Bootstrap MCP removal**
  - Removes the `bootstrap_status` / `bootstrap_answer` MCP tools, the `@getmunin/bootstrap` package, the per-app `*.bootstrap.ts` runners (kb / conv / crm / cms), and the `bootstrap_state` table (migration 0028). The conversational first-run wizard was redundant with the dashboard's UI onboarding and never picked up real callers. Direct admin tools (`kb_create_space`, `crm_create_pipeline`, `cms_create_locale`, `cms_create_collection`, `conv_*_setup_channel`) now cover everything bootstrap did.
  - Skill markdown for `kb-onboarding` and `conv/bulk-channel-setup` rewritten to call the direct tools.

### Patch Changes

- @getmunin/types@4.6.0
- @getmunin/ui@4.6.0

## 4.5.1

### Patch Changes

- @getmunin/types@4.5.1
- @getmunin/ui@4.5.1

## 4.5.0

### Patch Changes

- @getmunin/types@4.5.0
- @getmunin/ui@4.5.0

## 4.4.1

### Patch Changes

- 71a6c84: Fix sign-in error alert. Two bugs:
  - `auth.signIn.invalid.hintWithReset` used `{resetLink}` placeholder syntax, but the consumer (cloud login) calls `t.rich(...)` with a React-function value, which requires `<resetLink>...</resetLink>` tag syntax. The mismatch silently rendered nothing for the link, producing user-visible text like `"Check the address, or ."`. Switched the message to tag syntax (`<resetLink>reset your password</resetLink>`); the dead `resetLinkLabel` key is removed.
  - Added `auth.signIn.unreachable.{title,hint}` so consumers can distinguish "wrong credentials" from "backend unreachable" instead of showing the same alert title for both. The OSS login page now picks the right title/body based on whether `authClient.signIn.email` returned a structured error or the request threw.
  - @getmunin/types@4.4.1
  - @getmunin/ui@4.4.1

## 4.4.0

### Minor Changes

- ac20d4b: Mobile responsive pass across the dashboard:
  - **Overflow**: responsive `px-4 md:px-10` on the overview container, and `min-w-0` on the Get-Started grid cells so the long `Authorization: Bearer mn_live_…` snippet no longer widens the body and bleeds the recipes column past the viewport.
  - **Tables**: api-keys, team, agents, audit-log, and end-users tables now hide low-priority columns on mobile (`hidden md:table-cell`) and wrap in an `-mx-6 overflow-x-auto px-6` scroll container so anything still overflowing scrolls within the content area instead of widening the body.
  - **Hover-on-touch**: enable Tailwind's `future.hoverOnlyWhenSupported` so `hover:` and `group-hover:` only fire on devices with `@media (hover: hover)`, eliminating sticky-hover on tap.
  - **Truncation**: `RecentConversations` rows now truncate as a single line (move `truncate` from the inline preview span to the parent block).
  - **Topbar (mobile)**: org/brand name now appears centered in the topbar on mobile (was desktop-only). Settings menu button is now a `<Button variant="outline" size="icon">` instead of an inline `<button>`.
  - **Dashboard hero**: eyebrow shows the date only; org name moved to the topbar.
  - **Section dividers**: get-started's top hairline removed; recent-conversations and queue rows keep their soft-gray bottom border on the last item so the section self-closes.

  ### `@getmunin/ui`
  - **Button primitive**: all variants except `link` now render their hairline frame via `shadow-[inset_0_0_0_0.5px_…]` instead of `border-[0.5px]`. Shadows are rasterized through a different paint path and don't collide with adjacent hairlines (table-row bottom borders, header bottom borders), which on iOS Safari Retina was dropping the button's bottom edge.
  - **Pill primitive**: same shadow-inset hairline using `currentColor`, so the frame inherits whatever text color the variant sets without a separate `border-current` declaration.

  The `border-[0.5px]` convention is unchanged everywhere else (Hairline primitive, card / dialog / input / table-row dividers, etc.); only the elements that sit flush against another hairline switched to the shadow rendering path.

### Patch Changes

- Updated dependencies [ac20d4b]
  - @getmunin/ui@4.4.0
  - @getmunin/types@4.4.0

## 4.3.0

### Minor Changes

- 21a8189: Add a "Last conversations" section to the dashboard home, below the Usage KPIs. Lists up to 10 conversations from the past 7 days, sorted by most recent message. Each row shows the subject (or `Conversation #displayId` fallback), the last inbound (end-user) message as a muted preview, status badge for non-open states, and a relative timestamp. Click opens the conversation drawer. Hidden when there's nothing in the 7-day window.

  Backend: `ConversationSummary` gains an optional `lastInboundPreview` field. `GET /api/v1/conversations` populates it via a correlated subquery over `conv_messages` (latest non-internal `author_type='end_user'` body, collapsed and truncated to 200 chars). Other code paths that build a summary leave the field undefined.

  Dashboard: matching styling pass — Queue and Last-conversations headers now use the same ink-black eyebrow + ink underline pattern as Usage; the trailing row border is dropped via `last:border-b-0`. Extracts `useRelative` to `lib/use-relative.ts` so the new section and the existing inbox rows share one source of truth.

### Patch Changes

- 21a8189: Introduce `@getmunin/docs-pages`: lifts the developer-portal routes (`/docs`, `/docs/rest`, `/docs/mcp`, `/docs/skills`, `/docs/guides`) out of `apps/web` into a shared package so munin-cloud can mount the same docs under its own auth/header chrome. The OSS `apps/web/app/[locale]/docs/*` routes are now thin one-liner shells that re-export from the package.

  `@getmunin/backend-core` now publishes the OpenAPI spec and docs fixtures (mcp-tools.json, skills.json) via package subpath exports (`@getmunin/backend-core/openapi.json`, `@getmunin/backend-core/docs-fixtures/*`) so downstream consumers can read them at build time.

  Dashboard: removes the CONV pill from the Last conversations rows — the conversation rows in that section are conversations by definition; the pill was redundant.
  - @getmunin/types@4.3.0
  - @getmunin/ui@4.3.0

## 4.2.0

### Minor Changes

- 0040252: Add a "Last conversations" section to the dashboard home, below the Usage KPIs. Lists up to 10 conversations from the past 7 days, sorted by most recent message. Each row shows the subject (or `Conversation #displayId` fallback), the last inbound (end-user) message as a muted preview, status badge for non-open states, and a relative timestamp. Click opens the conversation drawer. Hidden when there's nothing in the 7-day window.

  Backend: `ConversationSummary` gains an optional `lastInboundPreview` field. `GET /api/v1/conversations` populates it via a correlated subquery over `conv_messages` (latest non-internal `author_type='end_user'` body, collapsed and truncated to 200 chars). Other code paths that build a summary leave the field undefined.

  Dashboard: matching styling pass — Queue and Last-conversations headers now use the same ink-black eyebrow + ink underline pattern as Usage; the trailing row border is dropped via `last:border-b-0`. Extracts `useRelative` to `lib/use-relative.ts` so the new section and the existing inbox rows share one source of truth.

### Patch Changes

- @getmunin/types@4.2.0
- @getmunin/ui@4.2.0

## 4.1.1

### Patch Changes

- 8c11b50: Rename the Account settings page title from "Your workspace." to "Your perch." (en) / "Din grein." (nb), aligning with the raven/flock metaphor used on the rest of the dashboard pages.
- 1f7ea3d: Two polish fixes:
  - Settings sidebar (nav + sign-out) is now `sticky` under the topbar so scrolling the main content area no longer hides the nav or the sign-out button.
  - Account page's save button label and confirmation message now match the rest of the dashboard: `Save` (not `Save changes`) and a muted-gray `Saved` toast (matching `identity-card`/`models-card`) instead of the previous cobalt-blue confirmation.
  - @getmunin/types@4.1.1
  - @getmunin/ui@4.1.1

## 4.1.0

### Minor Changes

- cf3fd9d: Update auth-page styling: primary action (Sign in / Continue) is now black (`bg-ink`) with cobalt-deep on hover, matching the rest of the dashboard's primary buttons. Inputs and buttons are now square (12px corner radius removed) on auth and invite acceptance pages. The `variant="navy"` prop name on `AuthSubmit` is kept for backwards compatibility but no longer uses the navy color token.

### Patch Changes

- @getmunin/types@4.1.0
- @getmunin/ui@4.1.0

## 4.0.0

### Major Changes

- b5dce5d: Remove `OrgSwitcher` from `@getmunin/dashboard-pages`. OSS is single-tenant and never used it; cloud should ship its own switcher into the existing `leftSlot` on `DashboardShell` / `DashboardTopbar`. Also: when `leftSlot` is provided, it now replaces the brand text in the topbar instead of rendering alongside it.

### Patch Changes

- @getmunin/types@4.0.0
- @getmunin/ui@4.0.0

## 3.9.1

### Patch Changes

- 90ffd9c: Fix the org switcher dropdown throwing `Base UI error #31` (MenuGroupRootContext missing) when opened. Wrap the label, separator and items in a `<DropdownMenuGroup>` so `Menu.GroupLabel` has the group context it now requires under base-ui 1.4.
  - @getmunin/types@3.9.1
  - @getmunin/ui@3.9.1

## 3.9.0

### Minor Changes

- ed2bb6b: Add generic `SmtpMailer` provider to `@getmunin/core`.

  Covers any SMTP-speaking transactional email service (Scaleway TEM, Postmark,
  Mailgun, Postmark, etc.) via a single implementation. Activated by setting
  `MUNIN_MAIL_PROVIDER=smtp` along with `MUNIN_SMTP_HOST`, `MUNIN_SMTP_PORT`,
  `MUNIN_SMTP_USER`, `MUNIN_SMTP_PASSWORD` (optional `MUNIN_SMTP_SECURE=1` for
  implicit-TLS on port 465). `nodemailer` is the underlying transport.

### Patch Changes

- Updated dependencies [ed2bb6b]
  - @getmunin/types@3.9.0
  - @getmunin/ui@3.9.0

## 3.8.0

### Minor Changes

- a3f532e: Onboarding cleanup, agent-config hot-reload, provider auth validation.
  - Dropped the chatbot-name field from the onboarding form; new orgs seed with an empty name so step 1 is shown until the user names their bot.
  - Removed the unused `orgs.slug` column (migration 0027); CMS delivery routes (`/api/v1/cms/:orgId/...`) and the matching SDK clients now key on `orgId` rather than the slug.
  - `AgentConfigService` validates provider credentials _before_ persisting — OpenRouter is probed via `/auth/key` (since its `/models` endpoint is public), Anthropic/OpenAI rely on `/models` 401. Bad keys no longer silently overwrite a working config.
  - Saving agent config emits `agent.config.updated` via the WebhookDispatcher; the realtime gateway broadcasts it and `AgentHostRunner` respawns the affected runner — model/provider changes apply without a backend restart.
  - Models picker reconciles a stale stored model slug against the fetched model list at render time, so the dropdown can't round-trip an unknown id back to the server.
  - Chat widget no longer filters the current session's conversation out of the past-conversation list — going back from a fresh conversation shows it.

### Patch Changes

- Updated dependencies [a3f532e]
  - @getmunin/types@3.8.0
  - @getmunin/ui@3.8.0

## 3.7.0

### Minor Changes

- 1cec7ea: Make `@getmunin/dashboard-pages` the canonical home for OSS messages so downstream apps don't have to copy the shared keys.

  **New exports:**
  - `loadBaseMessages(locale)` — dynamic-imports the bundled `en.json` / `nb.json`. Returns a `MessagesTree`.
  - `mergeMessages(base, overrides)` — recursive deep merge for spreading host-app overrides on top of the base messages.
  - `BASE_LOCALES` / `BaseLocale` — the locale set the package ships translations for.

  The OSS web app's `apps/web/messages/{en,nb}.json` are gone — their content moved to `packages/dashboard-pages/src/messages/`. `apps/web/i18n/request.ts` now calls `loadBaseMessages(locale)` directly.

  Downstream apps (e.g. munin-cloud) can adopt the same loader and pass only their cloud-specific overrides:

  ```ts
  const base = await loadBaseMessages(locale);
  const overrides = (await import(`../messages/${locale}.json`)).default;
  return { locale, messages: mergeMessages(base, overrides) };
  ```

  This is additive — no existing exports removed.

### Patch Changes

- Updated dependencies [1cec7ea]
  - @getmunin/types@3.7.0
  - @getmunin/ui@3.7.0

## 3.6.0

### Minor Changes

- bbd1d03: Extract dashboard + settings shells from `@getmunin/web` into `@getmunin/dashboard-pages` so downstream consumers can compose the same dashboard structure instead of redeclaring it.

  **New exports from `@getmunin/dashboard-pages`:**
  - `DashboardShell` — wraps `useDashboardGate`, session check, topbar render, and the `inSettings` pathname toggle. Props: `brand`, `logoSrc?`, `leftSlot?`, `withConfirmDialog?`.
  - `SettingsShell` — wraps the settings layout: role gate, `SettingsTopbar`, `RailNav` sidebar built from a `groups` prop, and the mobile `Sheet`. Consumers pass a `SettingsSubNavGroup[]`.
  - `OSS_SETTINGS_GROUPS` — the canonical OSS settings nav config (moved from `apps/web/.../nav-config.ts`).
  - `extendSettingsGroups(base, extensions)` — merges items into existing groups (or appends a new group). Supports `insertAfter`, `insertBefore` (by slug or labelKey), and `position: 'start' | 'end'` for ordering.
  - `createSettingsIndexRedirect({ defaultLocale, target? })` — factory for the `settings/page.tsx` default redirect.

  **Convention:** any `labelKey` you put in a settings group must have a matching `nav.*` entry in the host app's `messages/*.json`. Group keys map to `dashboard.settings.groups.*`.

  This is purely additive — no public API removed. The web app's own `dashboard/{layout,settings/layout,settings/page}.tsx` files were collapsed onto the new shells in the same PR (#166).

### Patch Changes

- Updated dependencies [bbd1d03]
  - @getmunin/types@3.6.0
  - @getmunin/ui@3.6.0

## 3.5.0

### Minor Changes

- be32cb4: Email channel polish, read tracking, and agent-model tier rename.

  **Email channel (#136, #140)**
  - New "Send test email" action in the channel dropdown — opens a dialog
    prefilled with the logged-in user's email, sends via the channel's real
    outbound transport.
  - SMTP/IMAP networking: force IPv4 DNS resolution at backend startup
    (fixes `EHOSTUNREACH` on hosts with broken IPv6 routing); auto-pick TLS
    mode by port (465 implicit, 587/25/2525 STARTTLS).
  - SMTP error surfacing: readable messages for `EAUTH` / `ECONNECTION` /
    `EENVELOPE` plus the server's response text, replacing generic
    "Internal error".
  - Inbound mail now creates an `end_users` row keyed
    `external_id = email:<addr>` and links the contact; agent runtime no
    longer skips conversations with "no end-user bound".
  - Inbound dedupe on RFC-5322 `Message-ID` — defense-in-depth against
    cursor failures, UIDVALIDITY changes, restored backups.
  - IMAP poll fixes: cursor read/write use `app.bypass_rls=on`; fetch by
    UID range instead of sequence numbers; per-tick logging.
  - Strip quoted reply blocks (multi-language) AND signatures (RFC 3676 +
    mobile-client openers + common separators) before persisting inbound
    bodies. Nested-quote prior 3 messages in outbound replies; add `Re:`
    prefix when missing.

  **Read tracking (#137, #139)**
  - New `conv_message_reads` table; chat widget reports agent messages as
    read when they enter the viewport (`IntersectionObserver` + 200 ms
    coalesce window). Backend gateway handles the `read` WS frame,
    inserts with `ON CONFLICT DO NOTHING`, emits
    `conversation.message.read` webhook per new row.
  - Email open pixel: opt-in per channel (`trackOpens` flag), HMAC-signed
    token, `GET /api/v1/c/o/:token.gif` endpoint returns a transparent
    GIF and bumps `first_opened_at` / `last_opened_at` / `open_count` on
    `conv_message_deliveries`. Emits `conversation.message.opened` on
    first open.
  - Operator-side "Seen HH:MM" badge under outbound messages in the
    dashboard conversation drawer. Live-updates through the existing
    realtime hook on `conversation.message.read` events.

  **Model tier rename (#141)**
  - `chatModel` → `fastModel`, `curatorModel` → `smartModel` across
    `agent_config` schema, types, controllers, dashboard form, and i18n
    strings. Capability tiers instead of use-cases — every code path
    picks the right tier without adding a new column per feature.
  - Idempotent `ALTER COLUMN RENAME` in both DDL strings handles
    existing databases.
  - Dashboard form now shows example use-cases under each field.

  **Schema migrations**
  - `0020_conv_read_and_open_tracking.sql` — `conv_message_reads` table
    - `first_opened_at` / `last_opened_at` / `open_count` columns on
      `conv_message_deliveries`.
  - `agent_config` `chat_model` → `fast_model`, `curator_model` →
    `smart_model` (idempotent rename inside the agent-host DDL).

### Patch Changes

- Updated dependencies [be32cb4]
  - @getmunin/types@3.5.0
  - @getmunin/ui@3.5.0

## 3.4.1

### Patch Changes

- 1b3b959: Include `src/` in the published tarballs for every package that declares a `development` export condition (`@getmunin/types`, `core`, `db`, `sdk`, `mcp-toolkit`, `bootstrap`, `backend-core`, `agent-runtime`, `agent-host`).

  The `development` condition resolves to `./src/index.ts`, which is the right path in the OSS workspace (pnpm-linked) but didn't exist in the published tarball — `files: ["dist"]` excluded it. Downstream consumers whose toolchain activates the `development` condition (e.g. vitest 2.x in cloud) hit `Cannot find module '.../src/index.ts'` errors at runtime. Shipping `src/` alongside `dist/` makes the condition resolve in both environments.
  - @getmunin/types@3.4.1
  - @getmunin/ui@3.4.1

## 3.4.0

### Minor Changes

- 6a6e9f7: Dashboard navigation overhaul, action feedback via toasts, widget fixes, and onboarding polish.

  **Navigation**
  - New `DashboardTopbar` (cog → Settings, rotate-on-hover) replaces the multi-item nav. Settings page gets its own `SettingsTopbar` (back arrow → /dashboard, mobile hamburger). Settings page uses `bg-paper` to match the topbar; sidebar keeps `bg-bone`.
  - Sign-out moves to the bottom of the settings sidebar (and the mobile drawer). `UserMenu` removed.
  - Account moved into the settings sidebar (first item under Workspace). New `AccountPage` (org-name field, `GET`/`PATCH /api/v1/orgs/me`) accepts `extraSections` so cloud can compose its destructive Delete-account UI on top.

  **Onboarding wizard**
  - New step 1 collects the org name (`OrgNameCard`); existing steps renumbered to 2–4. `useDashboardGate` and `useSetupGate` redirect to /setup when the org name is empty, not just when the agent is unconfigured.
  - `invalidateActiveMembershipCache()` exported so the topbar brand refreshes immediately after a rename.

  **Team page**
  - Row-level Edit per member opens a dialog to rename. Owner/admin can edit anyone; members can edit only themselves. Self-rename also calls `authClient.updateUser({ name })` to sync the Better Auth session.

  **Action feedback**
  - New `Button` `pending` prop renders a spinning Loader2 and disables the button.
  - New `notify` helper wraps `sonner` (`notify.success` / `notify.error` / `notify.info`). Inline `<Card><CardContent text-destructive>` patterns swept across team, channels, agents, end-users, export, api-keys, audit-log, agent-setup-wizard, inbox, suggestions. The InboxErrorBanner export is gone; inbox actions now toast directly.
  - Revoke flows (agents, api-keys, end-users) wire `pending` per row and toast success/failure. End-users "no tokens to revoke" is now an `info` toast, not an error.

  **Backend**
  - `PATCH /api/v1/orgs/me/members/:userId` accepts `{ name? }`. Name edits allowed for owner/admin or self-edit; role edits still owner-only.
  - `POST /api/v1/conversations/:id/messages` accepts `claim?: boolean` (default true). Quick-reply flow passes `false` so approving the AI's draft no longer claims the conversation.
  - `POST /api/v1/conversations/:id/status` releases the human claim when transitioning to `closed`.
  - `/api/v1/inbox` `loadLive` filters closed/spam at SQL via a new `excludeStatuses` option on `listConversations` and `listConversationsByIds`.
  - Widget ingest accepts `visitorId` (stable per-browser token); anon end-users key on `anon:<visitorId>` when present, falling back to `anon:<sessionId>` for legacy clients. One end-user per visitor instead of one per session.
  - Members controller `PatchMemberDto` accepts `name`; users.name + updatedAt written when editing.

  **Chat widget**
  - `getVisitorId(channelId)` mints a long-lived browser token, sent on every payload.
  - Saved-email confirmation stays inline at its original position (no longer pushed down or pinned).
  - Less padding on the saved-state card. Top bar's "Online now" line removed; subtitle renamed from "Chat · instant" to "Online now".
  - Header title: "New conversation" when starting fresh, "Conversation" when opening an existing one (subject still wins).

  **Agent runtime**
  - System prompt forbids placeholders (`[Name]`, `[Phone Number]`, …) — every message must be deliverable verbatim.

  **Visual polish**
  - All 1px / 2px borders swept to `border-[0.5px]` for hairline rendering on retina (49 files, ~115 occurrences). Topbar bottom border + section dividers + KPI tile outlines all hairline now.
  - "Delegated end-user token" → "End-user token" in the Agents settings table.
  - "TAKEN OVER" pill swaps the shield icon for a person icon and drops the leading blue dot.
  - Conversation drawer's "Close" button now reads "Close conversation".
  - Agents table row vertically centers single-line cells against the two-line "End-user token + scopes" cell.

  **Settings layout**
  - Account redirect target unchanged (`/dashboard/settings/team`); Account is the new first item in the workspace nav group.

### Patch Changes

- @getmunin/types@3.4.0
- @getmunin/ui@3.4.0

## 3.2.1

### Patch Changes

- @getmunin/ui@3.2.1

## 3.2.0

### Minor Changes

- 9d84e3c: Drop the unused `displayName` field from chat-widget channels. The field was required at create time but was never read by the chat-widget itself — only echoed in the dashboard's channel list. Removed from the MCP tool inputs (`conv_widget_create_channel`, `conv_widget_update_channel`), the `WidgetChannelConfig` zod schema, the REST body schemas in `ConvChannelsController`, the dashboard's "Add chat widget" form and channel-row display, and the widget-onboarding / bulk-channel-setup skill docs. Existing rows keep `displayName` in their `conv_channels.config` jsonb but it gets silently stripped on next parse — no migration required.

  Also fixes a NestJS route-ordering bug where `ConversationsController @Get(':id')` shadowed `ConvChannelsController @Get()`, causing `/api/v1/conversations/channels` to return `conv_not_found: conversation channels` instead of the channel list. `ConvChannelsController` is now registered before `ConversationsController` in `ControlModule`.

### Patch Changes

- @getmunin/ui@3.2.0

## 3.1.0

### Minor Changes

- 23a22f8: Add shared auth-shell components for the redesigned auth pages: `AuthShell`, `AuthEpigraph`, `AuthHeading`, `AuthSubheading`, `AuthFootnote`, `AuthDivider`, `AuthField`, `AuthLabel`, `AuthInput`, `AuthSubmit`, `AuthOAuthButton`, `AuthFieldHint`, `ErrorAlert`, `AuthInviteCard`, plus the `OSS_AUTH_FOOTER` / `CLOUD_AUTH_FOOTER` constants and `AuthState` type. Also adds `--munin-auth-navy`, `--munin-alert-bad-*`, and `--munin-invite-{good,bad}-*` design tokens to `@getmunin/ui` and exposes them as Tailwind utilities (`bg-auth-navy`, `bg-alert-bad`, `bg-invite-good`, etc.).

### Patch Changes

- Updated dependencies [23a22f8]
  - @getmunin/ui@3.1.0

## 3.0.0

### Major Changes

- e5a5450: Migrate from the deprecated `oidcProvider` (in-tree better-auth plugin) to the published `@better-auth/oauth-provider`. The OAuth schema changes from 3 tables to 4 (`oauth_client`, `oauth_access_token`, `oauth_refresh_token`, `oauth_consent`) plus a `jwks` table for the JWT plugin. RFC 8707 resource indicators are now native via `validAudiences`, JWT access tokens replace opaque tokens for resource-bound flows, and the consent page contract switches from `consent_code` to a signed `oauth_query`. The dashboard consent page is fully localized (en + nb).

  Breaking: any deployment with rows in the old `oauth_applications` / `oauth_access_tokens` / `oauth_consents` tables will lose them — Munin OAuth has not been deployed anywhere yet, so this is a no-op in practice.

### Patch Changes

- @getmunin/ui@3.0.0

## 2.5.1

### Patch Changes

- @getmunin/ui@2.5.1

## 2.5.0

### Minor Changes

- e962f04: feat(oauth): branded consent UI at /dashboard/oauth/consent (Phase 4)

  Custom consent page for the OAuth 2.1 authorization flow. Replaces Better-Auth's default `getConsentHTML` fallback with a Munin-styled card showing the client name, requested scopes, and Allow/Deny actions. Submission posts to `/auth/oauth2/consent` with `accept: true|false` and the `consent_code` from the query string; on success the user is redirected back to the OAuth client.

  The page is added to `useDashboardGate`'s exempt list so a user can authorize an external app even before completing the built-in-AI setup wizard.

  A wrapper at `apps/web/app/dashboard/oauth/consent/page.tsx` re-exports the component; cloud picks it up automatically when it bumps the package.

### Patch Changes

- @getmunin/ui@2.5.0

## 2.4.0

### Patch Changes

- @getmunin/ui@2.4.0

## 2.3.0

### Patch Changes

- @getmunin/ui@2.3.0

## 2.2.0

### Patch Changes

- @getmunin/ui@2.2.0

## 2.1.0

### Minor Changes

- f9ecaa9: feat(widget): in-tree chat widget — drop-in `<script>` for self-hosted Munin

  Self-hosted Munin now serves a first-party browser chat widget directly
  at `https://<host>/widget.js`. Operators don't need a token-mint proxy,
  a separate hosting target, or the old `chat-widget-vanilla` example —
  they create a chat-widget channel in the dashboard, copy the embed
  snippet from **Settings → Channels → Embed snippet**, and paste it on
  their site.

  **`@getmunin/backend-core`**
  - Per-channel `identityVerificationSecret` + `requireVerifiedIdentity`
    flag on `WidgetChannelConfig`. The secret is generated at channel
    creation, surfaced once via `conv_widget_create_channel`, and rotatable
    via the new `conv_widget_rotate_identity_secret` MCP tool.
  - `verifyIdentity()` runs on every widget request: timing-safe HMAC check
    on the `(verifiedExternalId, userHash)` pair against the channel's
    secret. Failures collapse to a single `403 identity_verification_failed`
    so callers can't distinguish failure modes by status or timing.
  - `originAllowlist` is now enforced on `POST /api/v1/widget/messages` —
    browser callers must declare an `Origin` on the channel's allowlist;
    server-to-server callers (no `Origin`) pass through unchanged.
  - New `GET /api/v1/widget/messages?since=` endpoint for WS-reconnect
    backfill. Capped at 100, returns `hasMore`. Verified mode binds the
    result set to the requester's externalId (mismatch returns empty
    rather than 403 to avoid leaking session existence).
  - `RealtimeGateway` learns a `widget` subscription type. Widget keys
    authenticate at upgrade with origin-allowlist + HMAC identity gates;
    subscriptions are scoped to `widget:<channelId>:<sessionId>`.
    Operator-side replies fan out via a per-connection conversation-meta
    cache, no upstream emit-site changes needed.
  - Bidirectional `typing` events: visitor ↔ operator, server-side throttle
    of 1 broadcast per 1.5 s per (sender, conversation), 5 s auto-clear if
    the sender goes silent. `requireVerifiedIdentity` is honored for both
    sides.
  - Inbound WS frames capped at 64 KB.
  - Backend serves the bundle: `GET /widget/<sha>.js` is immutable
    (`max-age=31536000, immutable`); `GET /widget.js` is a 302 redirect to
    the current sha with `max-age=300, must-revalidate`. The redirect
    target is read from `manifest.json` and refreshed on file mtime change
    so deploy-time swaps propagate without restart. Path traversal is
    blocked; missing manifest yields 503 `no-store`.
  - Visitor-message body capped at 1000 chars (`role: end_user`); operator
    / agent / system messages keep the prior 50K cap.
  - New REST surface for the dashboard: `requireVerifiedIdentity` on the
    create/update bodies and `POST .../widget/:id/rotate-identity-secret`.

  **`@getmunin/dashboard-pages`**
  - The Channels page now surfaces the identity-verification secret on
    channel creation alongside the widget API key (one combined callout,
    shown once).
  - New per-chat-channel actions: **Embed snippet** (a dialog with a
    copyable `<script>` tag pre-filled with the dashboard origin and
    channel id, plus tabbed Node / Ruby / PHP / Python snippets for
    computing `data-user-hash` server-side) and **Rotate identity secret**.

  **Companion changes**
  - A new `@getmunin/chat-widget` workspace package (private, deployable
    artifact like `apps/backend` and `apps/web`; not published to npm)
    hosts the widget source. Built as a single content-hashed IIFE bundle
    via Vite, copied into `apps/backend/public/widget/` by a `prebuild`
    step.
  - The standalone `chat-widget-vanilla` example in the `munin-examples`
    repo is removed — the dashboard's embed snippet replaces it.

### Patch Changes

- @getmunin/ui@2.1.0

## 2.0.0

### Major Changes

- d4f7a27: refactor!: route alignment + ai-agent → builtin-ai rename + setup gate

  Frontend route alignment, the second pass after the API rename. Three things in one diff:

  **1. Rename `/dashboard/settings/ai-agent` → `/dashboard/settings/builtin-ai`** in OSS and updates the wizard's hardcoded internal link. The package export `AgentSettingsPage` is renamed to `BuiltinAiSettingsPage` to match the URL.

  **2. New gate hooks** for use in dashboard layouts and the setup page:
  - `useDashboardGate()` — returns `{ ready, role }`. When the active org's built-in AI is not configured (`providerApiKeySet === false`) and the user is owner/admin, redirects to `/setup`. Members are allowed through (they see the dashboard's per-page empty states). `/dashboard/account` is exempt — escape hatch if onboarding goes sideways.
  - `useSetupGate()` — returns `{ ready }`. Inverse: redirects to `/dashboard` when configuration is already complete.
  - `useAgentConfigStatus()` — small primitive used by both gate hooks.

  **3. OSS app wired up.** `apps/web/app/dashboard/layout.tsx` now uses `useDashboardGate`; `apps/web/app/setup/page.tsx` now uses `useSetupGate`.

  Companion frontend changes ship in `munin-cloud` once a release of this package is published.

### Patch Changes

- @getmunin/ui@2.0.0

## 1.0.0

### Patch Changes

- @getmunin/ui@1.0.0

## 0.25.0

### Patch Changes

- @getmunin/ui@0.25.0

## 0.24.1

### Patch Changes

- @getmunin/ui@0.24.1

## 0.24.0

### Minor Changes

- 950694e: feat(agent-host): bundled in-process agent runner

  New `@getmunin/agent-host` package — a hosting layer that runs the
  agent (chat replies + curator queue) in-process inside the backend,
  replacing the separate `apps/agent-sidecar` topology.

  What's in the package:
  - `agent_config` table with both singleton (single-tenant) and
    multi-tenant DDL variants. Adds a `chat_model`/`curator_model`
    split so curation can use a stronger model than chat.
  - `AgentConfigRepository` (singleton + per-org impls) and
    `AgentConfigService` for CRUD over the config row.
  - `AdminKeyProvider` (no-op + auto-mint impls) for hosts that want
    rotated per-config admin credentials.
  - `AgentHostRunner` — reconcile loop that spawns per-config
    `ConversationHandler` + curator worker. Multi-replica safe via a
    `ReplicaLockManager` that pins a postgres-js `sql.reserve()`
    client and uses `pg_try_advisory_lock` to elect a chat-loop owner
    per config; curator drains on every replica via existing SKIP
    LOCKED. Two-tier model dispatch: `chatModel` for chat,
    `curatorModel ?? chatModel` for `runSkillPass`.
  - `AgentModelsService` — proxies the provider's `/v1/models`
    endpoint. Returns objective fields (id, contextLength, prompt /
    completion price per million) when the provider includes them
    (OpenRouter, Anthropic). 10-min in-memory cache.
  - `AgentConfigController` — `GET/PUT /api/agent-config` and
    `GET /api/agent-config/models`, user-actor only.
  - `AgentHostModule.forRoot({ configRepository, adminKeyProvider,
runnerOptions })` for DI wiring; uses `useExisting: DB` against
    `@getmunin/backend-core`'s global `DbModule`.

  `@getmunin/dashboard-pages`: new `AgentSetupPage` export — single-
  form `/setup` wizard for first-run agent configuration.

  `@getmunin/agent-runtime`: default `clientName` in
  `mcp-client.ts` changed from `'munin-agent-sidecar'` to
  `'munin-agent'` after the sidecar app was removed.

### Patch Changes

- @getmunin/ui@0.24.0

## 0.23.3

### Patch Changes

- @getmunin/ui@0.23.3

## 0.23.2

### Patch Changes

- @getmunin/ui@0.23.2

## 0.23.1

### Patch Changes

- 4ff9c11: Remove dashboard outreach campaigns config page. Campaign CRUD now lives only via the admin MCP tools (`outreach_create_campaign`, `outreach_update_campaign`, `outreach_list_campaigns`, `outreach_get_campaign`) — agent-native setup, dashboard-native review. Drops the `/dashboard/settings/outreach` route, the `OutreachCampaignsPage` export, and the `/api/outreach/campaigns` REST controller. The Review tab (`OutreachDraftsTab`) and `/api/outreach/proposals` are unaffected.
  - @getmunin/ui@0.23.1

## 0.23.0

### Minor Changes

- 88b1bc3: Outreach feature, PR3 of 3 — `agentMode` + draft-on-reply loop. Closes the outreach loop: every reply on an outreach-originated conversation gets drafted by an admin agent and waits for human approval. The AI conversational runner never auto-replies on these conversations, even when the prospect responds.

  **`agentMode` on conversations.** New enum column `agent_mode` on `conv_conversations` with values `auto | draft_only | off`, default `auto`. Orthogonal to claims (claims are _who's working it now, with TTL_; agentMode is _what posture the agent takes, durable_). Reusable beyond outreach — a customer can flip a single conversation or a whole channel into `draft_only` for trust-building, moderation, or VIP review.
  - `ConvService.setAgentMode(id, mode)` + REST `POST /api/conversations/:id/agent-mode`.
  - `ConvService.createConversation` accepts `agentMode` (default `'auto'`).
  - `ConversationSummary`/`Detail` DTOs now expose `agentMode` and `outreachCampaignId`.
  - `agent-runtime`'s `ConversationHandler.shouldRespond` defers when `agentMode !== 'auto'` (logged as `skip <id>: agentMode=draft_only`). Two new unit tests cover both `draft_only` and `off`.
  - `MuninRestClient.ConversationDetail` adds `agentMode` and `outreachCampaignId`.

  **Outreach reply-curator skill.** New `skill://outreach/draft-reply`. Triggered event-driven: when an inbound message lands on a conversation that has both `outreachCampaignId` set and `agentMode='draft_only'`, `ConvService.sendMessage` enqueues a curator job (dedupe-keyed by message id). The skill reads the thread, identifies the prospect's intent (question / decline / ask-for-human / off-topic / hostile), grounds factual claims via `kb_search`, drafts a 30–120-word reply, and files it via `outreach_propose_reply` for human approval. Strict rules: no unsubscribe footer (initials carry it; replies thread inside), no auto-send.

  **Outreach service.**
  - `OutreachService.proposeReply({ conversationId, draftBody, evidence })` — files a `kind='reply'` proposal. Rejects when the conversation is not outreach-originated. Resolves CRM contact via the conversation's `conv_contacts.email`.
  - `OutreachService.approveProposal` now branches on kind. `kind='initial'` flips the new conversation to `agentMode='draft_only'` (so the AI runner defers on subsequent inbound messages). `kind='reply'` sends the draft body verbatim via `conv.sendMessage` on the existing conversation — no unsubscribe footer.
  - New MCP tool `outreach_propose_reply` (admin audience). The reply skill calls it.

  **Sidecar `toolPrefixesFor`** adds `'skill://outreach/draft-reply'` → `['conv_', 'kb_', 'crm_', 'outreach_']`. Cloud `AgentRunnerService.toolPrefixesFor` needs the same one-line addition (separate cloud PR after this OSS release).

  **Dashboard.** `OutreachDraftsTab` differentiates kind with a coloured badge (`Reply` filled, `Initial` outline). Reply cards link to `/dashboard/conversations?id=<id>` so the operator can see thread context before approving. i18n string `viewThread` added in en + nb.

  **Schema migration** `0013_conv_agent_mode.sql` — single column add; default `'auto'` so all existing conversations are unaffected. Outreach conversations created via `approveProposal` going forward land in `'draft_only'`.

  **Tests.** 6 new (2 in agent-runtime for the defer; 2 in conv.service for the inbound-on-outreach enqueue path; 4 in outreach.service for proposeReply, approveReply send + no-footer assertion, agentMode=draft_only on initial approve, and the not-outreach-conversation rejection). All 321 backend-core tests pass; 67 agent-runtime tests pass.

  **End-to-end:** an operator can now run a campaign where the entire loop — first send and every reply — is human-approved. Combined with PR1's suppression+consent floor and the unsubscribe infrastructure, this is the GDPR-compliant, never-auto-sends outbound channel the plan promised.

### Patch Changes

- @getmunin/ui@0.23.0

## 0.22.0

### Minor Changes

- ebda56e: Outreach feature, PR2 of 3 — campaigns + initial drafts + send-approve loop.

  The first user-visible piece of outbound: an operator defines a campaign (name + brief + CRM segment + email channel + cadence + CTA), the new `skill://outreach/draft-initial` curator drafts a personalised first-touch email per consenting contact in the segment, the operator reviews each draft on `/dashboard/review` (third tab), and approving sends via the existing email-channel outbound pipeline. Replies thread into normal conversations via the existing RFC 5322 thread-resolution.

  **Schema:**
  - `outreach_campaigns` — operator-defined campaigns (segment_id → `crm_segments`, channel_id → `conv_channels` (must be email), brief, cadence_rules JSONB, cta_url, enabled, unsubscribe_required). Unique `(org_id, name)`. RLS admin-only.
  - `outreach_proposals` — drafted email queue with `kind` (`initial` in PR2; `reply` in PR3), nullable `conversation_id` (set when sent), `status` lifecycle (pending → sent / dismissed / failed), evidence JSONB, audit fields. **Unique pending index on (campaign_id, contact_id, kind)** to prevent dup drafts. RLS admin-only.
  - `conv_conversations` gains `outreach_campaign_id` (nullable FK + index) — sticky once set, used for reply attribution and (in PR3) `agentMode` defaulting.
  - New `packages/db/src/sql/outreach.sql` with RLS policies, wired into `runMigrations`.

  **Service / MCP / REST** (all in new `@getmunin/backend-core/src/modules/outreach/`):
  - `OutreachService` — `listCampaigns`/`getCampaign`/`createCampaign`/`updateCampaign`/`listProposals`/`getProposal`/`proposeInitial`/`approveProposal`/`dismissProposal`. `approveProposal` re-checks suppression+consent at decision-time (the contact may have unsubscribed between draft and approval), creates a conversation with `outreach_campaign_id` set, sends via the existing email outbound pipeline, and appends a signed unsubscribe footer to the body server-side so it can't be tampered with at draft-time.
  - MCP tools (admin audience): `outreach_create_campaign`, `outreach_update_campaign`, `outreach_list_campaigns`, `outreach_get_campaign`, `outreach_list_proposals`, `outreach_propose_initial`.
  - REST: `GET/POST /api/outreach/campaigns`, `GET/POST /api/outreach/campaigns/:id`, `GET /api/outreach/proposals?status=pending&kind=initial&campaignId=…`, `GET /api/outreach/proposals/:id`, `POST /api/outreach/proposals/:id/approve`, `POST /api/outreach/proposals/:id/dismiss`. The proposals list/get embeds `contact` and `campaign` summaries so the dashboard doesn't need parallel fetches.
  - Realtime events: `outreach.proposal.created`, `outreach.proposal.sent`, `outreach.proposal.dismissed` (rides existing WebhookDispatcher).

  **Conv-side:** `ConvService.createConversation` now accepts `outreachCampaignId` and enqueues outbound delivery for non-end_user authors on email channels (it previously only did this from `sendMessage`, which broke first-touch sends). All existing flows are unaffected — they don't pass `outreachCampaignId` and their authorType doesn't trigger outbound enqueue.

  **Skill:** `skill://outreach/draft-initial` (markdown, copied into dist by the existing `copy-skills.mjs`). Procedure: list enabled campaigns → materialise audience via `crm_list_contacts_in_segment` (which already enforces the suppression+consent floor) → dedupe via `outreach_list_proposals` → ground in `kb_search` → draft 80–200 word personalised email → file via `outreach_propose_initial`. Strict formatting: no headings, plain prose, no JSON-escaping; the unsubscribe footer is appended at approve-time, not draft-time.

  **Curator scheduling:**
  - New sweep `curator-outreach-draft-initial` (default cron `'0 0 * * 0'` weekly, env `MUNIN_CURATOR_OUTREACH_INITIAL_CRON`).
  - Sidecar `toolPrefixesFor` adds `'skill://outreach/draft-initial'` → `['conv_', 'kb_', 'crm_', 'outreach_']`. Cloud `AgentRunnerService.toolPrefixesFor` needs the same one-line addition (separate cloud PR after this OSS release).

  **Dashboard:**
  - Third tab on `/dashboard/review`: `OutreachDraftsTab` lists pending proposals with markdown body (heading-flatten components shared with KB), Approve / Edit (placeholder; inline editing ships next) / Dismiss buttons. Realtime updates on `outreach.proposal.*` events.
  - New `/dashboard/settings/outreach` (under Monitoring → Workspace group) — list campaigns, create dialog with name + brief + segment dropdown + channel dropdown + CTA URL, enable/disable toggle. Empty-state nudges the operator if they have no email channels or segments yet.
  - i18n: `dashboard.outreach.*`, `dashboard.outreachDrafts.*`, `nav.outreach`, `dashboard.review.tabs.outreach` in en + nb.

  **Tests:** 9 new integration tests covering campaign CRUD (including non-email-channel rejection and duplicate-name conflict), `proposeInitial` (dedupe + consent floor), `approveProposal` (success path stamps conv id + delivery row, suppression-race refuses, disabled-campaign refuses), and `dismissProposal`. Existing 306 backend-core tests unchanged. `curator-scheduler.test.ts` updated to expect the new fourth cron job.

  **Out of PR2 scope (lands in PR3):** `agentMode` column + reply-curator skill + draft-on-reply loop. Operators currently get a one-way send; replies land in normal conversations and the AI agent will reply auto-mode by default until PR3 wires `agentMode = 'draft_only'` on outreach-originated conversations.

### Patch Changes

- @getmunin/ui@0.22.0

## 0.21.0

### Minor Changes

- 914477f: Channels can now be created and managed from the dashboard.

  **Backend** — new REST controller at `/api/conv/channels`:
  - `GET /` — list widget + email channels for the org.
  - `POST /widget` — create a chat-widget channel; mints and returns a one-shot `mn_widget_*` API key bound to the channel and origin allowlist.
  - `POST /widget/:id` — update name / origin allowlist / display name.
  - `POST /widget/:id/rotate-key` — revoke prior keys and mint a new one (one-shot return).
  - `POST /email` — create an email channel with operator-supplied SMTP credentials and optional IMAP for inbound. Passwords are encrypted at rest.
  - `POST /email/:id/test` — verify SMTP/IMAP credentials before enabling.

  Munin doesn't ship a built-in mailer; email channels require operator-provided SMTP, matching the OSS posture for outbound on every other surface.

  **Dashboard** — new "Channels" entry under Settings with an "Add channel" dropdown (chat widget / email). Each option opens a dedicated dialog. Widget cards expose the bound key on creation and rotation; email cards expose a "Test" button. Norwegian (`nb`) translations included.

- 914477f: Unified Review surface for KB suggestions and CRM merges, with structured-field-driven curation candidates.

  **Dashboard** — replaces the standalone `/dashboard/crm-merge-proposals` page (now redirects) with `/dashboard/review`, a tabbed page combining KB suggestions and CRM merges. Tab counts update live from `kb.*` and `crm.merge_proposal.*` realtime events; the home overview backlog rows for both queues now link into Review. The KB tab renders each candidate's body as markdown (via `react-markdown`, peer dep) inside a `prose` block; `h1`–`h6` are flattened to bold paragraphs so the body never visually competes with the candidate title. Each card has its own "Publish to:" picker pre-selected to the candidate's proposed target space, with a per-card override.

  **Backend — KB candidate DTO** — new structured fields on the curation candidate response:
  - `proposedTargetSpaceSlug: string | null` — extracted from the candidate's `target:<slug>` tag.
  - `sourceConversationId: string | null` — extracted from the `source:<id>` tag.

  Two new service methods (`KbService.listCurationCandidates`, `KbService.getCurationCandidate`) return these fields directly so the dashboard never has to regex over body prose. New REST routes at `/api/kb/curation/candidates` (list/get/publish/dismiss) and `/api/kb/spaces` (list) back the new UI. The "Source conversation / Proposed target space" footer that `proposeCurationCandidate` used to splice into the body is gone — the tags carry the same data and the structured fields surface it.

  **KB curation skill prompt** — Step 4 now sets explicit formatting rules for candidate bodies: subject is the title, body is plain prose with bold/italic/inline-code/short bullets allowed, **no `#`/`##`/`###` headings**, no JSON-escaping the body string, no tables/HTML/images. The "Drafted from conversation …" footer example is gone (now redundant with structured fields). This makes review-UI rendering predictable and prevents big duplicate-of-title H1s in the body.

  **UI fix** — `TabsTrigger` previously used `data-[selected]:` for the active-tab styling, but `@base-ui/react` Tabs emit `data-active`. The selected pill never highlighted. Fixed.

### Patch Changes

- Updated dependencies [914477f]
  - @getmunin/ui@0.21.0

## 0.20.0

### Patch Changes

- @getmunin/ui@0.20.0

## 0.19.0

### Patch Changes

- @getmunin/ui@0.19.0

## 0.18.0

### Patch Changes

- @getmunin/ui@0.18.0

## 0.17.0

### Minor Changes

- db26079: Adds a self-service-agent availability indicator to the dashboard. The realtime gateway now tracks live subscribers whose audiences include `self_service` (excluding end-user widgets) per org. New endpoint `GET /api/overview/agent-status` returns `{ selfServiceAgentSubscriberCount, lastInboundEndUserMessageAt, lastAgentMessageAt }`. Overview page renders a card showing connected/not-connected, and surfaces a warning state when there's no agent connected and end-user messages are unanswered. Solves the OSS bootstrapping confusion where a self-hoster's chat widget delivers messages into the void with no UI signal that nothing is listening on the agent side.

  Adds an `audiences` jsonb column on `api_keys` (default `['admin']`) and the credential resolver now reads it instead of hardcoding the audience set. This lets a key be minted with `audiences: ['admin', 'self_service']` so its realtime subscriptions are recognised as self-service-agent connections. Backwards compatible — existing rows default to admin-only.

### Patch Changes

- @getmunin/ui@0.17.0

## 0.16.1

### Patch Changes

- @getmunin/ui@0.16.1

## 0.16.0

### Minor Changes

- 109e723: Adds a CRM merge proposals review page to the dashboard. New REST controller exposes `GET /api/crm/merge-proposals`, `GET /api/crm/merge-proposals/:id`, `POST /api/crm/merge-proposals/:id/apply`, `POST /api/crm/merge-proposals/:id/dismiss` so the dashboard can list pending proposals and resolve them with one click. The page subscribes to the new `crm.merge_proposal.*` realtime events so the queue updates without polling, and falls back to a 60s poll. The "Needs attention" backlog tile gets a CRM merge counter that links to the page; nav adds a top-level "CRM merges" entry. en + nb i18n strings included.

### Patch Changes

- @getmunin/ui@0.16.0

## 0.15.0

### Patch Changes

- @getmunin/ui@0.15.0

## 0.14.0

### Patch Changes

- @getmunin/ui@0.14.0

## 0.13.0

### Minor Changes

- a61dd11: Add a "Needs attention" backlog card to the dashboard overview, plus a
  small `/api/overview/backlog` aggregator that returns counts of items
  across modules waiting on human or admin-agent attention.

  The card is a _signal_, not a CRUD surface — it tells the operator
  what to attend to (open conversations needing handover, KB curation
  candidates pending review) but the actual work still happens through
  the connected admin agent. This keeps the dashboard on-thesis ("the
  agent is the UI") while still giving operators a single place to see
  the backlog grow and shrink.

  Today the card surfaces:
  - conversations with `needsHumanAttention = true`
  - KB documents in the `kb-curation-inbox` space tagged `candidate`

  Future modules (CRM dirty-data, CMS stale-content, …) can extend the
  endpoint shape without controller refactoring — it returns a flat
  `{ key: count }` object.

### Patch Changes

- @getmunin/ui@0.13.0

## 0.12.0

### Patch Changes

- @getmunin/ui@0.12.0

## 0.11.0

### Patch Changes

- @getmunin/ui@0.11.0

## 0.10.0

### Patch Changes

- @getmunin/ui@0.10.0

## 0.9.1

### Patch Changes

- @getmunin/ui@0.9.1

## 0.9.0

### Minor Changes

- 19466a0: Localize all dashboard pages and UI components with [next-intl](https://next-intl.dev). Ships English (`en`) and Norwegian Bokmål (`nb`) message catalogs that consumers extend in their own `messages/{locale}.json`.

  **Breaking-ish (pre-1.0 minor):**
  - `next-intl` is now a required peer dependency of `@getmunin/dashboard-pages`. Consumers must wrap their app in `<NextIntlClientProvider>` and configure `next-intl/plugin` in `next.config.mjs`.
  - `GoogleButton.label` (in `@getmunin/ui`) is now required. Pass a translated label rather than relying on the previous English default.

  **What's translated:** all `dashboard-pages` exports (`AgentsPage`, `ApiKeysPage`, `TeamPage`, `AuditLogPage`, `UsagePage`, `EndUsersPage`, `ExportPage`, `DashboardPage`, `AcceptInvitePage`, `OrgSwitcher`) plus error messages mapped from stable backend codes (e.g. `SIGNUP_DOMAIN_NOT_ALLOWED`, `SIGNUP_INVITE_ONLY`).

  **Backend changes (`@getmunin/backend`):** `auth.config.ts` now emits two distinct codes (`SIGNUP_DOMAIN_NOT_ALLOWED` and `SIGNUP_INVITE_ONLY`) instead of a single `SIGNUP_NOT_ALLOWED`. Email templates (password reset, verification) move into `email-templates.ts` keyed by locale, with a default driven by `MUNIN_DEFAULT_LOCALE` (`en` | `nb`).

### Patch Changes

- Updated dependencies [19466a0]
  - @getmunin/ui@0.9.0

## 0.8.0

### Patch Changes

- @getmunin/ui@0.8.0

## 0.7.0

### Patch Changes

- @getmunin/ui@0.7.0

## 0.6.0

### Minor Changes

- 1aaaa24: Move suggestions feature out of OSS to a private feature board.

  The `suggestions` feature was structured as a Canny-clone but its `appScope`
  enum (`kb | conv | crm | core`) was hardcoded to Munin's own modules — the
  real intent was a vendor roadmap, not per-org product feedback.

  **Breaking changes (pre-1.0; consumers must update at the same minor):**
  - Removed `SuggestionsModule` from `@getmunin/backend-core`.
  - Removed `suggestions` and `votes` tables from `@getmunin/db`'s published
    schema. New OSS migration `0002_drop_suggestions.sql` drops the tables on
    fresh and existing installs (idempotent).
  - Removed RLS policies for `suggestions` / `votes` from `rls.sql`.
  - Removed `SuggestionsPage`, `CommunityBoardPage`, and the
    `publicSuggestionsMetadata` / `publicSuggestionsRevalidate` exports from
    `@getmunin/dashboard-pages`.
  - Removed `/api/suggestions` and `/api/public/suggestions` REST routes.
  - Removed five MCP tools (`suggestion_*`) from the OSS surface.
  - Removed `suggestions` from the data-export bundle.

  The replacement lives in a downstream package. Voting is now per-org instead of
  per-actor — one vote per `(suggestion_id, org_id)` so multiple
  users/agents in the same customer org collectively contribute one vote.
  The five MCP tool names are unchanged; admins/agents keep calling
  `suggestion_search`, `suggestion_create`, etc., but they hit the cloud
  schema.

  **OSS users who relied on the per-org board:** the feature is gone. Build
  your own roadmap using the existing CRM/CMS primitives or a third-party
  tool. (No public OSS deployment uses it pre-this release.)

### Patch Changes

- @getmunin/ui@0.6.0

## 0.5.0

### Patch Changes

- @getmunin/ui@0.5.0

## 0.4.0

### Patch Changes

- @getmunin/ui@0.4.0

## 0.3.1

### Patch Changes

- fe8fd21: TenancyInterceptor: bypass RLS for `actor.type === 'partner'`.

  Partner actors (in a downstream package) operate across multiple orgs they
  provisioned. Their controllers filter manually by `partner_id`. OSS
  never produces `'partner'` actors, so this branch is dead code there.

- Updated dependencies [fe8fd21]
  - @getmunin/ui@0.3.1

## 0.3.0

### Minor Changes

- 5c140d5: Add credential-resolver extension point to AuthGuard.

  `AuthGuard` now accepts an optional injected `AdditionalCredentialResolver[]`
  via the `ADDITIONAL_CREDENTIAL_RESOLVERS` token. When OSS's `resolveApiKey`
  returns null, each additional resolver gets a shot at the raw key.
  Downstream packages plug in via this token to recognize their own key
  kinds without touching OSS code.

  `looksLikeApiKey` regex broadened from `mn_(admin|dlg)_*` to `mn_[a-z]+_*`
  so additional kinds reach the resolver chain.

### Patch Changes

- Updated dependencies [5c140d5]
  - @getmunin/ui@0.3.0

## 0.2.0

### Minor Changes

- f3abef4: Add cross-org switcher endpoint + UI.
  - New `GET /api/orgs/me/memberships` — list every org the caller is a member of (id, name, slug, role, isDefault).
  - New `PATCH /api/orgs/me/memberships/active` — flip `is_default` so the next session-cookie request resolves to the chosen org.
  - New `<OrgSwitcher />` component in `@getmunin/dashboard-pages` that wraps both endpoints. Cloud's dashboard layout renders it in the header.

  OSS (single-tenant) installs see exactly one membership and don't render a switcher.

### Patch Changes

- Updated dependencies [f3abef4]
  - @getmunin/ui@0.2.0
