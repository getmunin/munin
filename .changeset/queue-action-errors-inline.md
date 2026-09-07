---
'@getmunin/dashboard-pages': patch
---

Report publish and dismiss failures inline instead of as a toast.

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
