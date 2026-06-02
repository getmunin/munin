---
'@getmunin/backend-core': patch
---

`POST /v1/conversations/channels/email` now returns a `400` with the underlying reason when an SMTP or IMAP host fails the SSRF guard, instead of an opaque `500`. The dashboard's generic error renderer surfaces the message verbatim, so a typo like `imag.gmail.com` now reads as `SMTP: dns lookup failed for imag.gmail.com: getaddrinfo ENOTFOUND imag.gmail.com` rather than "Munin couldn't reach the server".

Only `SsrfBlockedError`s thrown during the inbound/outbound host validation are remapped; all other failures stay as-is.
