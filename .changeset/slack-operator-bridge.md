---
'@getmunin/db': minor
'@getmunin/core': minor
'@getmunin/backend-core': minor
'@getmunin/dashboard-pages': minor
---

Slack integration phase 1: mirror conversations into Slack threads (operator surface)

- New `slack` module: per-org workspace connection via Slack OAuth (deployment-level app credentials in `SLACK_CLIENT_ID`/`SLACK_CLIENT_SECRET`), channel routing, and a bridge worker that projects conversation events (`created`, messages, status, assign/claim, handover) into one Slack thread per conversation. Handover requests additionally alert a configurable escalations channel with an optional mention.
- `WebhookDispatcher` gains `registerSink()` — integrations enqueue durable deliveries transactionally with the emitted event; the webhooks queue and the Slack bridge are now peer consumers.
- New tables (`slack_integrations`, `slack_channel_routes`, `slack_conversation_links`, `slack_message_links`, `slack_user_links`, `slack_deliveries`) with RLS; a Slack channel can only mirror one org (`(team_id, slack_channel_id)` unique), so one workspace can serve multiple orgs.
- Admin MCP tools `slack_get_install_url`, `slack_get_status`, `slack_set_routing`, `slack_test`, `slack_disconnect` (scopes `slack:read`/`slack:write`), the `skill://slack/connect-slack` setup skill with the app manifest, `/v1/slack` control endpoints, and a Slack card under AI settings → Integrations.

Reply-from-Slack and interactive claim/close buttons are follow-up phases; message links already dedupe both directions to keep the loop-prevention invariant.
