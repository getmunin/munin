---
'@getmunin/dashboard-pages': minor
---

Review splits into Waiting / Scheduled / Decided tabs, and owns the scheduled queue

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
