---
'@getmunin/dashboard-pages': patch
---

Review: the next item's approve and dismiss buttons no longer stay disabled after a quick decision. The inbox tracked one shared "pending" flag that stayed on until the deciding action's own `/v1/inbox` refresh returned, while the realtime-triggered refresh had usually already removed the decided item and opened the next one. Pending is now tracked per item, so only the item being decided is locked. Inbox refreshes also ignore a response that arrives after a newer one, so an out-of-order reply can no longer bring back an item that was already decided.
