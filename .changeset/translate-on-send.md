---
'@getmunin/backend-core': minor
'@getmunin/agent-runtime': minor
'@getmunin/agent-host': minor
'@getmunin/dashboard-pages': minor
---

Reply in your own language, and the customer gets it in theirs. In a conversation whose customer writes another language, the composer shows a "Translate to <language>" checkbox, on by default. You write and edit in your own language. On send, the reply is translated and the translation goes out, while what you wrote is kept as that message's translation, so the thread shows your own words and "Show original" shows what the customer received. Untick the box to send as typed; the button then says "Send in <your language>".

- `POST /v1/conversations/:id/messages` takes `translateFrom`, the language the teammate wrote in. The reply is translated into the conversation's `customerLanguage` before it is stored and delivered. If translation fails, nothing is sent (`conv_translation_failed`). If the customer's language is not known yet, the reply is refused (`conv_translation_unavailable`). Draft slots and the edited-draft stamp are checked against what the teammate wrote, not the translation. Only teammates can use it: an agent writes the customer's language itself.
- backend-core gains `MessageTranslatorRegistry`, a hook the in-process agent host fills in. It translates on the fast model, under the same metering and generate gate as chat replies.
- `POST /v1/conversations/:id/request-draft` takes `language`, which rides on `conversation.draft_requested`. The agent then drafts in that language instead of the customer's, so a draft asked for with translation on arrives in the teammate's language, ready to edit.
