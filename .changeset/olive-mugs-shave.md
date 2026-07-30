---
'@getmunin/backend-core': minor
'@getmunin/dashboard-pages': patch
---

Remove the MCP tools that place outbound voice calls

`conv_call_channel` and `conv_call_contact` no longer exist on the MCP surface, so no connected agent can place a phone call. Anthropic's MCP directory does not list connectors that let an assistant dial third parties on its own, and an in-client tool-approval click does not clear that bar.

Nothing else changes. The `VoiceCallbackService` and `ChannelAdminService.call` service methods stay, the `/v1/conversations/channels/:id/call` endpoints stay, and the dashboard's per-channel test call keeps working — it is authenticated as a human dashboard session, not as an agent. `conv_request_callback` also stays: it is `self_service`-only, so it is reachable by an org's own end-user agents (the widget's "can you call me?" flow) and refused for admin callers by the audience gate in `dispatch.ts`.

The dashboard action is renamed from "Place a call" to "Make a test call", matching "Send test email" and "Send test SMS" — verifying a newly configured voice channel is what it is for.

Outbound calling as a product capability moves to `outreach`, where a voice campaign already drafts a proposal that a human approves before anything is dialed.
