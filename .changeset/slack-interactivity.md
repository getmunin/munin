---
'@getmunin/db': minor
'@getmunin/backend-core': minor
---

Slack integration phase 3: claim/close buttons, live parent state, source-channel routing

The thread parent message becomes interactive: Claim and Close buttons (Reopen once resolved) plus a live status line (status, claimed-by, assigned-to, needs-attention) that updates via `chat.update` as conversation events flow through the mirror. A signed interactivity endpoint (`POST /v1/slack/interactivity`) maps button clicks onto the existing service paths — `ConversationClaimsService.claim` and `conv_change_status` — as the clicking teammate, with the same account-linking rule and ephemeral rejections as thread replies (including "already claimed by someone else").

Routing gains source-channel overrides: `slack_set_routing` with `convChannelId` mirrors conversations from one Munin conversation channel into their own Slack channel (widget → #support-chat, email → #support-email) while everything else keeps the default. Migration `0051_slack_route_overrides` adds the column and reworks the route uniques. Also fixes a phase-1 gap where routing two purposes at the same Slack channel surfaced as a bare 500 instead of a conflict.

The Slack app manifest gains the interactivity request URL (`/v1/slack/interactivity`).
