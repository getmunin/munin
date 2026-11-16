---
'@getmunin/chat-widget': patch
---

The chat widget now tells the visitor about failures it used to keep in the console, and lets them act on them.

- While the "Reconnecting…" bar shows, the presence line under the conversation title reads "Offline" with a grey dot instead of a green "Online now".
- A PDF or other non-image file dropped or pasted into the chat gets "We take PNG, JPEG, GIF and WebP." instead of being ignored.
- A failed image upload shows a retry button on its thumbnail, which uploads the same file again.
- An email that fails to save on the "Save this thread" card shows an error under the field, cleared on the next attempt.
- History that fails to load shows "Couldn't load messages. Retrying…" in the status bar while the widget retries with backoff (2 s doubling to 30 s). A connection problem takes priority in that bar.
- A call started from the host page that can't create its conversation shows "Voice call failed".

Four new strings, translated for every locale: `statusOffline`, `attachRetryAriaLabel`, `emailSaveFailed`, `historyLoadFailed`.
