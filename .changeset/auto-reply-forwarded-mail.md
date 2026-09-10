---
'@getmunin/backend-core': patch
---

Stop reading an Exchange forwarding hop as an auto-reply.

A mailbox that auto-forwards into Munin — Microsoft 365 with SRS, in the case that
surfaced this — stamps the forwarded copy with `X-Auto-Response-Suppress` and, on some
paths, `Auto-Submitted: auto-forwarded`. `classifySender` read the bare presence of
`X-Auto-Response-Suppress` as proof the message was machine-generated, and treated any
`Auto-Submitted` value other than `no` the same way. Both are wrong:
`X-Auto-Response-Suppress` is an instruction to the *recipient* not to send OOF or DSNs
back, and `auto-forwarded` describes the hop, not the message.

The result was that every human email arriving through such a forward classified as an
auto-reply. That was inert until suppression started acting on the flag, at which point
a whole support inbox went quiet: no agent draft, no operator attention, no Slack
mirror, dropped from the awaiting-reply set.

`X-Auto-Response-Suppress` is no longer a signal on its own, and `Auto-Submitted` now
only counts when it says `auto-replied`, `auto-generated` or `auto-notified` (parameters
after the token are ignored). Genuine out-of-office replies still suppress — they carry
`Auto-Submitted: auto-replied` or an "Automatic reply:"-style subject. The classification
now also records `autoReplySignal`, the rule that fired, so the next false positive is a
lookup rather than an investigation.
