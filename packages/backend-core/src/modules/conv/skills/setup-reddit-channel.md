---
title: Set up a Reddit channel
description: Register a Reddit web app, configure the channel, send the operator through Reddit's authorization screen to grant access, and verify the account — including the account-warming and pacing requirements that decide whether sends land at all.
audiences: [admin]
---

# Set up a Reddit channel

Use this when a customer wants Munin to comment in Reddit threads and send Reddit DMs as one of their own accounts.

This channel is **bring-your-own-key**: the customer registers their own Reddit app and their own Reddit account, and Munin acts as that account. There is no Munin-owned Reddit app.

## TL;DR

Two steps: create the channel, then authorize the account. The channel stays inactive until the second step finishes.

1. The human creates an app at [reddit.com/prefs/apps](https://www.reddit.com/prefs/apps) — "create another app…", type **web app**. The **redirect uri must be exactly** the value the dashboard shows, `<your Munin URL>/v1/conversations/channels/reddit/oauth/callback`; Reddit compares it character for character and rejects anything else. Note the client id (under the app name) and the client secret.
2. `conv_configure_vendor_channel` with `vendor: 'reddit'`, a `name`, and `clientId` + `username`. The channel is created inactive, and the response includes a one-time **credential link** for the client secret.
3. Share the credential link — the human enters `clientSecret` in the dashboard.
4. The human clicks **Connect** on the channel and approves the permissions on Reddit. Reddit redirects back, Munin stores a refresh token, and the channel activates. `conv_test_vendor_channel` re-verifies any time.

**Never ask for the client secret in the conversation** — the tool rejects secret fields. **Munin never asks for the account password at all**; there is nothing to type and nothing for you to hold.

## Config fields

| field | secret | what it is |
|---|---|---|
| `clientId` | no | Client id of the app, shown under the app name at reddit.com/prefs/apps. |
| `username` | no | The Reddit account, **without** the `u/` prefix. Comments and DMs are posted as this account. |
| `clientSecret` | yes | Secret of the same app. |
| `sendLimits` | no | `{ perHourMax, perDayMax }`. Defaults to **3/hour, 15/day** — see pacing below. |

The app must be type **web app**, because only that type can complete a redirect-based authorization. The redirect uri has to match what Munin sends, exactly — a trailing slash or `http` where Munin uses `https` is enough for Reddit to refuse the authorization.

**Authorize as the account the channel is configured for.** Munin fetches the authorized account from Reddit and refuses the connection if it is not `username`, because otherwise you would silently be posting as whoever happened to be logged in. If the operator was signed into a personal account, they should log into the right one and click Connect again.

Reddit's consent screen lists the permissions Munin asks for — `identity`, `read`, `submit`, `privatemessages`. All four are required; unticking any of them makes the connection fail with a clear message rather than half-working.

**Two-factor authentication is fine here.** The operator authorizes in a browser, where their 2FA works normally. Munin never sees the password, so there is no `password:otp` problem and no reason to weaken the account for the sake of an integration.

Munin sends its own descriptive `User-Agent` derived from the username, as Reddit's API terms require — there is nothing to configure and nothing to get wrong.

## The account decides whether any of this works

This is the part that is easy to skip and expensive to skip. A technically correct setup on the wrong account sends nothing useful.

- **A fresh account cannot send.** Reddit silently rejects DMs and filters comments from new and low-karma accounts. The effective limits are far tighter than the nominal API rate limit, and there is no API that reports the restriction — sends fail, or succeed and are invisible.
- **Warm the account first, as a person.** Comment and post normally, without links, for weeks before the first campaign. Accumulate real comment karma. Some subreddits additionally enforce their own account-age and karma minimums and will auto-remove anything below them.
- **Use an account the customer is willing to lose, but expects to keep.** Say plainly to the customer: this account is the identity doing the talking, a ban is permanent and appeals rarely succeed, and a shadowban is invisible — comments post successfully and simply nobody sees them.
- **Never share one account across unrelated products or clients.** Cross-promotion patterns are exactly what Reddit's spam detection looks for.

## Pacing

`sendLimits` is enforced per channel, before any send is attempted: over the cap, the message is deferred to a later time rather than failed, so nothing is lost. Defaults are **3 per hour and 15 per day**, deliberately far below anything Reddit's rate limits would allow, because the binding constraint is spam detection and moderators, not quota.

Raise it only for a well-established account and only with a reason. Lower it for a young one. Campaign-level cadence (`maxPerWeekPerSubreddit`, `maxCommentsPerDay`) is a separate, per-community limit and is set on the campaign, not here.

If Reddit rate-limits a send, Munin honours the retry time Reddit returns and does not retry earlier. If Reddit rejects a send for a reason retrying cannot fix — recipient has blocked us or does not accept DMs, thread locked or archived, account suspended — the delivery is marked failed immediately rather than retried, so a struggling account is not hammered.

## Terms and commercial approval

With BYOK the **customer is the API consumer of record** and is bound by Reddit's Data API terms. Reddit's free tier is for non-commercial use; commercial use requires approval from Reddit, and obtaining it is the customer's obligation, not Munin's. Say this during setup rather than after — it is not something Munin can negotiate on their behalf, and it is the customer's account that is at risk.

**Revoking is theirs too, and it is one click.** The authorization appears under the account's [app permissions](https://www.reddit.com/prefs/apps) and can be revoked there without changing the password. Munin's next send then fails terminally with a message telling the operator to reconnect, rather than retrying against a dead grant.

## What Munin can and cannot see

- **DMs go to the "Messages" inbox, not Reddit Chat.** Reddit Chat — the modern DM UI most people actually read — has no public API. Munin can neither send nor read there. A DM that Reddit accepts is genuinely delivered, but to the inbox many users never open, so a successful send is not the same as being read. Set the customer's expectations accordingly.
- **There are no webhooks.** Inbound is polling only, so a reply appears within roughly a minute rather than instantly.
- **There are no delivery or read receipts.** Reddit does not provide them.

## Inbound behaviour

Two different threading rules, because Reddit has two different shapes of conversation:

- **DMs thread per person.** A second DM from the same account lands in that account's most recent open conversation; a snoozed one is reopened. Each redditor becomes a contact identified by their `handle`.
- **Thread comments thread per thread.** Every reply in a thread Munin commented in lands in that thread's single conversation, whoever wrote it, each message attributed to its own author. So one conversation can hold many people — that is correct, not a bug.

**Set `defaultAgentMode` on the channel.** `conv_configure_vendor_channel { channelId, vendor: 'reddit', defaultAgentMode }` decides what the agent does with inbound Reddit messages: `auto` replies directly, `draft_only` files a draft for a human, `off` does neither. **Prefer `draft_only`.** A wrong auto-reply in a public thread is public and permanent, and cannot be recalled.

## Opting out

There is no automated opt-out on Reddit and Munin never appends an unsubscribe footer — a tracking URL in a cold DM is a spam signal. Munin adds a plain sentence inviting a reply instead, when the campaign requires an opt-out line.

When anyone asks to be left alone — in a DM or publicly in a thread — set `doNotContact` on their CRM contact. That is the entire mechanism; nothing is watching for keywords the way SMS does, because a Reddit reply is prose, not a carrier keyword. Suppressed contacts drop out of outreach audiences. Do not clear the flag to re-add someone.

## Verify

- `conv_test_vendor_channel { channelId }` — fetches the authenticated account from Reddit, so it confirms the app credentials, the stored authorization, and which account Munin will speak as. No message sent.
- `conv_send_vendor_channel_test_message { channelId, to }` — sends a real DM to a username you supply. Use a colleague's account or a throwaway; do not test against a prospect.

## Related

- `skill://playbooks/reddit-engagement` — the probe → qualify → decide → propose loop, and the judgment about when a public comment or a DM is appropriate at all. **Read it before running a campaign**; this skill only gets the channel working.
- `skill://outreach/draft-thread-comment` — drafting a public comment.
