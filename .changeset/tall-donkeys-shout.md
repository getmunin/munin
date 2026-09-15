---
'@getmunin/backend-core': patch
'@getmunin/dashboard-pages': patch
---

Stop an email channel answering its own mail.

When the polled mailbox also receives the channel's own outbound — a `hello@` alias delivering into the `mailmaster@` mailbox it sends from — every agent reply was ingested as a fresh customer email and answered again, one round per 60s poll, each round opening a new conversation because a first reply carries no `In-Reply-To` to thread on.

Three changes close it:

- Agent-authored replies now carry RFC 3834 `Auto-Submitted: auto-replied`, which the inbound classifier already recognises, so a reply delivered back to us is suppressed as an auto-reply. The widget→email fallback digest is marked the same way. Operator-typed replies stay unmarked — they are not automatic responses.
- Inbound dedupe now also matches `conv_message_deliveries.message_id_header`, so a message we sent ourselves is dropped on `Message-ID` even when a middlebox strips the header. This is what covers the operator-typed case.
- `conv_send_email_channel_test` refuses a `to` equal to the channel's own address (`conv_test_self_addressed`) rather than seeding the loop with its own test message.
