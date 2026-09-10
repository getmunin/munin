---
'@getmunin/db': patch
---

Repair mail that a forwarding hop got misclassified as an auto-reply.

Migration `0091_conv_repair_forwarded_auto_reply` undoes the damage from the
`classifySender` false positive: inbound mail that arrived through an auto-forwarding
mailbox (Microsoft 365 with SRS stamps `X-Auto-Response-Suppress` and, on some paths,
`Auto-Submitted: auto-forwarded` on the forwarded copy) classified as machine mail, and
once suppression started acting on that flag those messages lost their attention flag,
their agent draft, their Slack mirror and their place in the awaiting-reply sweep.

The migration drops the suppression from forwarded human mail, corrects the stale
classification on forwarded mail that predates suppression, and closes conversations
whose every public message is a genuine suppressed auto-reply — the state ingest-time
close would have produced. Genuine out-of-office mail stays suppressed: it is recognised
by an auto-reply subject (the prefixes `classify-sender.ts` matches, diacritics folded)
or an unmistakable out-of-office phrase in the body, and anything ambiguous is left
alone, because a wrongly suppressed message is recoverable and a robot answered as a
customer is not.

Repaired conversations whose newest public message is still the customer's are flagged
for attention again, so they surface in the operator queue rather than sitting open and
unmarked. The agent turn they lost is not replayed — drafting is driven by a
`conversation.draft_requested` event whose NOTIFY needs a live listener, which a
migration cannot rely on — but each repaired message carries
`metadata.autoReplyRepair = 'unsuppressed'`, so the affected threads stay findable.
