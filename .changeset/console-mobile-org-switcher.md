---
'@getmunin/dashboard-pages': patch
---

fix(dashboard): the mobile console head identifies the org, not the product

The desktop sidebar has always preferred `headSlot` over the `brand` string — in
cloud that slot is the org switcher, so the sidebar reads "Acme AS" while the
mobile header two breakpoints away read "Munin Cloud". Same for the slide-in
menu, which stacked the brand line *and* the switcher, so the product name got
the heading treatment and the thing you actually need on a phone sat under it.

Both now follow the sidebar's rule: render `headSlot` where it exists, fall back
to `brand` where it doesn't. Self-hosted OSS passes no slot and is unchanged.

The sheet keeps a `SheetTitle` either way — visually hidden when the switcher
takes the row — so the dialog still has an accessible name, and the switcher is
no longer nested inside a heading element.
