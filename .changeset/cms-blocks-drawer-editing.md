---
'@getmunin/dashboard-pages': minor
---

Render and edit CMS blocks in the draft approval drawer. Block-typed fields (e.g. an article body) previously fell through to a raw JSON dump; they now render as labeled block cards — each prop shown through its own field viewer (markdown, assets, etc.). In edit mode you can change block prop values, replace inline assets, add blocks (by type), remove them, and reorder them. Saving converts expanded asset props back to ids and restores inline `asset://` references so block content round-trips without losing asset links.

Also: the CMS draft drawer's `select` fields now use the shared `NativeSelect` (consistent chevron with the rest of the dashboard instead of the browser-default arrow), and the outreach draft drawer's "Edit" action is now disabled while an approve/dismiss is in flight, matching the other queue drawers.
