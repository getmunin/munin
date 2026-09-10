# @getmunin/ui

## 5.22.0

### Patch Changes

- @getmunin/types@5.22.0

## 5.21.0

### Patch Changes

- Updated dependencies [b787e96]
  - @getmunin/types@5.21.0

## 5.20.0

### Patch Changes

- 09fae43: fix(ui): make the console's smallest type readable, and stop Tailwind silently dropping 75 alpha colours

  A second pass over the palette after #910, prompted by labels that still read as
  grey noise. #910 audited token _pairs_; this one audits what the browser actually
  paints, which is where the remaining failures were hiding.

  **Tailwind was discarding every alpha modifier on a shadcn alias.** `--foreground`,
  `--card`, `--secondary` and `--destructive` held finished colours (`rgb(15 20 25)`),
  and Tailwind can only inject `<alpha-value>` into a bare channel list — so it dropped
  the whole declaration instead. 75 utilities compiled to nothing: `dark:text-foreground/70`
  and `/80` (51 sites) left body copy, ledes, the sidebar's inactive items and the CRM
  merge pane falling back to their light-mode ink on a dark background at **1.57–1.83:1**,
  and `dark:bg-foreground/15`, `dark:bg-card/85`, `bg-destructive/5` and
  `border-destructive/40` painted nothing at all. The four aliases now resolve through
  `--foreground-rgb` / `--card-rgb` / `--secondary-rgb` / `--destructive-rgb` triples,
  with the plain alias derived from them, so no call site changed and all 75 utilities
  emit. Verified 0 → 1 occurrences each in the compiled stylesheet.

  **Labels get their own tier.** The console's mono uppercase labels ran 8–9.5px at
  `text-ink-mute`: 5.72:1 on paper, which clears AA and still reads as grey noise at
  that size — 81 sites in `dashboard-pages`, 15 more in the widget. They are now 10px
  `font-medium`, matching what `ui`'s own `Label`, `Table` head, `Tabs` and `Button`
  already shipped, and structural ones (section labels, column heads, field labels,
  eyebrows) take a new `--munin-fg-label` (`text-ink-label`) at 9.69:1 light / 10.99:1
  dark. Incidental metadata — timestamps, row counts — stays on the mute tier. Labels
  never shrink below 10px again: `type-floor.test.ts` fails the build on `text-[<10px]`.

  **Four more measured failures:**

  - `text-alert-bad-ink` is used both inside its tint and bare on the page (error
    eyebrows, an inline clause, the outreach and CMS notices), and had no dark value —
    **1.65:1** on ink. The alert family now flips as a set: bg `#331812`, ink `#F0A79B`
    (8.36:1 on its own tint, 8.08–9.44:1 on the three dark surfaces), border `#D2685A`.
  - The activity feed's column heads and clocks used `text-paper/45` and `/50` on the
    ink panel — **4.38:1** at 10px. Now `/70`, 9.01:1.
  - `text-ink-mute/80` on CMS block-prop labels — **3.71:1**. Now the label token.
  - `participantColor` was `oklch(0.55 …)` for both schemes — **4.36:1** worst-case on
    paper and **3.35:1** on the dark card, as 9px semibold author names _and_ a 2px
    bubble border. Lightness moves to `--munin-participant-l`: 0.5 light, 0.74 dark.

  **#910's dark mute lift broke the auth pages.** `AuthShell` and everything under it
  carry no `dark:` class at all — they are fixed light paper by design — so the dark
  `--munin-fg-3` landed at **3.21:1** there (2.45:1 on the invite tint) and the dark
  `--munin-rule-field` left inputs with a near-white 1px edge on white. They now pin the
  light ramp via `.munin-light-locked`, one place to hold the opt-out as the palette moves.

  Guarded by `tokens.contrast.test.ts` — 63 assertions over every foreground/background
  pair the design actually meets, in light, dark and light-locked. Reverting any value
  above fails it. Verified end to end against the running dashboard by sampling
  `getComputedStyle` on every leaf text node across 21 pages in both schemes and
  compositing each colour over its real backdrop: the only remaining report is the auth
  wordmark, a false positive — it is absolutely positioned over a sibling's `bg-paper`,
  so the DOM-tree backdrop walk reads the page background instead. Also confirmed at the
  stylesheet level (each of the 75 utilities goes 0 → 1 occurrences) and at the
  computed-value level. Note when checking that yourself: Tailwind only emits classes it
  finds in source, so probing an unprefixed name reports a false failure.

  Not fixed, reported separately: `/dashboard/oauth/consent` renders `bg-background`
  with light-only `text-ink`, `text-ink-soft` and `border-ink` outline buttons, so its
  dark mode needs a design pass rather than a token change.

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

### Patch Changes

- f781f5f: Reviewing a CMS draft now leads with the page itself. The drawer fetches the preview link as soon as the draft opens and embeds it in a sandboxed frame behind a Preview/Fields tab pair, with a direct "open on the site" link alongside. A frame that never paints — the site refuses to be embedded, or does not answer inside fifteen seconds — falls back to the field view with a marked tab, an explanation, and a retry, rather than leaving a blank rectangle. The old approach opened a blank tab first and navigated it after the link resolved, which browsers increasingly treat as a popup and which gave no signal when the preview failed.

  Every review pane's footer now fits one line on a phone. The primary action stretches to fill the row and the rest collapse into a bottom sheet behind a single "more actions" button, replacing footers that stacked three or four full-width buttons and pushed the content out of view. On mobile the panes also drop their own headers and eyebrows, since the surrounding shell already names the item. CMS drawers gain the same load-failed and loading states the other panes have, and their padding matches the rest of the console.

  Two visual corrections: the confidence, channel and kind badges in the review panes are `Pill`s rather than hand-rolled spans — which is what the new `fill="solid"` variant is for — and avatar chips use ink instead of cobalt, so cobalt stays the accent it is everywhere else.

- Updated dependencies [d443f42]
- Updated dependencies [356885c]
  - @getmunin/types@5.16.0

## 5.15.0

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

### Patch Changes

- @getmunin/types@5.12.0

## 5.11.0

### Minor Changes

- 9d09f89: Show on each data-connection card who can actually reach it.

  The Integrations page listed every connector in one undifferentiated section, so nothing told an operator that connecting Bing Webmaster Tools exposes no surface at all to the customer-facing chatbot, while connecting Gastroplanner lets customers cancel their own bookings. That is a material fact when you are about to hand a vendor credential over.

  Audience is a property of the domain's tool surface, not of the vendor, so it is derived from `ConnectorDomain` in the backend (`audienceForDomain`) and carried on both the vendor and connection DTOs rather than recomputed in the dashboard. `commerce` and `bookings` ship admin tools and a self-service half, so they read "Customers + team". `seo` is admin-only — its five `seo_*` tools are `audiences: ['admin']`, `seo:read` is absent from both `CONNECTOR_DOMAIN_SCOPES` and `SELF_SERVICE_SCOPES` — so it reads "Team only". Custom MCP servers are proxied only into end-user agent sessions, so they read "Customers only".

  No enforcement changes: the audience gate, the connector scope map and the delegated-token scope allow-list already decided this. The badge only makes the existing decision visible.

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

### Patch Changes

- bec14d1: Fix three mobile-viewport regressions in the dashboard shell.

  Side sheets were sized with `h-full` on a `position: fixed` element, which resolves against the initial containing block — on iOS Safari that is the _large_ viewport, so the bottom of every drawer sat behind the browser toolbar and the footer actions (approve, dismiss, cancel scheduled) were half-covered. They now use `100dvh` anchored to the top, which tracks the toolbar as it collapses and expands.

  The docs-link row under the Connect MCP snippet on Get started could not shrink: the docs URL is one long unbreakable token, so the flex row overflowed its card and pushed the copy button past the right edge of the viewport. The link may now wrap and the button no longer shrinks.

  The dashboard topbar used an 8px gap on mobile, which left the org selector nearly touching the logo once a `leftSlot` was supplied. Mobile now gets 16px; the desktop gap (which also has a rule between the two) is unchanged.
  - @getmunin/types@5.11.0

## 5.10.0

### Minor Changes

- 3136f2b: A curation candidate can now propose a new version of a document that already exists, instead of only a new document beside it.

  `kb_propose_curation_revision` files a proposed body against an existing `documentId`; `kb_publish_curation_revision` applies it as a new version of that document, so `kb_list_versions` and `kb_restore_version` roll a bad revision back. It takes two versions — the candidate text that was reviewed and the document text it was diffed against — and refuses if either moved, writing nothing. `kb_publish_curation_candidate` refuses a revision candidate rather than quietly publishing a duplicate.

  This is what a corrected fact should produce. A human editing an agent draft usually contradicts a document the draft was built from, and the old flow could only file a new FAQ beside the stale one, leaving the wrong text in place for the agent to retrieve again.

  Revisions share one review queue with new-document candidates: `kb_list_curation_candidates` carries `revisesDocumentId` plus the revised document's current title and version, and each surface branches per row — the dashboard drawer and the MCP Apps panel render a diff against the current text (new `BodyDiff`, backed by a dependency-free line differ in `@getmunin/types`), the control plane gains `POST /v1/kb/curation/candidates/:id/publish-revision`, and Slack shows the card without a publish button, since its approval value carries only one version. The panel's "loading" state for a candidate body was also unreachable — it reported a load failure while the fetch was still in flight.

  Curation decisions are now keyed by conversation **and** source message (`kb_curation_decisions.source_message_id`). One conversation can legitimately surface several corrections across turns; the old conversation-wide key closed it to curation after the first. Decisions recorded before this keep the whole-conversation lock, so nothing already dismissed reopens. Related: `kb_propose_curation_candidate` accepted `sourceMessageIds` and silently dropped it — the first entry is now persisted.

  `skill://kb/review-content` delta mode now prefers a revision over a new document and says how much to change; `kb_get_document`, `kb_list_curation_decisions` and `kb_propose_curation_revision` are added to the skill's runner allow-list. The skill's step 0 has always required `kb_list_curation_decisions`, which the runner could not call, so "skip already-decided sources" silently never ran.

### Patch Changes

- Updated dependencies [3136f2b]
- Updated dependencies [3136f2b]
- Updated dependencies [b8690cb]
  - @getmunin/types@5.10.0

## 5.9.0

## 5.8.0

## 5.7.0

## 5.6.0

## 5.5.0

## 5.4.0

## 5.3.0

## 5.2.2

## 5.2.1

## 5.2.0

## 5.1.0

## 5.0.2

## 5.0.1

## 5.0.0

## 4.81.0

## 4.80.1

## 4.80.0

## 4.79.0

## 4.78.0

## 4.77.0

## 4.76.0

## 4.75.0

## 4.74.0

## 4.73.0

## 4.72.0

## 4.71.0

## 4.70.1

## 4.70.0

## 4.69.3

## 4.69.2

## 4.69.1

## 4.69.0

## 4.68.0

### Patch Changes

- d4bfeb7: 1px hairlines everywhere, tuned rule weight, and honest bookings connector copy:

  - All `0.5px` borders and inset-shadow outlines are now `1px` — sub-pixel widths rendered inconsistently across devices.
  - Rule alpha compensates for the doubled width (light `0.145 → 0.09`, dark `0.2 → 0.13`) and is now single-sourced from the `--munin-rule-*-alpha` tokens; the tailwind preset, Button, and the team-page role select reference the tokens instead of hardcoding alphas.
  - Buttons, pills, auth-shell CTAs, and the team role select draw their outline with a real `border` again instead of the inset box-shadow workaround (iOS Safari only dropped sub-pixel borders; integer widths are safe). Pill padding compensates so rendered size is unchanged; pill outlines soften to 55% `currentColor`.
  - Dashboard/settings topbars adopt the marketing-site chrome: translucent blurred bar with a soft always-on hairline instead of a full-ink border. System-alerts banner border softens from full ink to `ink/20`.
  - Dialog field hints are smaller and grayer (`text-xs text-ink-mute`) to read as metadata next to labels.
  - Gastroplanner connect dialog now advertises the full bookings surface (check availability + book, change/cancel) instead of lookup only, and the "read directly — never copied" note is reworded to "live against the vendor — nothing stored in Munin" since bookings writes. Sonner toasts get their intended ink border (the CSS var name was previously mistyped and ignored).

- 8788bd4: Localize the smart/fast model-tier badges (nb: "rask") and surface connector config validation as inline field errors: invalid connector config now returns structured `fieldErrors` instead of a raw zod JSON blob, and the connect dialog highlights the offending inputs with localized per-field messages instead of toasting. The Tailwind preset now defines the `aria-invalid` variant (absent from Tailwind v3 defaults), so the destructive border/ring on invalid inputs actually renders.

## 4.67.2

## 4.67.1

## 4.67.0

## 4.66.1

## 4.66.0

### Minor Changes

- b84577f: Package the Tailwind theme and brand fonts in @getmunin/ui.

  - New `@getmunin/ui/tailwind-preset` export carries the whole Munin theme (token-mapped palette, semantic shadcn colors, radii, fonts, motion). Consumers shrink their Tailwind config to `presets: [muninPreset]` plus their own `content` globs; the OSS web app now does exactly that.
  - `styles/fonts.css` now resolves the woff2 files shipped inside the package (`src/fonts/`) via relative URLs instead of assuming the consumer hosts them at `/fonts/…`. Next emits them as hashed static assets; Vite (singlefile) inlines them. `apps/web/public/fonts` and the inspector-app's private font copies are gone.
  - The inspector-app build now compiles Tailwind (preset + PostCSS), so future panel views can use @getmunin/ui components directly; importing them through the barrel is tree-shaking-safe (`sideEffects` is now declared) and does not pull next-themes or sonner into the iframe bundle.

## 4.65.0

## 4.64.0

## 4.63.1

### Patch Changes

- 9a87f0b: Fix dashboard overview row heights and pill text centering. Queue rows no longer grow taller on hover — the right-hand slot now always reserves the action buttons' height (`h-7`) whether it shows the timestamp or the hover-revealed approve/dismiss buttons. The "open conversations" rows now reserve the same height, so both sections line up at a consistent row height. Pills (e.g. the `CMS` badge) get `leading-none` so their uppercase text is vertically centered within the badge instead of floating high.

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

## 4.56.0

### Patch Changes

- ccbc3a4: Update UI runtime dependencies within range: lucide-react 1.21, @base-ui/react 1.6, tailwind-merge 3.6, next-intl 4.13, and @react-email/render 2.0.9.

## 4.55.0

## 4.54.0

## 4.53.0

### Patch Changes

- 82fef68: Redesign the onboarding "Lift-off" summary's website-import section into three real states — importing, failed, and succeeded — driven by live crawl progress.

  The web crawler now emits incremental progress (`{ total, done, recentPaths }`) as it reads pages; the runner persists it to a new nullable `curator_jobs.progress` column (throttled, best-effort), and the curator-job DTO surfaces it via `GET /v1/curator/jobs/:id`. The summary screen polls that to show a live `done / total` counter, a progress bar, and the paths being read while importing; the imported page count and duration on success; and the failure reason plus an inline **Retry import** on failure. A new internal `POST /v1/curator/jobs/:id/progress` endpoint backs the out-of-process runner path.

  Also align the full-screen loading screens with the page background: `AuthLoading` (and the root route loader) now paint `bg-bone` so the loader no longer flashes the lighter paper surface before the bone-backed page resolves.

## 4.52.1

## 4.52.0

## 4.51.4

## 4.51.3

## 4.51.2

## 4.51.1

## 4.51.0

## 4.50.1

## 4.50.0

## 4.49.0

## 4.48.0

## 4.47.0

## 4.46.0

## 4.45.1

## 4.45.0

## 4.44.1

## 4.44.0

## 4.43.2

## 4.43.1

## 4.43.0

## 4.42.0

## 4.41.1

## 4.41.0

## 4.40.4

## 4.40.3

## 4.40.2

## 4.40.1

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

- bd8cd79: Surface CMS draft entries in the dashboard approval queue. Adds `CmsService.listDraftEntries` + `archiveEntry`, a new `/v1/cms/drafts/*` control endpoint family for approve/schedule/dismiss/patch, and a dedicated CMS drawer with metadata grid, cover-image preview, inline body editor, and a schedule popover. The shared `QueueDrawer` is also split into per-kind files (`queue-drawers/{kb,crm,outreach,feedback,cms}.tsx`) backed by a small dispatcher so adding the next kind is a new file rather than another branch.
- f6cb178: Inputs and dashboard reply/edit textareas now render at `text-base` (16px) on mobile and `md:text-sm` (14px) from the `md` breakpoint up. iOS Safari auto-zooms on focus whenever the focused field's effective font-size is below 16px; bumping mobile sizes avoids that without disabling viewport zoom (which is a WCAG 1.4.4 regression). Desktop density is unchanged.

## 4.31.0

## 4.30.0

## 4.29.2

## 4.29.1

## 4.29.0

## 4.28.0

## 4.27.1

## 4.27.0

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

### Patch Changes

- cedba8d: Adds an opt-in feedback module: OSS instances can collect feedback locally and, with an org admin's explicit approval, forward each item to `feedback.getmunin.com`. Gated by `MUNIN_FEEDBACK_ENABLED` (default `false`) — when disabled, no controllers, no MCP tools, no outbound code path is loaded.
  - `db`: new `feedback_outbox` table (org-scoped, RLS) for pending items and `system_config` for the deployment-wide `instance_id`. Drizzle migration `0032_feedback_outbox.sql`.
  - `backend-core`: `@Global() FeedbackModule` exposing `feedback_{create,list,get,approve,reject}` MCP tools and `POST /v1/feedback` + `/:id/{approve,reject}` REST routes. `InboxController` takes `@Optional() FeedbackService` so pending items appear inline in `GET /v1/inbox`'s queue when the module is loaded. Approval signs the outbound payload with `HMAC(instance_id, "munin-feedback-intake-v1")` so cloud can verify by re-deriving. Also renames `assistants.controller`'s `getOrCreate()` → `findOrCreateAssistant()` to match the dominant `findOrCreate*` convention.
  - `dashboard-pages`: extends `QueueItem` / `useQueueBuilder` / `QueueRow` / `QueueDrawer` with a `feedback` kind so pending items render in the unified inbox queue, with attribution copy disclosing data flow to Munin developers.
  - `ui`: new `feedback` tone variant on `Pill`.

## 4.19.4

## 4.19.3

## 4.19.2

## 4.19.1

## 4.19.0

## 4.18.0

## 4.17.0

### Patch Changes

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

## 4.16.0

## 4.15.0

## 4.14.0

## 4.13.0

## 4.12.0

## 4.11.0

## 4.10.0

## 4.9.0

## 4.8.0

## 4.7.1

## 4.7.0

## 4.6.1

## 4.6.0

## 4.5.1

## 4.5.0

## 4.4.1

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

## 4.3.0

## 4.2.0

## 4.1.1

## 4.1.0

## 4.0.0

## 3.9.1

## 3.9.0

### Minor Changes

- ed2bb6b: Add generic `SmtpMailer` provider to `@getmunin/core`.

  Covers any SMTP-speaking transactional email service (Scaleway TEM, Postmark,
  Mailgun, Postmark, etc.) via a single implementation. Activated by setting
  `MUNIN_MAIL_PROVIDER=smtp` along with `MUNIN_SMTP_HOST`, `MUNIN_SMTP_PORT`,
  `MUNIN_SMTP_USER`, `MUNIN_SMTP_PASSWORD` (optional `MUNIN_SMTP_SECURE=1` for
  implicit-TLS on port 465). `nodemailer` is the underlying transport.

## 3.8.0

### Minor Changes

- a3f532e: Onboarding cleanup, agent-config hot-reload, provider auth validation.
  - Dropped the chatbot-name field from the onboarding form; new orgs seed with an empty name so step 1 is shown until the user names their bot.
  - Removed the unused `orgs.slug` column (migration 0027); CMS delivery routes (`/api/v1/cms/:orgId/...`) and the matching SDK clients now key on `orgId` rather than the slug.
  - `AgentConfigService` validates provider credentials _before_ persisting — OpenRouter is probed via `/auth/key` (since its `/models` endpoint is public), Anthropic/OpenAI rely on `/models` 401. Bad keys no longer silently overwrite a working config.
  - Saving agent config emits `agent.config.updated` via the WebhookDispatcher; the realtime gateway broadcasts it and `AgentHostRunner` respawns the affected runner — model/provider changes apply without a backend restart.
  - Models picker reconciles a stale stored model slug against the fetched model list at render time, so the dropdown can't round-trip an unknown id back to the server.
  - Chat widget no longer filters the current session's conversation out of the past-conversation list — going back from a fresh conversation shows it.

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

## 3.4.1

## 3.4.0

## 3.2.1

## 3.2.0

## 3.1.0

### Minor Changes

- 23a22f8: Add shared auth-shell components for the redesigned auth pages: `AuthShell`, `AuthEpigraph`, `AuthHeading`, `AuthSubheading`, `AuthFootnote`, `AuthDivider`, `AuthField`, `AuthLabel`, `AuthInput`, `AuthSubmit`, `AuthOAuthButton`, `AuthFieldHint`, `ErrorAlert`, `AuthInviteCard`, plus the `OSS_AUTH_FOOTER` / `CLOUD_AUTH_FOOTER` constants and `AuthState` type. Also adds `--munin-auth-navy`, `--munin-alert-bad-*`, and `--munin-invite-{good,bad}-*` design tokens to `@getmunin/ui` and exposes them as Tailwind utilities (`bg-auth-navy`, `bg-alert-bad`, `bg-invite-good`, etc.).

## 3.0.0

## 2.5.1

## 2.5.0

## 2.4.0

## 2.3.0

## 2.2.0

## 2.1.0

## 2.0.0

## 1.0.0

## 0.25.0

## 0.24.1

## 0.24.0

## 0.23.3

## 0.23.2

## 0.23.1

## 0.23.0

## 0.22.0

## 0.21.0

### Patch Changes

- 914477f: Unified Review surface for KB suggestions and CRM merges, with structured-field-driven curation candidates.

  **Dashboard** — replaces the standalone `/dashboard/crm-merge-proposals` page (now redirects) with `/dashboard/review`, a tabbed page combining KB suggestions and CRM merges. Tab counts update live from `kb.*` and `crm.merge_proposal.*` realtime events; the home overview backlog rows for both queues now link into Review. The KB tab renders each candidate's body as markdown (via `react-markdown`, peer dep) inside a `prose` block; `h1`–`h6` are flattened to bold paragraphs so the body never visually competes with the candidate title. Each card has its own "Publish to:" picker pre-selected to the candidate's proposed target space, with a per-card override.

  **Backend — KB candidate DTO** — new structured fields on the curation candidate response:
  - `proposedTargetSpaceSlug: string | null` — extracted from the candidate's `target:<slug>` tag.
  - `sourceConversationId: string | null` — extracted from the `source:<id>` tag.

  Two new service methods (`KbService.listCurationCandidates`, `KbService.getCurationCandidate`) return these fields directly so the dashboard never has to regex over body prose. New REST routes at `/api/kb/curation/candidates` (list/get/publish/dismiss) and `/api/kb/spaces` (list) back the new UI. The "Source conversation / Proposed target space" footer that `proposeCurationCandidate` used to splice into the body is gone — the tags carry the same data and the structured fields surface it.

  **KB curation skill prompt** — Step 4 now sets explicit formatting rules for candidate bodies: subject is the title, body is plain prose with bold/italic/inline-code/short bullets allowed, **no `#`/`##`/`###` headings**, no JSON-escaping the body string, no tables/HTML/images. The "Drafted from conversation …" footer example is gone (now redundant with structured fields). This makes review-UI rendering predictable and prevents big duplicate-of-title H1s in the body.

  **UI fix** — `TabsTrigger` previously used `data-[selected]:` for the active-tab styling, but `@base-ui/react` Tabs emit `data-active`. The selected pill never highlighted. Fixed.

## 0.20.0

## 0.19.0

## 0.18.0

## 0.17.0

## 0.16.1

## 0.16.0

## 0.15.0

## 0.14.0

## 0.13.0

## 0.12.0

## 0.11.0

## 0.10.0

## 0.9.1

## 0.9.0

### Minor Changes

- 19466a0: Localize all dashboard pages and UI components with [next-intl](https://next-intl.dev). Ships English (`en`) and Norwegian Bokmål (`nb`) message catalogs that consumers extend in their own `messages/{locale}.json`.

  **Breaking-ish (pre-1.0 minor):**
  - `next-intl` is now a required peer dependency of `@getmunin/dashboard-pages`. Consumers must wrap their app in `<NextIntlClientProvider>` and configure `next-intl/plugin` in `next.config.mjs`.
  - `GoogleButton.label` (in `@getmunin/ui`) is now required. Pass a translated label rather than relying on the previous English default.

  **What's translated:** all `dashboard-pages` exports (`AgentsPage`, `ApiKeysPage`, `TeamPage`, `AuditLogPage`, `UsagePage`, `EndUsersPage`, `ExportPage`, `DashboardPage`, `AcceptInvitePage`, `OrgSwitcher`) plus error messages mapped from stable backend codes (e.g. `SIGNUP_DOMAIN_NOT_ALLOWED`, `SIGNUP_INVITE_ONLY`).

  **Backend changes (`@getmunin/backend`):** `auth.config.ts` now emits two distinct codes (`SIGNUP_DOMAIN_NOT_ALLOWED` and `SIGNUP_INVITE_ONLY`) instead of a single `SIGNUP_NOT_ALLOWED`. Email templates (password reset, verification) move into `email-templates.ts` keyed by locale, with a default driven by `MUNIN_DEFAULT_LOCALE` (`en` | `nb`).

## 0.8.0

## 0.7.0

## 0.6.0

## 0.5.0

## 0.4.0

## 0.3.1

### Patch Changes

- fe8fd21: TenancyInterceptor: bypass RLS for `actor.type === 'partner'`.

  Partner actors (in a downstream package) operate across multiple orgs they
  provisioned. Their controllers filter manually by `partner_id`. OSS
  never produces `'partner'` actors, so this branch is dead code there.

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

## 0.2.0

### Minor Changes

- f3abef4: Add cross-org switcher endpoint + UI.
  - New `GET /api/orgs/me/memberships` — list every org the caller is a member of (id, name, slug, role, isDefault).
  - New `PATCH /api/orgs/me/memberships/active` — flip `is_default` so the next session-cookie request resolves to the chosen org.
  - New `<OrgSwitcher />` component in `@getmunin/dashboard-pages` that wraps both endpoints. Cloud's dashboard layout renders it in the header.

  OSS (single-tenant) installs see exactly one membership and don't render a switcher.
