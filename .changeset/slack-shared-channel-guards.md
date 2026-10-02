---
'@getmunin/backend-core': minor
'@getmunin/dashboard-pages': minor
---

Slack: guard shared channels.

- Routing an org into a Slack channel that another org already routes into now requires the caller to be in that channel. Munin finds the Slack account that uses the caller's Munin email address (or, from the Slack prompt, uses the clicker's own account) and checks channel membership; otherwise `slack_set_routing` and `PUT /v1/slack/routing` refuse with `slack_not_channel_member`. Agents without a user behind them cannot pass the check. Editing a route an org already has in the channel is unaffected.
- When the bot joins a channel in a workspace several orgs share, the routing prompt no longer lists the orgs by name. Its buttons act for the org the clicker is an owner or admin of, a routed org is noted on the prompt, and the buttons stay until every org routes into the channel. Prompts already posted with a row per org still work, but answering one now closes the whole prompt.
- `slack_get_status` and `GET /v1/slack` report `sharedChannel` on every route, and the dashboard's Slack dialog warns when the selected channel is shared with another org.
