---
'@getmunin/backend-core': minor
'@getmunin/core': minor
'@getmunin/chat-widget': minor
---

Let a signed-in widget user look up and manage their own orders and bookings by signing their
email into the widget identity hash.

The widget identity hash covered `externalId` only, so every email a widget session carried was
typed by the visitor or the page. The self-service commerce and bookings tools refuse a
self-reported email, so a signed-in widget user could neither look up an order nor book a table.
The hash can now also cover the email: send `verifiedEmail` (`data-verified-email` on the embed,
`window.mn.widget.identify(externalId, userHash, { email })`, the `x-munin-verified-email` header
on GETs, the `verifiedEmail` query param on the realtime socket) and sign the length-prefixed
payload `['mn.widget-identity.v1', externalId, email]` — `widgetIdentityHashPayload` in
`@getmunin/core`, mirroring the analytics tracker's `mn.identity.v1`. Without an email nothing
changes: the `externalId`-only hash keeps verifying. With one, only the email payload verifies,
so an email cannot be attached to an old hash, and an email without the pair is
`identity_partial`.

A verified email is bound to the signed-in user's end-user record, replacing one the visitor had
typed and marking it `emailSource: 'org-attested'`, so the self-service tools accept it. It is
left unbound when another end user already holds the address. Each widget message ingested under
a signed email is stamped the way a DMARC-passing inbound email is (`senderAuth: 'pass'`,
`provenEmail`).

A static widget hash never expires, so a leaked one lets its holder act as that user until the
secret is rotated — with a signed email, that includes reading their orders and changing their
bookings. `skill://conv/setup-chat-widget` covers the signing and the risk.
