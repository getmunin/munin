---
'@getmunin/dashboard-pages': patch
---

One row primitive behind every queue list, and one meta-line vocabulary behind every row.

The dashboard, Conversations and Review pages between them render four list rows — conversations, waiting, scheduled, decided — that were four independent implementations of the same idiom. Each carried its own copy of the `role="button"` + Enter/Space handling, the `px-5 py-3.5` border-bottom row, the hover, the `--qfade` dim, and the active treatment. The active treatment was byte-identical in all four, which is what a shared component looks like before someone extracts it.

`QueueRow` now owns the chrome and exposes four slots — `code`, `title`, `meta`, `trailing` — with `RowTime` and `RowNote` for the trailing column. The four rows became thin callers, and the differences that were drift rather than meaning are gone:

- **One title origin.** Conversations put their channel `Pill` in a 52px grid column; review and scheduled used `RowCode` at `w-14`; decided had no code column at all, so its titles started 66px to the left of every other list. All four now sit in the same 52px column, and decided gains the `KB` module pill it was missing — a published article and a dismissed merge no longer render identically.
- **One timestamp column.** Ages were lowercase in two lists, uppercase in a third, and inlined into the mono meta line in the fourth. They are now a `RowTime` in the trailing column everywhere. Scheduled keeps cobalt, because "this ships without you" is meaning, not styling.
- **One row height.** Scheduled titles wrapped to two lines while every other list truncated to one.
- **One second line.** The meta line settles on the muted tone (`text-ink-mute` / `dark:text-foreground/50`) in all four lists rather than the darker `text-ink-soft` the conversation preview used, so the title carries the row and the second line stays subordinate. Decided keeps its outcome word in ink, which now reads as emphasis against the mute rather than competing with it.

The second line had a subtler problem: `QueueItem.snippet` was built for every kind in `inbox-data.ts`, and then `ReviewRow` ignored it and computed a *second* meta line from its own `dashboard.console.review.meta*` keys. Same item, two vocabularies, and which one you saw depended on which list you were in — the waiting tab said `sarah@…`, and the same proposal's snippet said `sarah@… — Hi Sarah, following up…`. The review wording (the terser, row-shaped one) now lives in the `overview.queue` snippet keys as the single source, `useMetaLine` is deleted along with the duplicate key set, and rows read `item.snippet` everywhere. No visible change to the waiting list: it already showed this wording.

The outreach pane's "Reply from" quote was the one place the old snippet was actually rendered, so it now builds that preview from `item.raw` directly and shows exactly what it showed before. (It quotes our own draft body under a "Reply from" label, which looks wrong but is untouched here.)
