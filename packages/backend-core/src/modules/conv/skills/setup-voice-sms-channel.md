---
title: Set up a voice or SMS channel
description: Configure a Vapi/Threll voice channel or Twilio/MessageBird SMS channel with non-secret config, hand off the API keys through a credential link, and verify the result.
audiences: [admin]
---

# Set up a voice or SMS channel

Use this when a customer wants Munin on a phone number — an AI voice line (Vapi, Threll) or two-way SMS (Twilio, MessageBird).

## TL;DR

1. `conv_list_channel_vendors` — see the supported vendors and each one's config fields; fields marked `secret: true` are never passed by you.
2. `conv_configure_channel` with `vendor`, a `name`, and the **non-secret** config fields. The channel is created inactive and the response includes a one-time **credential link**.
3. Share the credential link — the human enters the vendor API keys in the dashboard. Saving completes the vendor-side setup (webhook registration where applicable), verifies the credentials, and activates the channel. The link works once and expires after 24 hours; mint a fresh one with `conv_request_channel_credentials`.
4. `conv_test_channel` re-verifies stored credentials any time; `conv_send_channel_test` (SMS) sends a real message.

**Never ask for an API key, auth token, or signing key in the conversation** — the tool rejects secret fields.

## Per-vendor non-secret config

- **Vapi (voice)** — `assistantId` (required; the human finds it in the Vapi dashboard), `phoneNumberId` (only for PSTN calls), `publicKey` (only for in-browser voice via the widget), `replaceWebhook: true` if the assistant already has a non-Munin server URL. The link asks for the API key and a webhook secret of your choosing; on save Munin configures the assistant's server URL automatically.
- **Threll (voice)** — `workerId` (required; from the Threll webapp), `accountId` (optional, resolved from the API key). The link asks for the API key; on save Munin creates the webhook subscription and stores the signing secret Threll returns.
- **Twilio (SMS)** — `accountSid` (required) plus `fromNumber` or `messagingServiceSid`. The link asks for the auth token.
- **MessageBird (SMS)** — `originator` (required). The link asks for the access key and signing key.

## While the channel is pending

A channel waiting on its credential link is `active: false` and every admin action on it (`conv_test_channel`, `conv_call_channel`, `conv_send_channel_test`, `conv_list_channel_options`, updates) answers `conv_invalid: channel is awaiting credentials`. If the link expired, mint a new one with `conv_request_channel_credentials { channelId }`.

## Picking assistant/worker ids

`conv_list_channel_options` lists a vendor's selectable options (Vapi assistants, Threll workers) **using a channel's stored credentials** — so it works only after the credential link is completed. For the initial create, the human reads the id from the vendor dashboard; to switch later, complete setup first, then call `conv_list_channel_options { channelId }` and update with `conv_configure_channel`.

## Verify

- `conv_test_channel { channelId }` — vendor-shaped credential check (Twilio account fetch, MessageBird balance, etc.), no message sent.
- SMS: `conv_send_channel_test { channelId, to }` sends a real message end-to-end.
- Voice: `conv_call_channel { channelId, to }` places a real outbound call.
