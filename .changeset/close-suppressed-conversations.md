---
'@getmunin/backend-core': patch
'@getmunin/db': patch
---

Stop reading a Microsoft 365 out-of-office as a bounce, and close the conversations machine mail opens

`classifySender` took a `postmaster@` envelope sender as proof of a delivery failure. That
is the envelope sender Microsoft 365 puts on an out-of-office reply, and `suppressionReason`
reports `bounce` before `auto_reply`, so every M365 vacation reply was stored as
`suppressed: 'bounce'`. The ingest-time close only fired on `auto_reply`, so each one opened
a conversation of its own and sat in the operator's queue — 38 of them in one inbox.

A bounce-shaped envelope sender (`<>` per RFC 3834, or `postmaster@`) is now a bounce signal
only when nothing says auto-reply; a delivery-status report, `X-Failed-Recipients`, a
`mailer-daemon@` return path or a bounce mailbox in `From` still reports `bounce` over an
auto-reply subject. A brand-new conversation opened by any suppressed sender now closes at
ingest, bounces included — a delivery failure is no more answerable than a vacation reply.

Migration 0092 corrects the stale classification on out-of-office mail stamped as a bounce
and closes the conversations already sitting open, the state the corrected ingest path now
produces. Genuine bounces keep their label; the close treats both the same.
