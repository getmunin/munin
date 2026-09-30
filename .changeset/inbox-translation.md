---
'@getmunin/db': minor
'@getmunin/types': minor
'@getmunin/backend-core': minor
'@getmunin/agent-runtime': minor
'@getmunin/agent-host': minor
'@getmunin/dashboard-pages': minor
---

Read a conversation in your own language. When a teammate opens a conversation, the inbox asks the agent to translate it into the dashboard's language. The thread then shows the translation, and a "Show original" toggle in the header switches back to the customer's own words.

- Conversations carry `customerLanguage`: the language the customer writes in, as a short BCP 47 tag. The agent detects it the first time a teammate opens the conversation. Once it matches the dashboard language, no more translation is asked for.
- New table `conv_message_translations`: one row per message and target language, staff-only under RLS (end-user audiences never see a row). A row is deleted with its message and whenever the message body is rewritten, so a redacted or signature-stripped body never keeps a stale translation.
- `POST /v1/conversations/:id/request-translation` takes `targetLanguage`. It emits `conversation.translation_requested` only when public messages are missing a translation. `GET /v1/conversations/:id?translateTo=<tag>` adds a `translations` block to the detail.
- For agent runtimes: `GET /v1/conversations/:id/pending-translations?targetLanguage=<tag>` lists what still needs translating. `POST /v1/conversations/:id/translations` saves the results and emits `conversation.translated`. The realtime client gains `onTranslationRequested`.
- The in-process agent host translates with the fast model in one call per batch. Customer text is fenced as data. The call counts against the same token metering and generate gate as chat replies.
- Only public messages from the customer, the agent and teammates are translated. Internal notes, drafts and system lines stay as written.
