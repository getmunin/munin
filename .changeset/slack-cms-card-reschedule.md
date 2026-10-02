---
"@getmunin/backend-core": patch
---

Slack CMS draft cards now follow the entry through a reschedule and a scheduled publish. A card that resolved as "Scheduled to publish" stayed marked resolved after an edit put the entry back to draft, so the reschedule and the eventual publish were dropped and the card kept a Publish button bound to an old version (`cms_version_conflict` when pressed). Reopening a card now clears its resolved marker (and the locale parent's), and CMS cards re-render on every scheduled/published/archived/deleted event since they are drawn from the entry's current status. This also fixes scheduled publishes never showing as published when the card sits in the announcement channel.
