---
'@getmunin/dashboard-pages': minor
---

Conversations becomes a destination of its own. `/dashboard/conversations` is the review
queue — search, then Needs you / In progress / Open, with claim state on every row. From
`lg` up it is the design's two-pane console, list beside detail; below that it is a list
that opens `/dashboard/conversations/[id]` as a full screen with the actions pinned to the
bottom, because a phone has no room for two panes.

The conversation detail body is now one component with three presentations — drawer, pane
and page — so the overview drawer, the desktop pane and the mobile route cannot drift
apart.

Search filters the loaded page on the client across customer, subject, preview and
`#displayId`; there is no conversation-search endpoint to call yet.
