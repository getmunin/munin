---
'@getmunin/dashboard-pages': patch
---

Stop the inbox composer from reporting a pending draft as "edited by you" when you reopen a conversation you have already visited.

`conversation-pane` mirrors the composer text in `replyRef` so the draft-seeding effect can read it without depending on it. The per-conversation reset effect cleared the `reply` state but not that mirror, and the mirror is only re-synced on the next render. Reopening a conversation whose detail is already cached puts the selection change and the draft in the same commit, so the seeding effect ran with the *previous* conversation's text still in the ref, judged the composer "touched", and skipped seeding — leaving an empty box with a non-null `suggestionId`, which renders as "edited by you" plus a Restore draft button. The reset now clears the mirror alongside the state, so the cached draft seeds exactly as it does on a fresh page load.
