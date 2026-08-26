---
'@getmunin/backend-core': patch
---

Strip quoted history from inbound email replies that Gmail formats in a Nordic locale.

`stripQuotedReplyText` missed two things that combined to leave a full quoted thread in the
stored message body. First, the only Norwegian attribution pattern assumed a leading "den",
so Gmail's date-first form ("ons. 26. aug. 2026 kl. 14:05 skrev Support <s@x.example>:")
matched nothing — and Gmail hard-wraps that line at 76 columns, putting the address's closing
`>:` on its own line, which defeated the end-of-line anchor regardless. Second, the heuristic
fallback scans up from the end of the message over quoted lines, so it bailed immediately when
the sender's client placed their signature *below* the quote rather than above it.

Attribution lines are now matched with their quote markers removed (so a nested
`> On … wrote:` is recognised too), a wrapped address is rejoined before matching, date-first
Nordic attributions are recognised when the line also carries a time of day, and the trailing
scan retries above a signature block. A quote cut no longer swallows a signature that sat
below the quote — it is re-attached so the signature split still records it — and an
attribution on the very first line no longer reduces the whole message to `(no body)`.
