---
'@getmunin/dashboard-pages': patch
---

Render `DashboardTopbar`'s `leftSlot` on mobile. The slot lived in a `hidden md:flex` container, so cloud's org switcher was unreachable below the `md` breakpoint — the topbar showed the centered brand label instead, with no way to switch orgs on a phone. The slot now renders at every width and replaces the brand label (as it already did on desktop); the centered mobile brand is kept only when no slot is supplied. Topbar gaps tighten to `gap-2` under `md` so a switcher fits next to the logo.
