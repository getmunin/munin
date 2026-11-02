---
'@getmunin/backend-core': patch
---

`journeys_pause_node` (and `POST /v1/journeys/:id/nodes/:nodeId/pause`) now refuses a node id that no version of the journey contains, with `journeys_not_found`. Before, a mistyped id was stored as a paused node and announced with a `journey.node.paused` webhook, although no run could ever reach it.
