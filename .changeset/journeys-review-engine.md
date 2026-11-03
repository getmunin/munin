---
'@getmunin/backend-core': patch
'@getmunin/db': patch
---

Journey engine fixes from review: scheduled segment entry now pages through the whole segment and runs at the trigger's time of day, weekday and time zone; a failing inbox event is retried with backoff instead of being dropped; the event that enrolls someone, or one from before they entered, no longer counts as their goal or exit; holdout people and finished concurrent runs are not re-enrolled by the same trigger; enrolling an unknown contact is a 404; draft edits are serialised; a failing action rolls back to a savepoint so retries and onFail work; deal events carry the primary contact; product event names cannot use Munin's own event prefixes; `journeys_validate` is annotated as a write.
