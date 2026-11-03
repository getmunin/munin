---
'@getmunin/backend-core': minor
'@getmunin/db': minor
'@getmunin/types': minor
'@getmunin/dashboard-pages': minor
---

Journey agent analytics and conversion: `journeys_get_agent_stats` (and `GET /v1/journeys/:id/agent-stats`) reports each agent step's runs, fallback rate, tokens, daily edge distribution and, for agent-drafted emails, edit and rejection rates; the report tab shows it. `journeys_simulate` now estimates agent runs, tokens and list-price cost. `entry.reentry: "concurrent"` starts one run per triggering event for event-triggered journeys without message steps. `journeys_create_from_campaign` converts an outreach campaign's first touch and sequence steps into a draft journey of agent-drafted emails.
