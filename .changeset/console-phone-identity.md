---
'@getmunin/backend-core': minor
'@getmunin/dashboard-pages': minor
---

Name a caller by their phone number instead of "Anonymous visitor".

A voice conversation usually carries a number and nothing else — no name, no email — so every call in the queue read "Anonymous visitor", indistinguishable from the next one, while the number itself sat unformatted in the thread header. The queue read model now returns `customerPhone` (contact phone, falling back to the end user's), and the queue row, the thread header and every inbound bubble in the thread resolve identity through one `customerIdentity` helper: name, then email, then the phone formatted with `libphonenumber-js` (`+47 95 03 94 93`). Queue search matches the raw number, so pasting a caller ID from a missed call finds the conversation. The thread header drops its separate phone chip when the title already is that number, and an unparseable number is shown as written rather than hidden.

Only the fallback moved. A message that carries its own `authorName` still shows it, and "Anonymous" remains the label when the conversation genuinely has no name, email or number — a widget visitor who never identified themselves.

The API keeps the raw E.164 string; formatting is a dashboard concern.
