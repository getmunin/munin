---
'@getmunin/backend-core': patch
---

File away inbound mail whose subject *and* body both carry nothing, before any model runs.

The header classifier already settles bounces, out-of-office replies and `no-reply@` senders at ingest, for zero tokens. It had nothing to say about mail from an ordinary human mailbox that simply contains no question — an empty body under an auto-generated subject, or a bare link under a date. Each of those opened a conversation, drew a knowledge-base search and a drafted reply, and landed in the review queue. The expensive case was the one that looked cheapest: `(no body)` plus screenshot attachments feeds the images through vision.

`hasNoAnswerableContent` adds a `no_content` suppression reason, and it is deliberately narrow — it fires only when **neither** half says anything. The body must be empty or nothing but URLs, *and* the subject must be empty or machine-written (a bare date, `Screenshot …`, `IMG_20260911`, a lone `Fwd:`, a URL). Any real word in the subject and the message goes through: "Callback request" with an empty body is a normal shape for a genuine terse enquiry, and guessing otherwise would drop real mail. Senders who do this repeatedly are caught by the sender-level spam flag instead, which reads a pattern no single message shows.

Attachments do not rescue a message here, which is the one accepted risk: an empty body under a machine subject is filed away even with images attached. The conversation is closed rather than deleted, carries `suppressed_reason: 'no_content'` for the inbox filter, and reopens on the sender's next real message.
