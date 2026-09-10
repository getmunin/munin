---
title: Recover a failed message delivery
description: Find outgoing email or SMS that never reached the recipient, read why the send failed, fix the cause, and re-queue the delivery with conv_retry_delivery.
audiences: [admin]
---

# Recover a failed message delivery

Use this when an operator says a customer never got a reply, or when a
`conversation.message.delivery_failed` webhook fires. It covers email and SMS —
the two channel types Munin delivers out of band.

## How outbound delivery works

`conv_send_message` does two things in one transaction: it appends the message to
the conversation, and it queues a delivery row. The message is in the thread
immediately; the actual send happens seconds later in a background worker.

That worker walks the delivery through these states:

| `deliveryStatus` | Meaning |
|---|---|
| `queued` | Waiting for the next worker pass. Also the state of a send deferred by the channel's rate limit. |
| `sent` | The provider accepted it. |
| `failed` | An attempt threw. The worker will try again after a backoff. |
| `dead` | Five attempts all failed. Nobody will retry it automatically. |

Backoff doubles from 30 seconds, so a delivery reaches `dead` roughly eight
minutes after the first attempt. **`dead` is the state that needs a human** — the
message is sitting in the thread looking like every other outgoing message, and
the recipient never got it.

A `dead` delivery also opens a `channel_outbound` system alert against the
channel (visible via `system_alerts_list`), which resolves by itself once
anything sends successfully on that channel again.

## Step 1 — find what didn't arrive

`conv_get_conversation` reports the delivery state on every message:

```jsonc
{ "name": "conv_get_conversation", "arguments": { "id": "ccv_…" } }
```

Each message carries `deliveryStatus`, `deliveryError`, `deliveryAttempts` and
`deliveryNextAttemptAt`. Inbound messages, internal notes, and messages on
channels that deliver in-band (chat widget) have `deliveryStatus: null` — that is
not a failure, there is simply nothing to deliver.

To sweep a whole channel rather than one conversation, list the org's open
alerts and keep the ones whose `source` is `channel_outbound` — the tool has no
source filter, so filter as you read:

```jsonc
{ "name": "system_alerts_list", "arguments": {} }
```

Each such alert's `metadata` names the channel and the most recent undelivered
`messageId`, and `occurrenceCount` tells you how many messages have died on that
channel since it opened.

## The bounce that comes back is not a customer

When a send fails at the far end rather than at ours, the provider mails a DSN back
to the channel. Munin ingests it like any other inbound mail, but classifies it as
`suppressed: "bounce"` — from the envelope (`Return-Path: <>`), the sender
(`mailer-daemon@`, `postmaster@`, `bounces@…`), an RFC 3464
`Content-Type: multipart/report; report-type=delivery-status`, or `X-Failed-Recipients`.

A suppressed message is deliberately inert: it does not wake the agent, does not
enqueue curation work, and is left out of the context the agent reads when it drafts
on that conversation. The long base64 header blocks DSNs echo back are stripped at
ingest, and bodies are capped, so a bounce cannot cost a large context window.

So the DSN shows up in the inbox for a human to read, and nothing tries to answer it.
Never reply to one — the recipient is a robot. Act on the *original* message instead,
which is what the rest of this skill is about.

## Step 2 — read the error before retrying

`deliveryError` is the provider's own message. Retrying without fixing what it
says just burns another five attempts. The common shapes:

- **Authentication** (`535 5.7.8`, `Invalid login`, `authenticate`) — the channel's
  credentials are wrong or were rotated. Re-issue them with
  `conv_request_channel_credentials` and have the operator paste the new secret;
  the credentials never travel through you. Verify with `conv_test_email_channel`
  or `conv_test_voice_sms_channel` before retrying.
- **Rejected recipient** (`550`, `Recipient address rejected`, `unknown user`) —
  the address is wrong or gone. Retrying is pointless. Fix the contact
  (`crm_update_contact`) and send a *new* message; the dead one is addressed to
  the old address and always will be.
- **Connection / timeout / `421` / `450`** — a transient provider fault that
  outlived the five automatic attempts. This is the case retrying was built for.
- **Rate limit** — note that a send *deferred* by the channel's own send limits
  stays `queued` and carries its reason in `deliveryError`. That is not a
  failure and needs nothing from you.

## Step 3 — re-queue it

Once the cause is fixed:

```jsonc
{ "name": "conv_retry_delivery", "arguments": { "messageId": "cvm_…" } }
```

This resets the delivery to `queued` with a fresh attempt budget. The worker
picks it up within about ten seconds; poll `conv_get_conversation` to confirm the
status moved to `sent`.

Two refusals are worth recognizing rather than retrying through:

- `conv_delivery_not_retryable` — the delivery isn't `dead`. Either it already
  went out, or the worker is still between automatic attempts. Re-read the
  conversation; do not loop on this.
- `conv_delivery_channel_inactive` — the channel is switched off or archived, so
  a retry would fail immediately. Repeated inbound failures auto-deactivate a
  channel, so this often travels with a `channel_inbound` alert. Reactivate the
  channel first.

## What NOT to do

- **Don't send a duplicate as a workaround.** Retrying the dead delivery keeps the
  thread honest — one message, one send. Posting a fresh copy leaves the
  undelivered one in the thread, and the customer sees the text twice if the
  original later goes out.
- **Don't retry a rejected recipient.** A `550` is a verdict, not a hiccup. Fix
  the address and send a new message.
- **Don't retry in a loop.** Five automatic attempts already happened. If a manual
  retry dies too, the cause isn't transient — go back to step 2.
- **Don't tell the operator the message was sent** just because it's in the
  thread. Being in the thread and being delivered are different facts, which is
  exactly what `deliveryStatus` exists to separate.

## Related

- `skill://conv/setup-email-channel` — repairing SMTP credentials.
- `skill://conv/setup-voice-sms-channel` — repairing SMS credentials.
- `skill://conv/track-email-opens` — the other half of "did it land?": delivered
  is not the same as read.
