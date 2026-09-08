---
'@getmunin/dashboard-pages': patch
'@getmunin/ui': patch
---

fix(ui): make the console's smallest type readable, and stop Tailwind silently dropping 75 alpha colours

A second pass over the palette after #910, prompted by labels that still read as
grey noise. #910 audited token *pairs*; this one audits what the browser actually
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
  paper and **3.35:1** on the dark card, as 9px semibold author names *and* a 2px
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
