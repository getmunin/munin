---
title: Connect Slack for human handoff
description: Connect a Slack workspace so conversations mirror into a channel as threads and handover alerts reach the team, then route channels and verify with a test message.
audiences: [admin]
---

# Connect Slack for human handoff

Use this when the operator wants their team to triage Munin conversations from Slack. Every conversation becomes one Slack thread in a channel you pick: customer messages, AI replies, status changes, and claim/assign updates post into the thread, and handover requests raise a prominent alert. Slack is an operator surface — replies to the customer still travel over the conversation's original channel (email, widget, SMS, voice).

## TL;DR

1. Confirm the deployment has a Slack app (`slack_get_status` → `appConfigured`). Self-host without one: create the app from the manifest below and set the env vars.
2. Call `slack_get_install_url` and have the operator open and approve the link in a browser (workspace admin required).
3. Call `slack_set_routing` with the channel ID conversations should mirror into; have the operator `/invite` the bot to that channel.
4. Optionally route escalations to a second channel: `slack_set_routing` with `purpose: "escalations"` and a `mention` like `<!here>`.
5. Verify with `slack_test`, then confirm `slack_get_status` shows `connected: true`.

## Step 0 — deployment prerequisites (self-host only)

Munin cloud ships a Slack app; skip this on cloud. On self-host, check `slack_get_status`: if `appConfigured` is `false`, the operator must create a Slack app once for the deployment:

1. Go to https://api.slack.com/apps → *Create New App* → *From an app manifest* and paste (replace the redirect URL host with the deployment's public API base URL):

```json
{
  "display_information": {
    "name": "Munin",
    "description": "Mirrors Munin conversations into Slack for triage and handover alerts."
  },
  "features": {
    "bot_user": { "display_name": "Munin", "always_online": true }
  },
  "oauth_config": {
    "redirect_urls": ["https://YOUR_API_HOST/v1/slack/oauth/callback"],
    "scopes": {
      "bot": ["chat:write", "channels:read", "users:read", "users:read.email"]
    }
  },
  "settings": {
    "org_deploy_enabled": false,
    "socket_mode_enabled": false,
    "token_rotation_enabled": false
  }
}
```

2. From the app's *Basic Information* page, set these env vars on the backend and restart it:
   - `SLACK_CLIENT_ID`
   - `SLACK_CLIENT_SECRET`
   - `SLACK_SIGNING_SECRET` (not used yet; reserved for reply-from-Slack)

The redirect URL must exactly match `https://<api-base>/v1/slack/oauth/callback` — the same base that serves `/mcp`.

## Step 1 — install into the workspace

Call `slack_get_install_url` and give the operator the returned URL. They open it in a browser, pick the Slack workspace, and approve. The link expires after 10 minutes — mint a fresh one if they were slow. On success the browser lands back on the dashboard's AI settings page with `slack=connected`.

One workspace can serve multiple Munin orgs, but each Slack **channel** belongs to exactly one org.

## Step 2 — route a channel

Conversations do not mirror until a default channel is routed:

1. Ask the operator which channel (they need its ID: channel details → *About* → Channel ID, e.g. `C0123456789`).
2. Call `slack_set_routing` with `{ "slackChannelId": "C0123456789" }`.
3. If the response has `botInChannel: false`, the operator must run `/invite @Munin` in that channel — the bot cannot post until invited.

Optional escalations channel — handover alerts land here instead of the default channel, with an attention mention:

```json
{ "slackChannelId": "C0456...", "purpose": "escalations", "mention": "<!here>" }
```

`mention` accepts Slack mention syntax: `<!here>`, `<!channel>`, or a user group like `<!subteam^S0123456789>`.

## Step 3 — verify

Call `slack_test` — it posts a hello message to the default channel. Then confirm `slack_get_status` shows `connected: true` and the routes you expect. From now on, new conversation activity appears within a few seconds (the mirror worker polls its queue every 5 seconds).

## What mirrors

- New conversation → thread parent with contact, source channel, subject, and a dashboard link.
- Customer messages (:bust_in_silhouette:), AI agent replies (:robot_face:), teammate replies (:technologist:), and internal notes (:lock:) as thread replies.
- Status changes, assignment, claim/release, and handover request/resolve as thread updates.
- Handover requests additionally alert the escalations channel (or the default channel) with the reason and the configured mention.

Replying from the Slack thread does not reach the customer yet — that is a planned follow-up. Operators reply from the dashboard or via `conv_send_message`.

## Troubleshooting

- `slack_not_configured` — deployment env vars missing (step 0).
- `slack_bot_not_in_channel` / parent messages missing — the bot was never invited to the routed channel.
- `slack_conflict` on routing — that channel already mirrors a different Munin org; pick another channel.
- Mirroring stopped after workspace changes — reinstall via `slack_get_install_url` (token may have been revoked), then re-check `slack_get_status`.
- Delivery backlog — `slack_get_status` reports `deliveries.pending` and `deliveries.failedLastDay`; failures retry up to 5 times with backoff and respect Slack rate limits.
