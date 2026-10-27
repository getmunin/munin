---
'@getmunin/backend-core': minor
'@getmunin/types': minor
'@getmunin/dashboard-pages': minor
---

`journeys_move_enrollments` and `POST /v1/journeys/:id/move-enrollments` move open runs from older versions onto a published version. Each run continues at the step with the same id or where `nodeMap` sends it; a call without a fingerprint previews what would move and what is skipped, and the preview fingerprint confirms it. Runs that stay on the same step keep their wait; runs that move to another step start it fresh, and runs waiting on a proposal, agent or approval only move when they stay put. The live version on the journey page gets a "Move older runs here" action.
