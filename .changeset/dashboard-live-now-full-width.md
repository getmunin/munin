---
'@getmunin/dashboard-pages': patch
---

Dashboard overview: the Live Now section's tinted background now spans the full page width instead of stopping at the page's `max-w-7xl` content cap. The section uses a full-bleed `w-screen` breakout and keeps inner content aligned via an inner `max-w-7xl` container. The dashboard shell `<main>` gets `overflow-x-clip` so the breakout can't introduce a horizontal scrollbar on browsers that reserve space for the vertical scrollbar.
