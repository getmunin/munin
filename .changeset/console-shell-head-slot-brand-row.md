---
'@getmunin/dashboard-pages': patch
---

Give `ConsoleShell`'s `headSlot` the brand text's place instead of a row of its own.

The sidebar console shell that replaced `DashboardTopbar` dropped the slot's contract along with the topbar. The topbar rendered `leftSlot` **instead of** the brand text (`leftSlot ? … : brand`); the sidebar renders the brand row unconditionally and then drops `headSlot` underneath it, outside the row's `px-5`. OSS never noticed — `apps/web` passes no `headSlot` — but cloud passes its org switcher there, so hosted Munin shipped the product name on one line and an unpadded, flush-left org switcher on the next.

`headSlot` now takes the brand text's place in the brand row, which is what the switcher is built for: its `-mx-2.5` cancels the button's own `px-2.5` so the org name lands exactly where the brand text did, beside the logo. `brand` still names the product in the mobile header and the menu sheet, and the fallback keeps every caller that passes no slot pixel-identical.

The mobile sheet gets the slot too, below the title. Since the shell rework there was no way to switch organization on a phone at all — the slot rendered only in the desktop sidebar, which is hidden under `md`.
