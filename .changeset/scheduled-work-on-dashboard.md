---
'@getmunin/backend-core': patch
'@getmunin/dashboard-pages': patch
---

Surface scheduled CMS publishes on the dashboard, alongside the scheduled outreach sends that were already there, and let both be opened read-only.

Scheduled CMS entries were invisible in the dashboard. `CmsService.listDraftEntries` only ever returned `status='draft'`, and the dashboard has no CMS browsing page — the queue drawer is the sole CMS surface. So the moment an operator scheduled a draft from that drawer it vanished from the product: no way to see that a publish was pending, no way to check the date, no way to call it off. It reappeared only when the worker published it. `listScheduledEntries` now backs a `queue.cmsScheduled` array on `/v1/inbox`, ordered soonest-first.

The old `ScheduledSendsSection` becomes `ScheduledSection`, covering both kinds in one chronological list so "scheduled" reads as one concept rather than an outreach quirk. Rows show a relative countdown rather than a timestamp — "in 4h" is what you scan an agenda for, and the exact time is one click away in the drawer's standing-order strip — so `useRelative` gains a future-facing `useCountdown` sibling; the existing helper only subtracts in one direction and reports every future timestamp as "just now".

The queue section is renamed **Waiting on you** (nb: *Venter på deg*). "Queue" named the data structure rather than the reader's relationship to it, and the new name earns its place by contrasting with Scheduled: waiting on *you* versus waiting on the clock — the same distinction the read-only drawer draws with "nothing to approve — this runs on its own". "Needs your attention" was the other candidate and was rejected for overclaiming against Live Now, which sits directly above it and genuinely does need attention first. `dashboard.overview.queue.empty` ("Queue is clear") was removed rather than reworded: nothing has ever rendered it, and its `<accent>` markup had no chunk renderer on this surface.

Both the queue and scheduled rows drop the per-kind `Pill` for a fixed-width cell holding a shape glyph and a short mono code (`KB`, `CRM`, `OUT`, `CMS`, `FBK`). The pill's width tracked the length of its label, so every title started at a different x and the eye had no edge to run down — the badge was decoration paid for in scannability. The glyphs (hollow circle, diamond, filled circle, square, triangle) are inline SVG rather than `■ ● ○ ◆` text, which falls back to different fonts per platform and breaks both the size and the baseline in a column whose only job is alignment. Shape is pre-attentive and encodes without relying on hue, so the modules separate at a glance and stay separable for colourblind readers. Pills stay in the drawers, where there is one and nothing to align against.

The two sections are one grid: same code cell, same title x, same right-aligned time column, so the eye keeps both edges scrolling from one to the other. An earlier pass led the scheduled rows with a wide date rail, which read well in isolation but put the two sections' titles ~285px apart and made them look like unrelated tables.

Rows open a read-only drawer that reuses the CMS and outreach drawers behind a `readOnly` prop, so the content renders through exactly the code that renders it for review. The read-only state is marked three ways, because a drawer that looks editable invites typing: a cobalt SCHEDULED pill in the header, a standing-order strip above the content stating what fires and when, and a footer with no accent-filled primary — every other drawer in the dashboard leads with one. `⌘↵` is inert there.

Calling off a scheduled publish returns the entry to `draft` and puts it back on the review queue, mirroring the existing outreach cancel; unlike outreach it takes no reason, since nothing left the building. `GET /v1/cms/drafts/:id` already resolved scheduled entries, so the drawer needed no new read endpoint — only `POST /v1/cms/drafts/:id/unschedule`, which rejects an entry that is not scheduled rather than silently drafting a published one.

Two fixes found along the way:

`CmsService.transition` did not clear `scheduledAt` on the `draft` branch, only on `published` and `archived`. The `publish-entry` skill already told agents to `cms_unpublish_entry` "to clear the schedule" — that is now true rather than aspirational. Without it an unscheduled entry keeps a stale timestamp, harmless to the worker (it filters on status) but a phantom date to anything reading the column.

The dashboard's realtime filter did not match `cms.entry.*`, so a scheduled publish firing left the list stale until the next full load. Already true for the CMS drafts queue before this change.
