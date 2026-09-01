---
'@getmunin/dashboard-pages': minor
---

Console page headers share one component. Learning, Automation and Conversations each hand-rolled a `<header>` with copy-pasted eyebrow, title and lede classes, which had already drifted: all three set the title to `leading-tight` (1.25) where the console kit specifies `line-height: 1` and the settings `Hero` uses `1.05`, so console titles were looser than both — visible whenever a title wrapped.

`ConsoleHero` mirrors `Hero`'s API (`eyebrow` / `title` / `lede` / `actions`) on console-kit values: cobalt eyebrow rather than muted, a 36px serif title, and a 14px lede capped at 52ch. Titles style their own `<em>` through a descendant selector, so pages pass `t.rich('title', { em: (chunks) => <em>{chunks}</em> })` exactly as the settings pages do instead of repeating the italic-cobalt classes. Learning and Automation now render it; Automation's 7-day auto-rate moves into the `actions` slot. Conversations keeps its own markup — it is the narrow list pane, with a smaller title and a search input inside the header — but picks up the same corrected leading.

The rule under the header is gone from all three, so the console pages agree with each other. Note this departs from the kit, where `.c-inbox-head` carries `border-bottom: 1px solid var(--ink)`.

Learning gains a lede. Every settings page and Automation already had one, leaving Learning the only page in the product whose header stopped at the title; `lede` is now an explicit per-page choice rather than an omission.
