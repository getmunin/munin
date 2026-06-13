---
"@getmunin/backend-core": minor
---

Add a Threll voice channel (`type: voice`, `vendor: threll`), mirroring the Vapi integration.

- `conv_threll_configure` / `conv_threll_test_channel` / `conv_threll_call_initiate` MCP tools and `/v1/conversations/channels/threll*` control-plane endpoints.
- Webhook adapter handling Threll's `call.worker_request` (returns dynamic instructions + self-service tools + correlation metadata), `call.tool_call` (dispatches MCP tools, returns the result), `call.transcript`, `call.status_update`, and `call.ended`. Inbound deliveries are authenticated via the `X-Threll-Signature` HMAC-SHA256.
- Conversations are correlated by Threll `callId` (`metadata.threllCallId`), with a matching unique index.
- In-browser widget voice now works for Threll via Threll's web-call endpoint. The widget-voice bundle gains a generic `WebRtcVoiceSession` (vendor-agnostic peer connection / media / state) driven by a pluggable `SignalingChannel`, with a `threll` signaling adapter — so any SDK-less vendor can be added by registering one adapter. `WidgetVoiceService` is now vendor-aware (Vapi SDK descriptor vs. Threll WebRTC descriptor).
