---
title: Set up a Reddit channel
description: Register a Reddit script app, configure the channel with non-secret config, hand off the client secret and password through a credential link, and verify the account — including the account-warming and pacing requirements that decide whether sends land at all.
audiences: [admin]
---

# Set up a Reddit channel

Use this when a customer wants Munin to comment in Reddit threads and send Reddit DMs as one of their own accounts.

This channel is **bring-your-own-key**: the customer registers their own Reddit app and their own Reddit account, and Munin acts as that account. There is no Munin-owned Reddit app.

## TL;DR

1. The human creates a **script** app at [reddit.com/prefs/apps](https://www.reddit.com/prefs/apps) — "create another app…", type **script**. Note the client id (under the app name) and the client secret.
2. `conv_configure_vendor_channel` with `vendor: 'reddit'`, a `name`, and the **non-secret** config: `clientId` and `username`. The channel is created inactive and the response includes a one-time **credential link**.
3. Share the credential link — the human enters `clientSecret` and `password` in the dashboard. Saving verifies the credentials against Reddit and activates the channel. The link works once and expires after 24 hours; mint a fresh one with `conv_request_channel_credentials`.
4. `conv_test_vendor_channel { channelId }` re-verifies the stored credentials any time. `conv_send_vendor_channel_test_message { channelId, to }` sends a real DM to a username you supply.

**Never ask for the client secret or the account password in the conversation** — the tool rejects secret fields.

## Config fields

| field | secret | what it is |
|---|---|---|
| `clientId` | no | Client id of the script app, shown under the app name at reddit.com/prefs/apps. |
| `username` | no | The Reddit account, **without** the `u/` prefix. Comments and DMs are posted as this account. |
| `clientSecret` | yes | Secret of the same script app. |
| `password` | yes | Password of that Reddit account. |
| `sendLimits` | no | `{ perHourMax, perDayMax }`. Defaults to **3/hour, 15/day** — see pacing below. |

The app must be type **script**, not "web app" or "installed app": only script apps accept the password grant Munin uses. A script app is usable only by the account that owns it, so **the app has to be created while logged in as the account that will be commenting** — the app and the `username` must be the same account. The redirect uri is required by the form but unused; `http://localhost:8080` is fine.

**The account must not have two-factor authentication enabled.** Reddit's password grant requires the password and the current OTP joined as `password:otp` for a 2FA account, which cannot work for an unattended service. Use an account without 2FA, and treat the password as the credential it is.

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

- `conv_test_vendor_channel { channelId }` — fetches the authenticated account from Reddit, so it confirms the app credentials, the password grant, and which account Munin will speak as. No message sent.
- `conv_send_vendor_channel_test_message { channelId, to }` — sends a real DM to a username you supply. Use a colleague's account or a throwaway; do not test against a prospect.

## Related

- `skill://playbooks/reddit-engagement` — the probe → qualify → decide → propose loop, and the judgment about when a public comment or a DM is appropriate at all. **Read it before running a campaign**; this skill only gets the channel working.
- `skill://outreach/draft-thread-comment` — drafting a public comment.
