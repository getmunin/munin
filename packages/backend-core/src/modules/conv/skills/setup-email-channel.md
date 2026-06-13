---
title: Conv: Set up an email channel
description: Configure SMTP outbound and optional IMAP inbound for an email channel, then verify the credentials.
audiences: [admin]
---

# Set up an email channel
Use this when a customer wants Munin to send and receive email under one of their addresses (e.g. `support@acme.com`).

## TL;DR

1. Decide outbound: their own SMTP server, or send through Munin's configured Mailer (Resend).
2. Decide inbound: poll IMAP, or rely on the customer forwarding to a `MUNIN_EMAIL_REPLY_DOMAIN` address.
3. Call `conv_setup_email_channel` with the full config.
4. Call `conv_test_email_channel` to verify creds without sending mail.
5. Confirm the channel appears in `conv_list_channels` with `active: true`.

## Step 1 — gather the config

Required from the operator:

- **Addressing**: `fromAddress` (must be a real mailbox they control), optional `fromName` (e.g. "Acme Support").
- **Outbound mode**:
  - `smtp` — host, port, secure (TLS yes/no), username, password. Most providers: port 587 with `secure: false` (STARTTLS) or 465 with `secure: true`.
  - `mailer` — no extra config; uses the Munin instance's configured Mailer. Best for self-host without an SMTP relay.
- **Inbound (optional)**: IMAP host, port, secure, username, password, mailbox name (defaults to `INBOX`).

Passwords are stored encrypted via pgcrypto. If you re-call `conv_setup_email_channel` later with empty password fields, the prior encrypted password is preserved — useful when the operator only wants to update non-secret fields.

## Step 2 — create the channel

Call `conv_setup_email_channel` (admin):

```jsonc
{
  "name": "Acme Support",
  "config": {
    "addressing": {
      "fromAddress": "support@acme.com",
      "fromName": "Acme Support",
      "replyToTemplate": "support+conv-{conversationId}@acme.com"
    },
    "outbound": {
      "provider": "smtp",
      "host": "smtp.acme.com",
      "port": 587,
      "secure": false,
      "username": "support@acme.com",
      "password": "<plaintext-once>"
    },
    "inbound": {
      "provider": "imap",
      "host": "imap.acme.com",
      "port": 993,
      "secure": true,
      "username": "support@acme.com",
      "password": "<plaintext-once>",
      "mailbox": "INBOX"
    }
  }
}
```

Returns the channel ID, type `'email'`, and the redacted DTO (passwords show as `••••`).

To **update** an existing channel, pass `channelId` and only the fields you want to change. Empty password strings preserve the stored secret.

## Step 3 — verify

Call `conv_test_email_channel` with `{ channelId }`. It performs:

- An SMTP `verify()` (no mail sent).
- An IMAP `connect()` then `logout()` (no fetch).

Returns `{ smtp: 'ok' | 'error: <message>', imap: 'ok' | 'error: <message>' | 'not configured' }`.

If `smtp` reports auth failure, the most common causes are app-password-required (Gmail, iCloud), the wrong port for the cipher (587 STARTTLS vs 465 implicit-TLS), or a region-specific endpoint (Microsoft 365 enforces `smtp.office365.com`).

## Step 4 — confirm registration

Call `conv_list_channels`. Look for the new row with `type: 'email'`, `active: true`, and the addressing block.

## What happens next

- **Outbound**: when an admin uses `conv_send_message` on a conversation tied to this channel, the message is enqueued in `conv_message_deliveries`. The `OutboundDeliveryWorker` drains that queue and the email adapter sends via SMTP (or the Mailer).
- **Inbound** (if IMAP is configured): the `InboundPollWorker` ticks every 60s, fetches new UIDs, threads each message into an existing conversation (via `In-Reply-To` + `References` headers) or opens a new one. End-user senders are auto-created as `conv_contacts`.

## Troubleshooting

- **No outbound delivery** — check `conv_message_deliveries` rows for the channel. `status='dead'` means 5 attempts failed; the `error` column has the SMTP response. `conv_test_email_channel` is the fastest way to check creds.
- **Inbound stuck** — `conv_inbound_state.cursor.lastUid` shows the high-water mark; `last_polled_at` shows the most recent tick; `last_error` carries any IMAP error.
- **Email lands in spam at the recipient** — confirm SPF / DKIM / DMARC for the `fromAddress` domain. Munin doesn't manage DNS.
