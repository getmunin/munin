---
"@getmunin/chat-widget": patch
---

Keep the composer focused after sending a message. Disabling the textarea while a send was in flight dropped its focus and re-enabling it didn't restore it, forcing the user to click back into the field before each new message. The widget now restores focus to the composer once the send completes.
