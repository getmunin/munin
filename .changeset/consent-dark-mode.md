---
'@getmunin/dashboard-pages': patch
---

OAuth consent screen: readable in dark mode. Body text, inline emphasis, scope pills, the reassurance callout and the Authorize / Deny / Cancel buttons used the fixed light ink, so on a dark system scheme they rendered dark on dark. Every state (request, media, blocked, wrong account, expired, granted, denied) now carries the same dark variants as the `@getmunin/ui` buttons and the rest of the dashboard.
