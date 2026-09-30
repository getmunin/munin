---
'@getmunin/backend-core': minor
'@getmunin/agent-runtime': minor
'@getmunin/dashboard-pages': minor
---

Show an automatic draft in the teammate's own language. A draft the agent writes on its own (draft-only mode, or a reply it parks for review) is in the customer's language. When a teammate who reads another language opens the conversation, the pending draft is now translated along with the thread, and the composer holds it in their language, ready to edit. While that translation is on its way the reply box shows "Translating draft"; if it doesn't arrive within a minute, the draft is shown as written.

- A draft records the language it was written in. `POST /v1/conversations/:id/draft-reply` takes an optional `language`, and the agent sets it on drafts asked for in a given language. A draft without one is taken to be in the customer's language.
- `GET /v1/conversations/:id/pending-translations` includes the pending draft when its language differs from the target, and `POST /v1/conversations/:id/translations` accepts its translation. The detail's `translations` block then carries it like any message.
- Approving a translated draft without changes sends the agent's original text, not a translation of the translation, and stores what the teammate saw as the sent message's translation. An edited draft is translated on send as before.
- The translation prompt keeps labels in square brackets, such as `[DELIVERY DATE]`, exactly as written, so the check for unfilled facts still finds them in the translated draft.
