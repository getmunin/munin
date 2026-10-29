---
'@getmunin/backend-core': minor
'@getmunin/types': minor
---

Slack: journey email and text proposals are labelled with their journey and step instead of the wrapped campaign, and the content channel (or default channel) gets a notice when the monitor pauses a journey or step and when a journey step needs a person's approval, linking to the journey page. Journeys: the step traces and context of runs that ended are deleted after `settings.traceRetentionDays` (default 365, 30–3650) by a daily pass in the journey worker; the runs themselves stay so reports keep counting them.
