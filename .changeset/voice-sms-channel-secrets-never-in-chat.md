---
'@getmunin/backend-core': minor
---

Voice/SMS channel secrets can no longer transit the conversation

`conv_configure_channel` now rejects secret config fields (Vapi/Threll API keys,
Twilio auth tokens, MessageBird access/signing keys) — completing the contract that
connectors and email channels already follow. Creating a channel stores a pending row
(`active: false`, non-secret config under `pendingSetup`) and returns the one-time
credential link; saving the secrets runs the vendor's `completeSetup`, which performs
the create-time vendor side effects at apply time — Vapi's assistant-webhook install
and Threll's webhook-subscription creation (whose signing secret the vendor mints) —
then verifies the credentials with the vendor's test call and activates the channel.

Every admin action on a pending channel (test, call, send-test, options, updates)
answers `conv_invalid: channel is awaiting credentials` instead of a raw 500 from the
strict stored-config schemas. `conv_list_channel_options` drops its credentialed
pre-create discovery mode — options are listed with a channel's stored credentials
after the link completes; initial assistant/worker ids come from the vendor dashboard.
The new `setup-voice-sms-channel` skill documents the flow, and the `/v1` dashboard
paths are unchanged.
