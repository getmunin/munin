---
'@getmunin/backend-core': minor
'@getmunin/db': minor
'@getmunin/types': minor
'@getmunin/dashboard-pages': minor
---

Microsoft Teams operator bridge. Conversations mirror into a Teams channel as threads, the way the Slack bridge works. Each conversation gets a root card with a live status line and *Take over* / *Release* / *Close* / *Reopen* buttons. Customer messages, AI replies, teammate replies and internal notes post as thread replies, status and assignment changes post as thread notes, and handover requests also raise an alert in an optional escalations channel. A thread reply goes to the customer over the conversation's original channel as the teammate whose Teams account email or UPN matches an org member (a reply starting with `!` stays an internal note). Card buttons act as that same teammate.

Every org brings its own bot. Azure has not allowed new multi-tenant bots since 31 July 2025, so one shared Munin bot cannot post into every customer's tenant. Instead an org registers a single-tenant bot (the Teams Developer Portal works without an Azure subscription) and connects it with `teams_create_connection`. The client secret is entered through the existing credential handoff and verified against Microsoft when it is saved. Munin generates the Teams app package (manifest v1.25 plus icons) with the bot id filled in. The package requests the `ChannelMessage.Read.Group` resource-specific permission, which is what lets plain thread replies reach Munin without @mentioning the bot.

- **MCP tools** (`teams:read` / `teams:write` scopes): `teams_get_status`, `teams_create_connection`, `teams_request_credentials`, `teams_list_channels`, `teams_set_routing`, `teams_send_test_message`, `teams_list_user_links`, `teams_link_user`, `teams_unlink_user`, `teams_disconnect`.
- **Skill**: `skill://teams/connect-teams` walks through bot registration, installing the app package, and routing.
- **Control plane** under `/v1/teams`, including `GET /v1/teams/app-package`. The public Bot Framework messaging endpoint is `POST /v1/teams/messages`.
- **Dashboard**: a Microsoft Teams card on the Integrations page, next to Slack. Connecting uses the same two-step dialog as Facebook and LinkedIn: numbered steps for registering the bot in the Developer Portal (with the messaging endpoint to copy), then the bot ID, tenant ID and client secret in one form. The secret is checked against Microsoft before anything is saved, so a wrong one leaves no half-connected bot behind. A second dialog walks through downloading the app package, adding it to a team, and picking the default channel. The agent path still goes through the credential handoff, so the secret never passes through chat. The step, eyebrow and copy-field pieces of the Facebook/LinkedIn dialog moved into a shared `setup-dialog-kit.tsx`.

Inbound activities are authenticated by the Bot Connector JWT, not a shared secret:
- the signature is checked against Microsoft's published keys, and the key must be endorsed for `msteams`;
- the issuer is checked;
- the audience must be a connected bot, which is also how the org is resolved;
- the token's `serviceurl` claim must match the activity.

Outbound calls only go to allow-listed Bot Connector hosts. Sends are paced per channel to stay inside Teams' per-conversation rate limits. A throttled delivery is rescheduled without spending one of its retries, and a bot that has been blocked or removed fails its delivery immediately.

Not in this release: approval cards, CMS content announcements, attachments, and private or shared channels.

The vendor-neutral parts of the Slack bridge moved to `modules/operator-bridge/` so both bridges share them: the mirrored event list, conversation and parent-state loading, snapshot types, and secret encryption. Slack's behaviour is unchanged. Migration `0109_teams_operator_bridge` adds the `teams_*` tables, with RLS policies in `teams.sql`.
