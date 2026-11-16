---
'@getmunin/chat-widget': patch
---

Three chat widget error paths now behave as the visitor would expect.

- A failed voice call says so. "Voice call failed" was written to the call panel's status line in the same step that closed the panel, so the visitor landed back in chat with no explanation. It now appears in the composer note.
- A message that fails to send is put back. The composer used to clear the text and images before the request went out, so a failure lost them and "Try again" meant retyping. They are now restored with the send-failure note, unless the visitor has typed something new or moved to another conversation in the meantime. Restored images keep their upload ids, so resending doesn't upload them again.
- The 10 MB image limit is checked after downscaling. A large phone photo used to be refused before the widget shrank it to 1600 px. Now only files that can't be shrunk are refused up front: GIFs, files over 50 MB, or any file when the browser has no `createImageBitmap`. A photo still over the limit after shrinking gets the size message rather than "That image didn't upload".
