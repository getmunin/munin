---
'@getmunin/backend-core': minor
'@getmunin/dashboard-pages': minor
---

Journey email steps now keep a review record: for the last 30 days, how many drafts reviewers approved as is, edited or dismissed, how many are pending and how many went out without review. `journeys_get_node_review_stats`, `GET /v1/journeys/:id/review-stats` and the report tab show it, with a "ready for auto" badge once a step has 30 reviewed drafts with at least 90% approved as is.

An agent-drafted step can only be published to send without review after it has earned that badge; publish requests are refused otherwise, and the publish dialog shows the evidence next to each step that would stop being reviewed. Only a person can make that switch.
