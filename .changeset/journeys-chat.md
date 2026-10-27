---
'@getmunin/backend-core': minor
'@getmunin/types': minor
'@getmunin/dashboard-pages': minor
---

Journeys can write to people in the chat widget. A `message` step with `channel: "chat"` posts in the widget channel set in `settings.chatChannelId`, but only to a contact whose end user signed in with a verified widget identity; anyone else is skipped with `no_chat_identity`. A chat step carries markdown up to 2000 characters, can run `auto` when a person sets that while publishing, and keeps all of a person's journey chat messages on one channel in one server-started thread that the widget shows in any session. Consent, the weekly cap and quiet-while-talking apply; quiet hours do not.

After sending, the step waits for `conversation.message.read` on that message. `seenTimeout` (default three days) bounds the wait and `onUnseen` routes an unseen message elsewhere, so a journey can fall back to email when the visitor never comes back. The simulator assumes the message is seen, and the graph labels chat steps. Agent-drafted chat messages are not available yet.
