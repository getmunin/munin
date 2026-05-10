---
"@getmunin/backend-core": minor
"@getmunin/dashboard-pages": minor
---

Drop the unused `displayName` field from chat-widget channels. The field was required at create time but was never read by the chat-widget itself — only echoed in the dashboard's channel list. Removed from the MCP tool inputs (`conv_widget_create_channel`, `conv_widget_update_channel`), the `WidgetChannelConfig` zod schema, the REST body schemas in `ConvChannelsController`, the dashboard's "Add chat widget" form and channel-row display, and the widget-onboarding / bulk-channel-setup skill docs. Existing rows keep `displayName` in their `conv_channels.config` jsonb but it gets silently stripped on next parse — no migration required.

Also fixes a NestJS route-ordering bug where `ConversationsController @Get(':id')` shadowed `ConvChannelsController @Get()`, causing `/api/v1/conversations/channels` to return `conv_not_found: conversation channels` instead of the channel list. `ConvChannelsController` is now registered before `ConversationsController` in `ControlModule`.
