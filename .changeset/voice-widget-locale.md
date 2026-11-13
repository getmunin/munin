---
'@getmunin/backend-core': patch
---

A voice call started from the chat widget now greets the caller in the widget's language. The widget's locale was stored on the conversation but never reached the voice agent, so when the visitor had not typed anything yet the agent guessed a language from the company context — a Swedish widget could open a call in Norwegian. The voice system prompt for widget calls (Threll and Vapi) now carries a `[Language]` block naming the widget locale; the agent still switches if the caller's own messages or speech are in another language. Missing or unrecognised locales add nothing.
