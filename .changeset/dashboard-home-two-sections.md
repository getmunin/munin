---
'@getmunin/dashboard-pages': patch
---

Rebuild the dashboard home as two sections that link out, and retire the drawers.

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
