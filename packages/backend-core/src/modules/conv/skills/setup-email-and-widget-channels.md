---
title: Conv: Set up email and chat-widget channels together
description: Stand up email + widget conversation channels for a new tenant in one pass — configure, test, hand off.
audiences: [admin]
---

# Set up email and chat-widget channels together
A common onboarding shape for a new customer: they want both an email channel for ticket-style threads and a chat-widget channel for their website. This skill orchestrates both — it doesn't reproduce the per-channel detail, it points to the per-channel skills for the specifics.

> **Read alongside:**
> - `skill://conv/setup-email-channel` — full SMTP/IMAP config detail.
> - `skill://conv/setup-chat-widget` — widget key minting + push transcript flow.
> - `skill://conv/escalate-to-human` — once a human is involved, how the external bot yields.

## TL;DR

1. `conv_list_channels` — see whether any channel exists for this org.
2. Email channel: `conv_email_setup_channel` → `conv_email_test_channel` to verify.
3. Widget channel: `conv_widget_create_channel` → store the `widgetKey` server-side.
4. `conv_list_channels` again to confirm both are `active: true`.
5. (Optional) `conv_create_topic` per topic so the inbox has Billing / Support / Bug topics ready.

## Step 1 — check current state

```jsonc
{ "name": "conv_list_channels", "arguments": {} }
```

Lists existing channels and their `active` flag. If the org already has an email or widget channel, skip the corresponding step.

## Step 2 — email channel

Per `skill://conv/setup-email-channel`, gather:
- `fromAddress` — the real mailbox the customer controls.
- Outbound mode: `smtp` (host, port, secure, username, password) or `mailer` (Munin's configured Resend).
- Inbound mode: `imap` (host, port, secure, username, password, mailbox), or skip if the customer will forward to a `MUNIN_EMAIL_REPLY_DOMAIN` address.

Then:

```jsonc
{
  "name": "conv_email_setup_channel",
  "arguments": {
    "name": "Acme Support",
    "config": {
      "addressing": { "fromAddress": "support@acme.com", "fromName": "Acme Support" },
      "outbound": { "provider": "smtp", "host": "smtp.acme.com", "port": 587, "secure": false, "username": "support@acme.com", "password": "<plaintext, encrypted server-side>" },
      "inbound":  { "host": "imap.acme.com", "port": 993, "secure": true, "username": "support@acme.com", "password": "<plaintext>", "mailbox": "INBOX" }
    }
  }
}
```

The response includes the channel id. Passwords come back as `••••` — they're encrypted via pgcrypto and never re-emitted.

Verify:

```jsonc
{ "name": "conv_email_test_channel", "arguments": { "channelId": "<emailChannelId>" } }
```

Returns `{ smtp: 'ok'|'error: …', imap: 'ok'|'error: …'|'not configured' }`. **Don't proceed if SMTP fails** — outbound mail will silently dead-letter. IMAP failures are softer (you can fall back to forwarding).

## Step 3 — widget channel

Per `skill://conv/setup-chat-widget`:

```jsonc
{
  "name": "conv_widget_create_channel",
  "arguments": {
    "name": "acme-storefront-bot",
    "originAllowlist": ["https://www.acme.com", "https://shop.acme.com"]
  }
}
```

Response includes `widgetKey: "mn_widget_..."` — **shown once**. Hand it to the customer's developer to store server-side. Rotate later via `conv_widget_rotate_key` if it leaks.

`originAllowlist` is enforced on every push from the widget endpoint; setting it correctly here saves a CORS bug report later.

If the customer wants escalation webhooks (their bot should yield when a human in Munin replies), point them at `skill://conv/escalate-to-human` — handoff uses the standard `conversation.message.sent` webhook, not a widget-specific one.

## Step 4 — confirm

```jsonc
{ "name": "conv_list_channels", "arguments": {} }
```

Both channels should appear with `active: true`. If either is `active: false`, the test/setup didn't complete — re-run that channel's flow.

## Step 5 — seed topics (optional)

Topics are conversation labels that route inbound messages to the right humans. Create the starter set with `conv_create_topic`, one call per topic:

```jsonc
{ "name": "conv_create_topic", "arguments": { "name": "Billing" } }
{ "name": "conv_create_topic", "arguments": { "name": "Bug report" } }
{ "name": "conv_create_topic", "arguments": { "name": "Feature request" } }
{ "name": "conv_create_topic", "arguments": { "name": "Account access" } }
```

## What NOT to do

- **Don't try to assign channels to a team at create time.** Channels are org-scoped; routing happens per-conversation via `conv_assign_conversation`. There's no "channel owner" field.
- **Don't paste the widget key into the customer's repo or a Slack message.** Treat it like a password — it's shown once because the server only stores its hash.
- **Don't skip `conv_email_test_channel`.** A bad SMTP password silently fails on the first delivery attempt and looks like a customer-side problem when really it's a config error.
- **Don't enable the widget without an `originAllowlist`.** An empty list means anyone can POST to the widget endpoint with the key — fine for staging, embarrassing in production.

## Related

- `skill://conv/setup-email-channel` — detailed SMTP/IMAP config.
- `skill://conv/setup-chat-widget` — push transcript flow + key minting.
- `skill://conv/escalate-to-human` — webhook-based handoff.
- `skill://playbooks/support-desk-launch` — full support desk stand-up across conv + crm + kb.
