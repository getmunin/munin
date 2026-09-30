---
'@getmunin/backend-core': minor
'@getmunin/agent-runtime': minor
---

Translate new messages with the rest of the conversation in view. Only messages without a translation are sent to the model, so a message that arrives after a teammate has opened the conversation used to be translated on its own. A short answer such as "Yes, the blue one" or "No, the other one" lost what it referred to. Each translation call now also gets the last few messages before it, in the original language, as context the model reads but does not translate.

- `GET /v1/conversations/:id/pending-translations` returns a `context` list: up to six public customer, agent and teammate messages from before the first pending one, about 3,000 characters at most. It is empty when nothing comes before the pending messages.
- `translateMessages` takes an optional `context`. When a long thread is split into several calls, each call also gets the end of the one before it, so a split no longer cuts a message off from what came before. Context messages are fenced as data without an id, so the model cannot return a translation for them.
- `PendingTranslations.context` is optional in `@getmunin/agent-runtime`, so a runtime pointed at an older backend keeps working without context.
