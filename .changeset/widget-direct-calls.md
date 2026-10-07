---
"@getmunin/chat-widget": minor
"@getmunin/backend-core": patch
"@getmunin/docs-pages": patch
---

Let a page start a voice call in the chat widget directly. Any element with `data-munin-call` opens the panel and starts the call when clicked, and `window.mn.widget.call()` does the same from script. `call()` resolves to `{ started: true }`, or to `{ started: false, reason }` so the page can fall back to a phone number when no voice channel is linked or the visitor denies the microphone. `window.mn.widget.endCall()` hangs up. The call joins the visitor's current conversation, or starts one if there is none. Two quick triggers no longer race into two calls, and this also applies to the in-panel call button.
