---
'@getmunin/backend-core': patch
---

Count topic automation volume from inbound conversations instead of replies sent

The Automation page's "Volume / window" figure was computed from non-internal outbound messages (`author_type` in `agent`, `user`) on topic-tagged conversations, so a topic with a backed-up queue read as `~0/wk` no matter how much traffic it was taking — inbound customer messages are `author_type = 'end_user'` and were excluded outright. An operator reading the page to decide whether a topic is worth automating got zero exactly when the answer mattered most.

`weeklyVolume` now counts distinct conversations on the topic that received an inbound customer message in the 30-day window, still averaged to a week. A conversation counts once however many messages the customer sent in it, and it counts whether or not anyone has replied yet. The review counters (`approvedUnedited`, `edited`, `rejected`, `autoSent`) and `autoRate7d` are unchanged — those are about replies and should be.
