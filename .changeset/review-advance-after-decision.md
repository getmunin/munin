---
'@getmunin/dashboard-pages': minor
---

Deciding an item on the review page now opens the next waiting item instead of jumping to the Decided tab with the same item still open. A short confirmation ("Published · Spring menu", with a link to view it in Decided) sits above the next item for a few seconds, or above the empty state when the queue is clear.

The jump came from decided items sharing their id with the queue item they came from: once the Decided list reloaded, the still-open URL resolved to the Decided tab. The page now carries an explicit hand-off from the decided id to the next one until the URL catches up, so the order in which the queue reload, the Decided reload and the URL change land no longer matters. Only your own decisions advance the page — when someone else decides the item you have open, it still shows as resolved, with who decided it.

Scheduling (an outreach send time or a CMS publish time) advances the same way. The dashboard's toasts move to the bottom centre so they no longer stack on top of an embedded chat widget in the bottom-right corner.
