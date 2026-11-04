---
'@getmunin/backend-core': minor
'@getmunin/dashboard-pages': minor
'@getmunin/types': minor
---

`conv_update_widget_channel` now takes a `name`, matching `analytics_update_tracker`'s existing shape: renaming a chat-widget channel no longer requires creating a new one (and rotating its widget key and identity secret) just to drop a temporary suffix like the `(new)` used while running two deployments side by side during a migration.

The dashboard's widget channel edit dialog gained the matching "Internal name" field. The analytics tracker card also gained an edit dialog — previously the only way to rename a tracker or change its origin allowlist was through MCP — and its "Edit" button now sits beside the embed/install action, which moved to a secondary (ghost) style to match the chat widget card.
