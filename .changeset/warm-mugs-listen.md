---
'@getmunin/chat-widget': patch
'@getmunin/backend-core': patch
'@getmunin/docs-pages': patch
---

Expose the widget greeting's trailing-clause emphasis as the `--munin-greeting-emphasis` custom property, defaulting to the existing serif italic. Sites that want the clause upright can now set it to `normal` from their own stylesheet: custom properties inherit across the shadow boundary, so this is the one override route that does not depend on the panel's internal class names.
