---
'@getmunin/backend-core': minor
---

Require a proven email address before a self-service booking write, and start reading the
DMARC verdict that inbound mail was already carrying.

A self-service booking write trusted whatever identity the channel asserted. `From:` is a
header anyone can set and caller id is trivially spoofed, so a forged inbound email bound
the conversation to the victim's `end_users` row — `findOrCreateEndUserByEmail` matches on
the address — and `bookings_cancel_my_booking` then cancelled their table. `assertOwned`
did not stop it: it checks that the booking belongs to the email, which is the very thing
the spoof supplied.

Reads had an accidental defence that writes do not share. The agent's reply is addressed to
the claimed address, so a spoofed *read* leaks to the real owner's mailbox and not to the
attacker. A write needs no reply — the damage is already at the vendor — which is why the
gate lands on `bookings_create_my_booking`, `bookings_update_my_booking` and
`bookings_cancel_my_booking`, and why the read tools are deliberately unchanged.

`ConnectorsService.requireProvenEndUserEmail()` backs the three write paths and refuses with
`connectors_unproven` unless the record carries proof of ownership. `requireEndUserEmail()`
is untouched, so every read behaves exactly as before.

Proof now has a source. `Authentication-Results` and `ARC-Authentication-Results` were
parsed at ingest and written into message metadata, and nothing ever read them.
`evaluateInboundEmailAuth` reads the **topmost** header only — each hop prepends its own, so
the first one is the receiving MTA's and a sender-forged copy sits below it — and returns
`pass` only for `dmarc=pass` whose `header.from` aligns with the `From:` domain. Anything
else is `fail` or `unknown`, and only `pass` stamps `emailSource: 'smtp-verified'`. The
stamp is rewritten on every inbound message rather than only at creation, so a later spoof
cannot ride on an earlier genuine message's proof.

Three things deliberately do not count as proof. A forwarded sender never inherits the
verdict, because DMARC authenticated the forwarder and not the address recovered from the
body. A caller-id identity is stamped `identitySource: 'caller-id'` so that attaching an
email to a phone record later cannot silently grant booking writes. And a record written
before this change carries no stamp and is treated as unproven rather than grandfathered in.

Operators on a mail path that strips or never adds `Authentication-Results` will find
self-service booking writes refused; the fix is to keep the receiving MTA's header, not to
widen the gate. `skill://bookings/manage-bookings` tells the agent to offer a human handover
on `connectors_unproven` instead of retrying or reaching for an admin tool.

This closes the write half only. A spoofed `From:` still reads order and booking history,
held in check by reply addressing alone, and widening cross-channel context would widen that
exposure — so identity confidence and a disclosure gate remain to be designed.
