---
'@getmunin/backend-core': patch
'@getmunin/dashboard-pages': patch
---

File away mail from an address that takes no replies

A mailbox deleted at the far end answers with an ordinary email, not a bounce: `noreply.autoresponder.no@kaefer.no` writing "the email address you have tried to reach does not exist within our company anymore". It carries no `Auto-Submitted`, no auto-reply subject and no delivery-status report, so nothing suppressed it — it opened a conversation, raised the attention flag, and the agent drafted a courteous reply to an address that by construction discards it.

`classifySender` already saw this: `isRoleAccount` was true. But role accounts are deliberately answerable, because a human reads `support@` and `sales@`. A `noreply@` / `do-not-reply@` address is the narrower case where a reply is guaranteed to go nowhere, so it is now its own classification, `isNoReplyAddress`, and its own suppression reason, `no_reply_address` — filed away closed at ingest with no draft and no attention, exactly like an out-of-office.

A bounce or an auto-reply still reports its own reason over this one, which says least about the mail. A mailing-list post from a no-reply address stays answerable, the same carve-out `Precedence: bulk` already has.

Detection is on the address alone. Body phrases like "no longer available" are multilingual and a quoted original can carry them, so the "mailbox does not exist" wording is not matched — a no-reply sender that no human reads is a fact about the header.
