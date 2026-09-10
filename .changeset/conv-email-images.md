---
'@getmunin/backend-core': minor
'@getmunin/core': minor
---

Images in and out over the email channel.

Inbound: `parseMessage()` now carries `parsed.attachments` (content, contentType,
filename, cid, contentDisposition, related) instead of discarding them, and
`EmailAdapter.ingest()` persists the survivors through
`ConvAttachmentsService.persistBytes()` inside the existing ingest transaction,
writing `projectForMessage()` output into `conv_messages.attachments`. Both inbound
entry points share the change — the IMAP poll path and the relay path go through the
same `parseMessage` + `adapter.ingest` pair.

The noise filter is the substance and lives on its own in `email/inbound-attachments.ts`
so it can be unit-tested without a database. Business mail carries a tracking pixel and
a signature logo on nearly every message, so a part is dropped when its mime is outside
`CONV_ATTACHMENT_MIME_ALLOWLIST`, when it is under `CONV_ATTACHMENT_INBOUND_BYTES_MIN`
or has an edge under `CONV_ATTACHMENT_INBOUND_EDGE_MIN_PX`, when sharp cannot decode it,
when it is an `inline` part whose Content-ID no longer appears in the HTML body, or once
`CONV_ATTACHMENT_PER_MESSAGE_MAX` parts have been kept. The cid-reference test runs
against the *stripped* HTML — after `stripQuotedReplyHtml` and `stripSignatureHtml` —
which is what actually keeps signature logos out; a filter placed before stripping would
keep every one of them. Filenames take their extension from the part's mime, so a
PNG-mimed part named `payload.svg` cannot reach the store's SVG rejection by extension.

`simpleParser` is now called with `keepCidLinks: true`. By default mailparser rewrites
every `cid:` reference in `parsed.html` into a base64 `data:` URI, which meant inbound
inline images were being inlined whole into `conv_messages.body_html` — a multi-hundred-
kilobyte text column per message and no attachment row to show for it. The stored HTML
keeps its `cid:` references, normalized (unbracketed, lowercased) to match the
`content_id` column exactly so read-time hydration can mint a fresh URL per request;
nothing time-limited is written to the database. An `<img>` whose part the filter dropped
is removed rather than left pointing at a cid that will never resolve.

Outbound: `buildOutbound()` takes an `attachments` input and nests the message properly —
`multipart/related; type="text/html"` around the alternative when a part is inline and
its cid is actually referenced, `multipart/mixed` for files, both nested when a message
carries each. Parts are base64-encoded at 76 columns with `Content-Disposition` and, for
inline parts, `Content-ID`; a non-ASCII filename goes out RFC 2231-encoded. `EmailAdapter.send()`
loads the bytes with `storage.readBytes()` and embeds real MIME parts — a signed
attachment URL would outlive its TTL in the recipient's mailbox and leak on forward — and
an attachment whose object has gone (a tombstoned row) is left out rather than failing
the send.

`MailMessage` gains `attachments` and `ResendMailer` maps it onto the Resend API's
attachment array (`SmtpMailer` maps it onto nodemailer's, which would otherwise have
dropped it silently). The transactional `mailer` path hands its attachments to the mailer
rather than through `built.raw`, deliberately: that path already loses HTML through
`extractTextBody`, and feeding it a MIME body full of base64 would have put the encoded
image into the message text.

`widget-email-fallback.worker.ts` deliberately sends no attachments. It composes a
"you have unread messages" digest that points the recipient back at the widget rather
than reproducing the thread, so shipping the images a second time by mail is duplication,
not delivery.
