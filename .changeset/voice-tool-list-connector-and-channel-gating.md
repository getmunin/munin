---
'@getmunin/backend-core': minor
'@getmunin/mcp-toolkit': minor
---

Gate the voice tool list a Threll or Vapi call gets by connector state and channel appropriateness.

Every voice call — Threll phone calls, Threll web-widget voice, Vapi — built its tool list from the full `self_service` registry with no filtering. Two consequences: `commerce_*`/`bookings_*` tools were offered to the voice agent even when the org had never configured a commerce or bookings connector connection, and `conv_request_human` (an async "flag this conversation for a teammate to review later" tool) was offered on live calls where it can't actually pull a human into the call — `conv_request_callback`, which places a real outbound call, is the voice-appropriate escalation.

`@McpTool` gains `excludeChannelKinds`, and `McpToolRegistry.list()` takes an optional `{ channelKind }` filter; `conv_request_human` now sets `excludeChannelKinds: ['voice']`. A new `VoiceSelfServiceToolsService` — shared by `ThrellToolBridge` and `VapiToolBridge`, so a future voice vendor picks up the same behavior for free — additionally drops connector-backed tools per-request when `ConnectorsService.listActiveDomains` reports no active connection for their domain. Both bridges' `dispatch()` route through the same service's `isCallable`, so a channel-excluded tool is rejected even when a client calls it by name outside the advertised list.

`listActiveDomains` resolves every domain in one indexed read on the caller's executor. `WidgetVoiceService.startSession` builds its tool list inside an open transaction, so the check has to reuse that transaction: acquiring a second pool connection while the first is held deadlocks the pool once concurrent voice starts reach `MUNIN_DB_POOL_MAX` (default 10), since no outer transaction can commit until an inner connection it will never be granted frees up. The domain→tool-prefix map is keyed by `ConnectorDomain`, so adding a third connector domain is a compile error here until it is gated too.
