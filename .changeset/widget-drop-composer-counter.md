---
'@getmunin/chat-widget': patch
---

Stop the message box from changing width while the visitor types. The character counter shared a column with the send button and widened it every time the count gained a digit, which squeezed the message box at 10, 100 and 1000 characters. The counter is gone, and the message box now stops accepting text at the 1000-character limit, so it never reaches a state where send is silently disabled.
