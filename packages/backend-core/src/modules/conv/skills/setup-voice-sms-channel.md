---
title: Set up a voice, SMS or WhatsApp channel
description: Configure a Vapi/Threll voice channel, a Twilio/MessageBird SMS channel, or a WhatsApp Business channel on Meta's Cloud API with non-secret config, hand off the secrets through a credential link, and verify the result.
audiences: [admin]
---

# Set up a voice, SMS or WhatsApp channel

Use this when a customer wants Munin on a phone number — an AI voice line (Vapi, Threll), two-way SMS (Twilio, MessageBird), or WhatsApp Business (Meta Cloud API, vendor `meta`).

## TL;DR

1. `conv_list_voice_sms_vendors` — see the supported vendors and each one's config fields; fields marked `secret: true` are never passed by you.
2. `conv_configure_voice_sms_channel` with `vendor`, a `name`, and the **non-secret** config fields. The channel is created inactive and the response includes a one-time **credential link**.
3. Share the credential link — the human enters the vendor API keys in the dashboard. Saving completes the vendor-side setup (webhook registration where applicable), verifies the credentials, and activates the channel. The link works once and expires after 24 hours; mint a fresh one with `conv_request_channel_credentials`.
4. `conv_test_voice_sms_channel` re-verifies stored credentials any time; on an SMS channel `conv_send_sms_channel_test` also sends a real message.

**Never ask for an API key, auth token, or signing key in the conversation** — the tool rejects secret fields.

## Per-vendor non-secret config

- **Vapi (voice)** — `assistantId` (required; the human finds it in the Vapi dashboard), `phoneNumberId` (only for PSTN calls), `publicKey` (only for in-browser voice via the widget), `replaceWebhook: true` if the assistant already has a non-Munin server URL. The link asks for the API key and a webhook secret of your choosing; on save Munin configures the assistant's server URL automatically.
- **Threll (voice)** — `workerId` (required; from the Threll webapp), `accountId` (optional, resolved from the API key), `replaceWebhook: true` if that worker already has a webhook subscription pointing somewhere other than Munin. The link asks for the API key; on save Munin creates a webhook subscription **scoped to that worker** and stores the signing secret Threll returns. Other workers on the same Threll account keep their own webhooks, so several Munin channels can share one account — one channel per worker. Pointing an existing channel at a different worker re-registers the subscription on the new worker and removes the old one.
- **Twilio (SMS)** — `accountSid` (required) plus `fromNumber` or `messagingServiceSid`. The link asks for the auth token.
- **MessageBird (SMS)** — `originator` (required). The link asks for the access key and signing key.
- **Meta (WhatsApp)** — `wabaId` and `phoneNumberId` (both required), `graphApiVersion` (optional, e.g. `"v23.0"`; the default is the version Munin is tested against). The link asks for the access token and the app secret. See *WhatsApp prerequisites* below — this is the one vendor where the human has homework in another console first.

## WhatsApp prerequisites

Munin talks to Meta's WhatsApp Cloud API directly, with no reseller in between, so the org brings its own Meta app. Before creating the channel, the human needs, in Meta Business Manager / the Meta developer console:

1. **A Meta app with the WhatsApp product added**, owned by a verified business. Business verification is Meta's process and can take days; nothing in Munin speeds it up.
2. **A WhatsApp Business Account (WABA) and a registered phone number.** The number must be able to receive Meta's verification SMS or call once. It can be a number already used for SMS or voice elsewhere; a number already running on the WhatsApp or WhatsApp Business app has to be migrated per Meta's instructions first.
3. **A permanent system-user access token** with `whatsapp_business_messaging` and `whatsapp_business_management`, assigned to the WABA. A temporary 24-hour token from the API Setup page will work for a test and then silently expire, so don't use one for a real channel.
4. **The two ids** from WhatsApp → API Setup: the *WhatsApp Business Account ID* (`wabaId`) and the *Phone number ID* (`phoneNumberId` — a long number, **not** the phone number itself).
5. **The App Secret** from App settings → Basic. Munin uses it to verify that webhook deliveries really come from Meta.
6. The display name approved by Meta, if the customer wants their brand name to show instead of the number.

Then:

```jsonc
{
  "name": "conv_configure_voice_sms_channel",
  "arguments": {
    "vendor": "meta",
    "name": "Support WhatsApp",
    "defaultAgentMode": "auto",
    "config": { "wabaId": "1234…", "phoneNumberId": "5678…" }
  }
}
```

When the human saves the access token and app secret through the credential link, Munin checks the token against the phone number, subscribes the app to the WABA, and registers its own webhook URL **on that phone number** (Meta's per-number webhook override), answering Meta's verification challenge itself. Other numbers on the same Meta app keep their own webhooks, so one app can serve several Munin channels. If saving fails, the link reports Meta's error verbatim — the usual causes are a token without the two permissions or a `phoneNumberId` that isn't the Phone number ID.

`conv_list_channels` then shows the channel with `displayPhoneNumber` and `verifiedName` from Meta.

### How WhatsApp differs once it is live

- **The 24-hour window.** Free text reaches the customer only within 24 hours of their last message. Outside it, WhatsApp accepts approved templates only — see `skill://conv/send-whatsapp-template`. `conv_get_conversation` reports `whatsappWindow: { open, closesAt }` on every WhatsApp conversation, and `conv_send_message` refuses a free-text message on a closed window with `conv_whatsapp_window_closed`.
- **Voice notes are transcribed** when a transcription model is selected in the AI settings; the audio stays attached and the transcript becomes the message body. Until then the agent waits, and a voice note that can't be transcribed goes to a human.
- **Images** arrive as attachments; documents, video, locations and stickers arrive as a short bracketed description the agent can't open.
- **Read receipts** are recorded like email opens — `firstOpenedAt` on the message — unless the customer has turned read receipts off in WhatsApp.
- **Opt-out** works like SMS (a message that is just `STOP`, `STOPP`, `SLUTT`, …), and a marketing template's *Stop promotions* button also suppresses the contact.

## While the channel is pending

A channel waiting on its credential link is `active: false` and every admin action on it (`conv_test_voice_sms_channel`, `conv_send_sms_channel_test`, `conv_list_channel_options`, updates) answers `conv_invalid: channel is awaiting credentials`. If the link expired, mint a new one with `conv_request_channel_credentials { channelId }`.

`conv_list_channels` marks such a channel `needsCredentials: true`. A human already signed in to the dashboard does not need the link at all — Channels shows the channel as **Awaiting credentials** with an **Enter credentials** button that asks for exactly that vendor's secret fields. The link is for handing the job to someone who is not in the dashboard.

Once setup is complete the stored secrets show up as `••••` in that listing — vendor keys, auth tokens and signing keys never leave Munin, in any form, so there is nothing to read back or repeat.

## Picking assistant/worker ids

`conv_list_channel_options` lists a vendor's selectable options (Vapi assistants, Threll workers) **using a channel's stored credentials** — so it works only after the credential link is completed. For the initial create, the human reads the id from the vendor dashboard; to switch later, complete setup first, then call `conv_list_channel_options { channelId }` and update with `conv_configure_voice_sms_channel`.

## Inbound behaviour

Replies thread. A second message from the same number on the same channel lands in that number's most recent open conversation rather than opening a new one; a snoozed conversation is reopened. A new conversation is started only when the previous one was closed.

**Set `defaultAgentMode` per SMS or WhatsApp channel.** `conv_configure_voice_sms_channel { channelId, vendor, defaultAgentMode }` decides what the agent does with messages arriving on that number: `auto` replies directly, `draft_only` files a draft for a human to approve, `off` does neither. Use `draft_only` on a number you only send campaigns from, so a reply is never auto-answered. It applies to SMS and WhatsApp only — an inbound call is run by the vendor's assistant, not the Munin agent, so passing it on a voice channel is rejected.

**SMS opt-out is automatic and irreversible from your side.** An inbound SMS whose entire body is an opt-out keyword — `STOP`, `STOPP`, `SLUTT`, `AVMELD`, `UNSUBSCRIBE`, `END`, `QUIT`, `CANCEL`, `STOPALL`, case-insensitive, trailing punctuation ignored — suppresses the CRM contact holding that phone number: `doNotContact` is set, `unsubscribedAt` is stamped, and a `crm_activities` note records it. The message is still ingested so the conversation reads truthfully. A sentence that merely contains one of those words ("can you cancel my order?") is an ordinary message and suppresses nothing.

Suppressed contacts drop out of `crm_list_contacts_in_segment`, so they stop appearing in outreach audiences. Do not clear the flag to re-add someone — if they ask to opt back in, that is a new consent decision a human records.

## How a call transcript reads back

`conv_get_conversation` returns a call as one message per turn, in the order the turns were spoken — `metadata.voiceTurnIndex` carries that position and `created_at` is derived from it, so a webhook that arrives late never reorders the transcript. The caller's turns are `author_type: end_user`, the assistant's are `agent`.

A caller turn whose audio produced no words is kept as a turn with an **empty body** and `metadata.voiceNoSpeech: true` — the caller spoke or was cut off, and speech recognition returned nothing. It is kept because dropping it makes the transcript read as if the assistant answered a question nobody asked. Report it as "nothing was transcribed", never as something the caller said, and never treat the silence as agreement. The dashboard renders it as a placeholder line and the chat widget hides it.

## Verify

- `conv_test_voice_sms_channel { channelId }` — vendor-shaped credential check (Twilio account fetch, MessageBird balance, etc.), no message sent.
- SMS: `conv_send_sms_channel_test { channelId, to }` sends a real message end-to-end. Voice vendors have no test send — the tool answers `channel vendor 'vapi' does not support test sends`.
- WhatsApp: `conv_test_voice_sms_channel` returns the number's display name, verified name and quality rating. `conv_send_sms_channel_test { channelId, to }` sends free text, which only arrives if `to` has messaged the channel in the last 24 hours — so have the human text the number from their phone first, or pass `templateName: "hello_world", templateLanguage: "en_US"` to send Meta's default template, which works any time.
- Voice: there is no tool that places a call. A human verifies the channel end-to-end from the dashboard — Channels → the channel's ⋯ menu → **Make a test call**.
