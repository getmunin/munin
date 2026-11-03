---
'@getmunin/backend-core': minor
'@getmunin/db': minor
'@getmunin/types': minor
'@getmunin/dashboard-pages': minor
---

Journey monitor: the journey worker checks every live journey every 15 minutes (`MUNIN_JOURNEYS_MONITOR_MS`) and pauses a step whose bounce, unsubscribe or failed-step rate goes above `settings.guardrails` (defaults 5%, 2% and 10%, once a step has 50 sends or runs within 7 days), or the whole journey when only the total breaches. A pause raises a `journeys` system alert and emits `journey.node.paused`; runs that reach a paused step wait there until someone resumes it. New tools `journeys_get_guardrails`, `journeys_pause_node` and `journeys_resume_node`, matching `/v1` routes, and a paused-step banner with a resume button on the journey page. Migration 0129 adds `journeys` to the `org_alerts` source check constraint.
