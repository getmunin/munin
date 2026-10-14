---
'@getmunin/db': minor
'@getmunin/backend-core': minor
'@getmunin/agent-runtime': minor
'@getmunin/dashboard-pages': minor
---

The inbox now translates a conversation's subject along with its messages.

A teammate whose dashboard language differs from the customer's already got the messages translated, but the title above them stayed in the customer's language — in the conversation header and in every inbox row. The subject now rides along in the same translation pass: `pendingTranslations` returns it next to the pending messages, the translator returns it under its own id in the same model call, and `saveTranslations` accepts `subject: { source, body }`. The header shows the translation (the existing "show original" toggle switches it back), and `GET /v1/conversations/queue?translateTo=<locale>` adds a `translatedSubject` to each row that has one, so the list reads in the viewer's language too once a conversation has been opened in it.

Translations live in a new staff-only `conv_subject_translations` table (migration `0116`), one row per conversation and target language. Each row records the subject it was made from and only applies while the conversation still carries that subject, so a retitled conversation is translated afresh instead of showing a translation of its old title. Rewriting a subject during a redaction backfill deletes its translations, as rewriting a message body already did.

A subject-only translation pass never sets the customer's language from the title alone; that still comes from their messages.
