---
'@getmunin/backend-core': minor
---

Rename `conv_send_voice_sms_channel_test` → `conv_send_sms_channel_test`

The send path dispatches on `capabilities.sendTest`, which only Twilio and MessageBird set. Vapi and Threll both declare `sendTest: false`, so on a voice channel the tool has always answered `channel vendor 'vapi' does not support test sends` — the `voice_sms` qualifier 4.76.0 gave it promised a path that does not exist.

Its sibling `conv_test_voice_sms_channel` keeps the qualifier: all four vendors implement the credential check. The pair reads asymmetrically now, which is the point — their reach differs.

The description says SMS-only and points voice at `conv_test_voice_sms_channel` for credentials and the dashboard's **Make a test call** for end-to-end. `skill://conv/setup-voice-sms-channel` names the error a voice channel gets. There is still no MCP tool that places a call: `ChannelAdminService.call()` stays `/v1`-only, human-initiated.
