---
'@getmunin/backend-core': minor
'@getmunin/db': minor
'@getmunin/types': minor
'@getmunin/dashboard-pages': minor
---

Journey `approval` and `sub_journey` steps. An approval step holds the run until a signed-in person approves or rejects it on the journey page (`POST /v1/journey-approvals/:id/decide`; agents and API keys are refused), then follows `next`, `onReject` or `onTimeout`; `journeys_list_approvals` shows what is waiting. A sub-journey step enters the person into another live journey and, with `await: true`, continues on `onGoal` when that journey reached its goal. Validation refuses sub-journeys that loop back into the journey and the runtime stops nesting at three levels. Step runs are now stamped with clock time, so steps run in one transaction keep their order in the trace.
