---
title: Connect Microsoft Teams for human handoff
description: Connect the org's own Microsoft Teams bot so conversations mirror into a Teams channel as threads, handover alerts reach the team, and operators reply to customers from the thread; then route channels and verify with a test message.
audiences: [admin]
---

# Connect Microsoft Teams for human handoff

Use this when the operator wants their team to triage Munin conversations from Microsoft Teams. Every conversation becomes one thread in a Teams channel you pick: customer messages, AI replies, status changes and takeover/assign updates post into the thread, and handover requests raise an alert. Operators answer the customer by replying in the thread. Teams is an operator surface — replies travel to the customer over the conversation's original channel (email, widget, SMS, voice).

## TL;DR

1. The operator registers a bot for their organisation (step 0) and gives you its **App ID** and their **Entra tenant ID**.
2. Call `teams_create_connection` with both. Give the operator the returned `credentials.url` to enter the bot's client secret, and have them set the bot's messaging endpoint to the returned `messagingEndpoint`.
3. The operator downloads the Munin app package from the dashboard and adds it to the team (step 2).
4. Call `teams_list_channels`, ask which channel to use, then `teams_set_routing` with its id. Optionally route an `escalations` channel.
5. Verify with `teams_send_test_message`, then confirm `teams_get_status` shows `connected: true`.

## Why every org brings its own bot

Microsoft stopped allowing new multi-tenant bots after 31 July 2025, so one shared "Munin" bot cannot post into every customer's Teams. Instead each org registers a small single-tenant bot in its own Microsoft 365 tenant, and Munin drives it with the App ID, tenant ID and client secret the operator provides. The bot and the people using it live in the same tenant, which is exactly what single-tenant bots allow. The same steps apply to Munin Cloud and to self-hosted deployments.

## Step 0 — register the bot (operator, ~10 minutes)

Check `teams_get_status` first: if `integration` is already set, skip to step 1's credentials link or step 2. An operator can also connect from the dashboard instead (*Settings → Integrations → Microsoft Teams → Connect*), which walks them through the Developer Portal and takes the client secret in the same form.

The operator needs permission to create app registrations in their tenant (or an admin to do it for them), and the team the bot will post into must be on Teams for work or school with a Teams licence. The free personal Teams (the one with *Communities* instead of teams) cannot install custom apps, and in the EEA many Microsoft 365 plans are sold without Teams, so check the licence before starting. No Azure subscription is required:

1. Open the Teams Developer Portal at https://dev.teams.microsoft.com → *Tools* → *Bot management* → *New Bot*, and give it a name (e.g. "Munin").
2. Under *Configure*, set the **endpoint address** to the messaging endpoint from `teams_get_status` (`messagingEndpoint`, e.g. `https://api.example.com/v1/teams/messages`).
3. Under *Client secrets*, add a secret and copy it once — it is shown only at creation.
4. Note the bot's **App ID** (a GUID — the Developer Portal shows it in the bot page's address, `…/tools/bots/<App ID>/configure`, and in the *Bot ID* column of the bot list) and the organisation's **tenant ID** (Entra ID → *Overview* → *Tenant ID*, also a GUID).

An organisation that prefers Azure can instead create an *Azure Bot* resource with type **Single Tenant**, enable its *Microsoft Teams* channel, and set the same messaging endpoint — the App ID, tenant ID and a client secret from its Entra app registration work identically.

## Step 1 — connect the bot

Call `teams_create_connection`:

```json
{ "appId": "11111111-2222-3333-4444-555555555555", "tenantId": "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" }
```

The response carries `credentials.url` — a one-time link (24 hours) where a human enters the client secret. Never ask for the secret in the conversation. Saving it verifies the secret against Microsoft immediately; a rejected secret reports `invalid_client` on the page. To enter a new secret later (they expire), call `teams_request_credentials` for a fresh link.

An org connects one bot. `teams_conflict` means either this org already has one (use `teams_request_credentials` to re-enter its secret, or `teams_disconnect` to switch bots) or that App ID is connected to a different Munin org.

## Step 2 — add the app to a team (operator)

The bot only sees a team once the Munin app is installed there:

1. In the Munin dashboard, open *Settings → Integrations → Microsoft Teams* and click **Download app package**. It is a zip holding the Teams manifest with this org's bot id filled in, plus the icons.
2. Either upload it for the whole organisation (Teams admin center → *Teams apps → Manage apps → Upload new app*), or sideload it into one team (in Teams: the team's *⋯ → Manage team → Apps → Upload an app → Upload a custom app*). Sideloading requires the tenant to allow custom apps.
3. Add the app to the team that should receive conversations. The install prompt asks the team owner to let the app **read this team's channel messages** — that consent (`ChannelMessage.Read.Group`) is what lets thread replies reach Munin without anyone having to @mention the bot. Without it, only replies that @mention Munin arrive.

Installing records the team in Munin within a few seconds; `teams_get_status` lists it under `integration.teams`.

## Step 3 — route a channel

Conversations do not mirror until a default channel is routed:

1. Call `teams_list_channels` and ask the operator which channel to use. Each entry has the channel `id`, its `name`, and the team it belongs to. A team's *General* channel has the same id as the team itself.
2. Call `teams_set_routing` with `{ "teamsChannelId": "<id>" }`.

Optional escalations channel — handover alerts land here instead of the default channel:

```json
{ "teamsChannelId": "<id>", "purpose": "escalations" }
```

Optional source-channel routing — mirror conversations from one Munin conversation channel (find ids with `conv_list_channels`) into their own Teams channel:

```json
{ "teamsChannelId": "<id>", "convChannelId": "cch_..." }
```

Every route needs its own Teams channel. Use standard channels; private and shared channels are not supported yet.

## Step 4 — verify

Call `teams_send_test_message` — it posts a hello message to the default channel. Then confirm `teams_get_status` shows `connected: true` and the routes you expect. New conversation activity appears within a few seconds (the mirror worker polls its queue every 5 seconds).

## What mirrors

- New conversation → a thread root card with the contact, source channel, a live status line (status, taken-over-by, assigned-to, needs-attention), *Take over* / *Close* buttons (*Release* while taken over, *Reopen* once closed) and *Open in Munin*. The headline switches from "New conversation #N" to the subject once one is set. Buttons act as the clicking teammate, under the same account-linking rule as replies, and a refused click answers only the clicker.
- Customer messages (👤), AI agent replies (🤖), teammate replies (🧑‍💻) and internal notes (🔒) as thread replies. Teams bots cannot post under a different name per message, so every mirrored message is posted by the bot with the author named on its first line.
- Status changes, assignment, claim/release and handover request/resolve as thread updates, and the root card refreshes to match.
- Handover requests additionally post an alert in the escalations channel (or the default channel) with the reason.

Deleting a mirrored thread's root post in Teams drops the thread link; the conversation starts a fresh thread the next time something happens in it.

Approval cards (merge proposals, outreach drafts, KB candidates, CMS drafts, social posts) and content announcements are Slack-only for now — use `skill://slack/connect-slack` or the dashboard review queue for those.

## Replying from Teams

A reply in a mirrored thread is sent to the customer over the conversation's original channel and recorded in Munin as that teammate's message. Replying does not take over the conversation — use *Take over* on the root card for that.

- **Attribution is by email match**: the Teams account's email or sign-in name (UPN) must belong to a member of the Munin org. The first reply or click creates the link; later ones reuse it. When they differ, link manually with `teams_link_user` (the person's Entra object id, from Entra ID → *Users*, and the Munin user id); inspect with `teams_list_user_links`, revoke with `teams_unlink_user`.
- **Unmapped users are rejected** — the reply is *not* sent, and the bot answers in the thread, mentioning the sender. Teams has no private per-user notices in channels, so the notice is visible to the channel.
- **Internal notes**: start the reply with `!` to keep it team-only (`!checking with billing`).
- **Formatting** — bold, italics, strikethrough, links, lists and code blocks are converted to Markdown for the customer; an @mention of Munin is dropped and other mentions become `@Name`.
- **Attachments are not forwarded** — a file-only reply is rejected and a reply with files goes out as text only; the sender is told either way.
- Only thread replies count; top-level channel posts and edits are ignored.

## Troubleshooting

- Teams has no *Apps* entry, or *Upload a custom app* is missing — the account is on the free personal Teams or has no Teams licence, or custom app upload is off (Teams admin center → *Teams apps* → *Setup policies* → *Upload custom apps*).
- Nothing arrives from Teams (no teams listed, replies ignored) — the bot's messaging endpoint does not point at `messagingEndpoint`, or the backend is not reachable from the internet over https.
- `teams_credentials_missing` — the client secret was never entered; send a `teams_request_credentials` link.
- Deliveries failing with `invalid_client` — the client secret expired or was deleted; create a new one in the Developer Portal and enter it through a fresh credentials link.
- `teams_channel_not_found` on routing — the app is not installed in that channel's team yet (step 2), or the id was mistyped; list channels again.
- Deliveries failing with `bot_not_installed` or `MessageWritesBlocked` — the app was removed from the team or blocked by an admin; add it back.
- The app cannot be uploaded — the tenant's app setup policy blocks custom apps; an admin can upload it to the org catalog instead.
- Delivery backlog — `teams_get_status` reports `deliveries.pending` and `deliveries.failedLastDay`. Teams limits how fast a bot may post into one channel (all of a channel's threads share the budget), so a very busy channel queues rather than drops; routing sources to separate channels spreads the load. Other failures retry up to 5 times with backoff.
