---
'@getmunin/backend-core': minor
'@getmunin/dashboard-pages': minor
'@getmunin/db': minor
'@getmunin/types': minor
---

Per-topic reply automation with promotion. `conv_topics` gains `agent_mode` and `auto_promoted_at` (migration 0085): a topic's mode, when set, overrides the per-conversation agent mode everywhere it is read — the runner's conversation detail, the queue DTO (which also carries `topicAgentMode` for the row nudge), and the dashboard. `ConvAutomationService` aggregates each topic's 30-day review record (approved-unedited / edited / rejected counts, weekly volume, auto-sent share over 7 days) and flips modes, stamping `auto_promoted_at` on promotion and emitting the new `conversation.topic_automation_changed` event. Exposed as `GET /v1/conversations/automation` + `POST /v1/conversations/topics/:topicId/agent-mode`, the MCP tools `conv_list_topic_automation` / `conv_set_topic_automation`, and the `skill://conv/promote-topic-to-auto-send` procedure. The dashboard's Automation screen shows the per-topic table with the ≥90 %-unedited readiness gate, the promote dialog with the disposition breakdown, and one-click demotion — and the queue rows now read `Topic · Auto/Review/Human`.
