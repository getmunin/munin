---
'@getmunin/backend-core': minor
'@getmunin/chat-widget': minor
---

The server can start a chat-widget conversation for a signed-in visitor: `ConvService.startWidgetConversation` finds the visitor's verified identity from their end user (anonymous visitors are refused), reuses or creates their contact, and opens a conversation they see in the widget. The realtime gateway now tells a verified visitor's open widget about a new conversation of theirs or a new message in it even when it belongs to another session, and widget conversation summaries carry `unreadCount`. The widget refreshes its conversations on those events, counts unread messages across conversations on the launcher badge, and shows the newest unread message in a bubble that opens that conversation; dismissing the bubble hides it until the conversation gets another message.
