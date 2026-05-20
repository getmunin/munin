---
'@getmunin/dashboard-pages': major
---

Remove `OrgSwitcher` from `@getmunin/dashboard-pages`. OSS is single-tenant and never used it; cloud should ship its own switcher into the existing `leftSlot` on `DashboardShell` / `DashboardTopbar`. Also: when `leftSlot` is provided, it now replaces the brand text in the topbar instead of rendering alongside it.
