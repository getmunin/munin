---
'@getmunin/dashboard-pages': patch
---

Fix several mobile/touch dashboard UI issues

- Email channel dialog: the focused-input ring on the leftmost field was clipped, because `overflow-y-auto` forces `overflow-x` to compute as `auto` too, and the scrolling wrapper had no padding of its own to give the ring room. Added a small inset/outset pair so the ring renders without shifting any content.
- Settings topbar: the mobile menu button had a border (`variant="outline"`) inconsistent with the borderless cog icon elsewhere; switched to `variant="ghost"`.
- Settings topbar back arrow and dashboard topbar cog icon were styled gray-by-default with hover turning them black — correct for a mouse, but permanently gray on a touch device with no hover state. Both now force black via `[@media(hover:none)]`, leaving the hover-capable (desktop) behavior unchanged.
- Team page: the members and pending-invitations tables used a fixed `min-w-[640px]` with horizontal scroll on narrow viewports. Below `md`, both now render as a stacked card list instead — members show name/email, then role select + edit/remove actions in one row (role stays visible since it's the only place to change it, unlike the edit dialog which only renames); invitations show email, then role chip + revoke in one row, matching the same alignment pattern.
