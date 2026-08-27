---
'@getmunin/dashboard-pages': minor
---

Settings cards adopt the Oversight card layout: status sits beside the kind rather than under
the name, and the footer is ruled with its meta on the left and its actions on the right. One
change, applied everywhere the shared card is used — Channels, Trackers and Integrations.

Also closes a role gap. Settings panes have always been admin-only and redirect anyone else
back, but the console nav was offering the link to every role, so a support agent got a menu
entry that bounced them. Workspace is now admin-gated in the nav, the overview sends a
non-admin to the review queue instead of rendering an admin landing page, and the mobile
menu sheet explains the reduced set rather than leaving it unexplained.
