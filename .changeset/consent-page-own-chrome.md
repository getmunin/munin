---
'@getmunin/dashboard-pages': patch
---

Give the OAuth consent screen a head-only shell instead of the full console

An authorization request arrived framed by the whole dashboard — sidebar, nav counts,
alerts banner, user footer — none of which belongs on a page whose only question is
whether to hand a client a token.

`DashboardShell` now renders `/dashboard/oauth/consent` with a head-only shell: the brand
head, then the page. The head is the same `BrandHead` the console sidebar uses, fed by the
same `brand` / `brandHref` / `logoSrc` / `leftSlot` props, so a host that puts an
organization switcher in the sidebar gets that switcher here and one that passes no slot
gets its organization name — one contract, not two. `BrandMark` and the brand/slot
resolution move to `shells/brand-head.tsx`, shared by the sidebar, the mobile header and
the consent head so they cannot drift.
