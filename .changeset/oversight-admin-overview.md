---
'@getmunin/dashboard-pages': minor
---

Admin overview reworked for the Oversight design. Two summary rows sit above the queue —
live conversations and pending learning — and the queue and scheduled rows stack into
meta / title / note / actions on a phone instead of truncating a single line.

Row actions are no longer hover-only. They stay hidden until hover on a fine pointer, as
before, but are permanently visible wherever the pointer is coarse, because a touch
screen has no hover state and the buttons were simply unreachable there.

Queue rows also gain **Schedule** for the kinds whose approve path accepts a time
(outreach proposals and CMS drafts), which opens the item's own scheduler rather than
duplicating a datetime picker in the row.

Fixes a scheduling bug along the way: the overview passed an argument-less approve handler
to the queue drawer, so a send time chosen in the outreach scheduler was dropped and the
proposal went out immediately.

Usage tiles now sit two-up on a phone instead of collapsing to a single column.
