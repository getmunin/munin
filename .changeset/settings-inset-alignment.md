---
'@getmunin/dashboard-pages': patch
---

Settings pages sit on the same insets as the console.

The settings shell padded its own content area independently of the console pages: 24/48px horizontal against the console's 20/32px. Both shells use a 280px sidebar, so content began at 312px on Automation and 328px on Settings — a 16px jump every time you crossed between them. The shell now matches Automation exactly at both breakpoints.

Four settings pages bleed their horizontally-scrolling tables to the shell edge on mobile with a negative margin mirroring the shell's old padding; those move with it, so the bleed stays exact and the page does not gain a horizontal scrollbar.
