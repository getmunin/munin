---
'@getmunin/backend-core': patch
'@getmunin/dashboard-pages': patch
'@getmunin/agent-runtime': patch
'@getmunin/agent-host': patch
---

Keep inbound auto-replies and bounces out of the operator queue

`classifySender` has always detected machine-generated inbound mail (RFC 3834 `Auto-Submitted`,
`X-Autoreply`, `X-Autorespond`, `Precedence: junk`, `X-Auto-Response-Suppress`, an empty or
`mailer-daemon` `Return-Path`), but nothing read the verdict. An out-of-office notice therefore ran
the whole chain: attention flag, an LLM turn, a parked draft, and a `requestHandover` that put the
thread in front of a human. A campaign to a few hundred prospects filled the console with holiday
notices.

Ingest now stamps such a message `metadata.suppressed` (`auto_reply` or `bounce`) and stops there:
no attention flag, no reopen of a closed thread, no topic or signature pass, and
`conversation.message.received` carries `autoReply: true` so the runner skips its turn and the
outreach outcome extractor skips the thread. The message is still stored, still in the thread, still
readable by agents and by the operator, now marked in the console. Suppression is per message —
the next real reply from the same sender is handled normally.

Two follow-on fixes fall out of the same stamp: the awaiting-reply sweep looks at the newest
*non-suppressed* public message, so a conversation is no longer resurrected by an auto-reply and a
genuine message that arrived before one still gets answered; and `listDueFollowups` no longer treats
an out-of-office as "the prospect replied", which silently ended the follow-up sequence for exactly
the contacts who were merely away.
