---
'@getmunin/backend-core': minor
'@getmunin/dashboard-pages': minor
'@getmunin/agent-runtime': patch
---

Slack routing without channel IDs: the configure dialog lists the channels the bot has been invited to (new `GET /v1/slack/channels` + `slack_list_channels` tool), and inviting @Munin to an unrouted channel posts an interactive prompt where an org owner/admin can set default or escalations routing directly from Slack. Also fixes the Slack Web API client to form-encode requests (read methods rejected JSON bodies with invalid_arguments, surfacing as a 500 when saving a route) and sends the OAuth install back to the Integrations page instead of AI settings.
