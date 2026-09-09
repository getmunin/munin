---
'@getmunin/backend-core': patch
'@getmunin/chat-widget': patch
---

fix(widget): the voice call screen names the org's assistant

The voice overlay and its minimized banner had exactly two cases: a human took
over (use `assigneeName`) or it's the AI, in which case they fell back to the
localized `defaultAuthorName` — "Agent" in every locale. An org that named its
assistant Thea saw "Thea" in the chat transcript and "Agent" the moment the
caller switched to voice.

The name was already resolved server-side, but only per message: list-messages
stamped `assistants.name` on each agent message's `authorName` and never put it
on the conversation envelope, which is all the overlay reads. `agentName` now
rides along on the envelope (falling back to `Munin`, matching the per-message
behaviour), and the widget prefers it over the generic string. A human assignee
still wins once the conversation is handed over.

The lookup also no longer waits for an agent message to exist, so a brand-new
conversation — the common case for starting a call before the assistant has said
anything — has the name available on its first load.
