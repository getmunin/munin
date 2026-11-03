---
'@getmunin/backend-core': minor
'@getmunin/core': minor
'@getmunin/db': minor
'@getmunin/types': minor
---

Journeys can now run. A background worker moves each person through a live journey: event triggers enroll people within the late-event window, segment triggers enroll a segment's eligible contacts on a daily, weekly or one-off schedule, and `journeys_enroll` puts someone in by hand. Waits honour valid days and hours in the contact's time zone, `wait_for` continues on the awaited event or takes its timeout path, branches evaluate contact fields, tags, product events and segments, splits and holdouts use a stable per-person bucket, and CRM and webhook actions retry with back-off before following their on-fail rule.

Every node visit is recorded once, so a repeated or crashed tick never acts twice; `journeys_get_trace` shows the full step log with the edge taken and why, and `journeys_list_enrollments` and `journeys_eject` manage who is in a journey. Goal events are tracked for everyone, holdout included, and can end the run. Events caused by a journey's own actions never enroll anyone, which keeps journeys from triggering themselves. Event sinks now receive the emitting actor and hop count. Email steps run once sending lands in the next release.
