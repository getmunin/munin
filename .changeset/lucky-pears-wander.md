---
'@getmunin/backend-core': patch
---

Read an inbound email's HTML as lines of text, not as one flattened line.

When a message carries no usable `text/plain` part — an empty one counts, and marketing mail forwarded from a phone often ships exactly that — the adapter falls back to converting the HTML itself. That fallback was `html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()`: every newline became a space, `<style>` and mso-conditional content stayed in as text, and entities were never decoded. The stored body therefore began life as a single line reading `Sendt fra min iPad 10. juli 2026 kl.&nbsp;00:04 skrev Nyhetsbrev &lt;nyheter@example.test&gt;: … 96 * { box-sizing: border-box; } …`.

Every quote mechanism downstream is line-based: `parseQuotedThread` scans lines for an attribution line or a `From:` header block, `stripQuotedReplyText` cuts at a line, and signature detection walks blank-line-delimited blocks. With one line to scan they all found nothing, so a forwarded newsletter kept its entire quoted chain in the message body, "Earlier in this thread" never appeared, and the CSS from the sender's `<style>` block was stored as if the customer had written it.

`email/html-text.ts` now does the conversion: it drops `<script>`, `<style>`, `<head>`, `<title>`, `<noscript>`, `<template>` and comment content (which is where mso conditionals live), maps each block boundary and `<br>` to a line break, decodes named, decimal and hexadecimal character references, and removes the invisible characters newsletters use for preheader spacing. A run of adjacent block tags yields one break, and each `<br>` inside a run adds one more, capped at a single blank line — so an Apple Mail `<div><br></div>` reads as the blank line the sender meant, while `</div><div>` does not double-space every paragraph. Table cells break per `<td>`, not per row, so a marketing layout does not gain a blank line between every cell. Tag stripping now requires a letter after the `<`, which leaves a bare `5 < 7` in prose alone.

Line breaks are carried through the conversion as two private-use sentinels, so a character reference for either of those two code points is deliberately left undecoded — otherwise sender-controlled text could forge a line break and, with it, a quote boundary.

Messages that do carry a `text/plain` part are untouched, and so are pure HTML-only messages, where mailparser already synthesizes the text part.
