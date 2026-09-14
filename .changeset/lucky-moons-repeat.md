---
'@getmunin/backend-core': patch
---

Reconstruct the quoted history of an Outlook reply instead of mistaking it for a forward.

`isForwardIntroduced` asked a purely syntactic question — does a forward marker sit above this header block? — and `FORWARD_MARKERS` counts a rule of ten or more underscores, which Outlook prints above every block it quotes, on replies as much as on forwards. So an Outlook reply's quoted block was read as the header of a forwarded message, `findQuotedHistoryStart` skipped it, and `metadata.quotedThread` stayed empty. The disclosure the dashboard renders under a message never appeared for the single most common mail client in the customer base.

That protection is real and stays: in a genuinely forwarded mail the text below the block *is* the message, so cutting or reconstructing there would store the forwarder's cover note as the customer's words. What was wrong is the question. Whether a block introduces a forwarded message is not something the surrounding lines can answer on their own — it is what `resolveForwardOrigin` already decided for the message as a whole. The two now agree: a block is the forward's own header only when a marker introduces it **and** its `From:` names the address the origin resolved to.

`parseQuotedThread`, `findHeaderBlockQuoteCut` and `stripQuotedReplyText` take that address as an optional argument, and the email adapter passes it from the origin it has already resolved. The three states are distinct on purpose: an address means the message is a forward from that sender, `null` means it is not a forward at all so no block is a forward header, and omitting it keeps the old marker-only rule for callers that cannot know — the conservative reading, since a bad cut costs the customer's words while a missed reconstruction costs only a convenience.

Where an organisation answers a shared mailbox elsewhere and the quoted block is the only record Munin will ever hold of the other half of an exchange, that record now survives the reply arriving from Outlook. A quoted turn the conversation already holds is still dropped, so a customer replying to a mail Munin sent does not see our own answer repeated under a "not delivered through Munin" caption.
