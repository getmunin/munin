---
'@getmunin/chat-widget': patch
---

Greet first-time visitors when the widget opens. A visitor with no past conversations is taken straight to a new chat, but that path never created the conversation, so the agent's greeting only arrived after they chose "New conversation" by hand. Opening into a new chat now starts the conversation on the current session, the same way the button does.
