---
'@getmunin/dashboard-pages': minor
---

Make the console logo a link, and let the host decide where it goes.

`DashboardShell` and `ConsoleShell` take `brandHref`, defaulting to `/dashboard`. The sidebar console that replaced `DashboardTopbar` dropped the topbar's `<Link href={brandHref}>` around the mark, so the logo has not been clickable since; the default restores that rather than only adding a prop.

Absolute URLs render as a plain `<a>` instead of the i18n `Link`, which is the whole reason this needs a branch: `Link` prefixes the active locale, so a hosted deployment pointing the mark at its marketing site would otherwise navigate to `/en/https://example.com`. Only the mark is wrapped, never the whole lockup — the brand-text slot is `headSlot`, which in a multi-tenant deployment is an org switcher, and a button inside an anchor is neither valid nor clickable. All three instances get it: sidebar, mobile header, and the menu sheet.
