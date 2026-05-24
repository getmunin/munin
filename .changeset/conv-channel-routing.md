---
'@getmunin/backend-core': minor
'@getmunin/backend': patch
---

Explicit voice channel routing for orgs with multiple active Vapi voice channels.

- `conv_voice_call_contact` MCP tool accepts an optional `channelId` to pick a specific voice channel; with a single channel the call falls back to it.
- Widget channel config gains `voiceChannelId` so the chat widget's "call now" button routes deterministically when multiple voice channels exist.
- When >1 voice channels are configured and no routing hint is provided, callers get `multiple_active_voice_channels` (tool) / `multiple_voice_channels_without_widget_routing` (widget) instead of an arbitrary pick.
