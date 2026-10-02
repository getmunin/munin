---
'@getmunin/backend-core': minor
'@getmunin/db': minor
---

Slack: several Munin orgs in one workspace can now route into the same Slack channel.

- `slack_set_routing` no longer refuses a channel because another org already routes into it. `slack_conflict` now only means the channel is already one of this org's own routes. The response gains `sharedChannel`, true when another org also routes into the channel.
- While a channel is shared, every top-level message the bot posts there opens with the org's name: thread parents, escalation alerts, approval cards and their group parents, and publish announcements. Thread replies stay unlabelled, and a channel only one org uses looks exactly as before. Updates follow the current routing, so a message gains or loses the label as other orgs join or leave the channel.
- When the bot joins a channel in a workspace several orgs share, it now posts one routing prompt with a row of buttons per org instead of staying silent. Each org's owners and admins answer for their own org, answering one row leaves the others open, and orgs already routed into the channel are left out.
- In a shared channel, the "not linked" notices for replies and button clicks name the org they refer to.
- Migration `0112_slack_shared_channels` replaces the `(team_id, slack_channel_id)` unique index on `slack_channel_routes` with a unique index on `(integration_id, slack_channel_id)`, plus a plain index on `(team_id, slack_channel_id)`.
- `skill://slack/connect-slack` documents channel sharing.
