---
"@getmunin/chat-widget": patch
---

fix(widget): stop iCloud Passwords popover from opening on the message composer

The composer textarea had no `autocomplete` attribute, so browsers defaulted it to `on` and the iCloud Passwords extension classified the widget as a login form (helped by the save-thread email field), offering credential autofill when typing a message. Set `autocomplete="off"` (and `autocorrect="off"`) on the composer to opt it out.
