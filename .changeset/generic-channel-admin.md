---
"@getmunin/backend-core": minor
---

Replace per-vendor voice/SMS channel admin MCP tools with a generic, registry-driven surface that scales as vendors are added.

- New `ChannelAdminProvider` contract: each configurable voice/SMS vendor registers one provider (config schema + capabilities + configure/test/call/sendTest), dispatched by `ChannelAdminService`.
- Generic MCP tools replace the per-vendor ones: `conv_list_channel_vendors` (discovery — lists each vendor's config fields), `conv_channel_configure`, `conv_channel_test`, `conv_voice_call`, `conv_channel_send_test`. Removed `conv_{vapi,threll}_configure/test_channel/call_initiate` and `conv_{twilio,messagebird}_sms_configure/test_channel/send_test` (and `conv_voice_call_initiate`).
- Generic `/v1/conversations/channels` control-plane endpoints (`GET /vendors`, `POST /`, `POST /:id/{test,call,send-test}`); the existing per-vendor endpoints are retained for the dashboard.
- Adding a voice/SMS vendor now means registering one provider — no new tools, endpoints, or types. Email and the chat widget keep their bespoke tools.
