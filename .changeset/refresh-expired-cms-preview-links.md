---
'@getmunin/dashboard-pages': patch
---

Refresh a CMS preview link before its token expires. Review used to keep the first preview link it fetched for each draft for as long as the page was open. Preview tokens last an hour, so returning to a draft later loaded the site's preview with an expired token and showed its "invalid preview token" page until a hard refresh. The pane now fetches a new link when the cached one is within five minutes of expiry, and schedules one ahead of time while a draft stays open.
