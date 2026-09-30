---
'@getmunin/backend-core': minor
'@getmunin/agent-runtime': minor
'@getmunin/agent-host': minor
'@getmunin/dashboard-pages': patch
'@getmunin/types': minor
---

Find out a conversation's language when the customer writes, not when a teammate first opens it. Before, a conversation's language stayed unknown until someone opened it in the inbox, so every first open ran a model call and showed "Translating…", even when the customer wrote the teammate's own language and nothing needed translating. The agent host now makes one short model call when a customer message arrives and the conversation's language is still unknown, and stores the result. The conversation is then usually ready by the time a teammate opens it: nothing to translate if the customer writes their language, the translation request right away if not.

- `GET /v1/conversations/:id/language-detection` returns up to three recent public customer messages while the conversation's language is unknown, and none once it is known. `POST /v1/conversations/:id/customer-language` records a detected language. It only sets a language that is still unknown and never overwrites one, and it emits the new `conversation.language_detected` event.
- `TranslationRestClient` gains `getLanguageDetectionSample` and `saveCustomerLanguage`. `TranslationHandler` gains `detect(conversationId)`, which uses the same generate gate as translation. `detectLanguage()` is exported for other runtimes.
- Detection skips auto-replies and suppressed conversations. It runs again on the next customer message if the model gives no usable language tag.
- The inbox says "Detecting language…" instead of "Translating…" while the language is still unknown, which is still the case for conversations from before this release until a new customer message arrives or someone opens them.
