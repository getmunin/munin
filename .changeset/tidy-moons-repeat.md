---
'@getmunin/backend-core': minor
'@getmunin/dashboard-pages': minor
---

Recognise header-block quoting on inbound email, and show the quoted thread as reconstructed history.

Many mail clients and ticketing systems quote a reply by printing a `From: / Date: / Subject: / To:` header block rather than `>` markers or an `On … wrote:` attribution. `stripQuotedReplyText` matched neither, so the whole thread was stored as one message body: the dashboard showed a wall of text, and the agent runtime read every earlier turn — including the organisation's own replies — as a single end-user utterance.

Inbound bodies are now cut at the first header block, with the labels localised across the same languages the existing attribution patterns cover. Detection requires a `From:` line followed by at least two companion header lines, so prose that happens to begin with `From:` is left alone, and a body that *opens* with a header block (a bare forward) keeps its text.

The quoted chain is no longer merely discarded. It is parsed into turns and kept on the message's `metadata.quotedThread`, and the conversation view renders them under a collapsed "Earlier in this thread" disclosure. This matters most where an organisation auto-forwards a shared mailbox into Munin and answers elsewhere: the quoted block is then the only record Munin will ever hold of the other half of the exchange.

Reconstructed turns are deliberately not written as `conv_messages` rows. They carry no Message-ID, no delivery state and no author, and the quoted text is composed by the sender rather than observed by us — so they stay labelled, read-only, and outside the conversation record that curation, export, analytics and webhooks draw on. Sender-formatted dates are kept verbatim instead of being parsed into timestamps, turn count and per-turn length are capped, and where a system prints a reply above its first header block that reply still stays with the visible message.

Inbound bodies are also normalised for the whitespace that HTML-to-text flattening leaves behind: trailing whitespace goes, runs of blank lines collapse to one, and the indentation shared by every line is removed. That last part matters because the conversation view renders the body as Markdown, where four leading spaces mean a code block — a flattened message could render as grey monospace. Only the *common* indentation is stripped, so a pasted stack trace or snippet keeps its relative shape.
