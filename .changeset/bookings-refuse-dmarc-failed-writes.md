---
'@getmunin/backend-core': minor
'@getmunin/core': minor
'@getmunin/agent-runtime': minor
'@getmunin/agent-host': minor
'@getmunin/sdk': minor
---

Refuse a self-service booking write when the message asking for it explicitly failed DMARC, and
start reading the DMARC verdict that inbound mail was already carrying.

A self-service booking write trusted whatever identity the channel asserted. `From:` is a
header anyone can set, so a forged inbound email bound the conversation to the victim's
`end_users` row — `findOrCreateEndUserByEmail` matches on the address — and
`bookings_cancel_my_booking` then cancelled their table. `assertOwned` did not stop it: it
checks that the booking belongs to the email, which is the very thing the spoof supplied.

**The rule is "refuse on evidence of forgery", not "require proof of ownership".** Tables and
appointments are low-harm, and a guest cancelling or moving one over email or the phone is the
convenience the product exists for, so `bookings_create_my_booking`,
`bookings_update_my_booking` and `bookings_cancel_my_booking` keep working on every session that
can read — voice included, where caller id offers nothing to check. They refuse with
`connectors_sender_auth_failed`, before any vendor call, only when the caller is answering an
email and a message in the latest customer turn failed DMARC for the address it claims. That
costs a genuine guest nothing — mail from their own mailbox passes — and it stops the cheapest
spoof: Gmail, Outlook, iCloud and most company domains publish DMARC, so a `From:` forged from
anyone else's server is recorded as `dmarc=fail` even under a lenient `p=none`. Forwarded mail is
recorded as `unknown`, not `fail`, so forwarding does not trip it. The check reads the latest
turn only, so a failure the agent already answered does not block a later genuine message.

**The verdict.** `Authentication-Results` was parsed at ingest and written into message metadata,
and nothing ever read it. `evaluateInboundEmailAuth` reads the topmost header — each hop prepends
its own, so the first is the receiving MTA's — and returns `pass` only for a single `dmarc=pass`
result whose own `header.from` aligns with the `From:` domain, `fail` for a DMARC failure, and
`unknown` when there is no DMARC result. The header is parsed by its RFC 8601 structure (results
split on `;` outside quoted strings and comments, method and result read only from the head of
each result), not by searching for `dmarc=` anywhere in it: the receiving MTA copies
attacker-chosen values into the same header, and `dmarc=pass@attacker.test` is a legal envelope
sender. A header carrying two `dmarc` results is `fail`, since one of them was injected.

**Where it lives.** The verdict is recorded on each inbound message
(`conv_messages.metadata.senderAuth`, with the authenticated address in `provenEmail` on a pass),
not on the `end_users` row. A per-person stamp is the wrong unit: it reflects whatever the most
recent message from that address said, not the message the agent is answering, and a jsonb merge
onto the row overwrote a widget visitor's `emailSource: 'visitor'` marker — which turned a
typed-in address into a readable one the moment mail arrived for it.

To know which conversation it is answering, the end-user agent's actor now carries it:
`ActorIdentity` gains an optional trailing `conversationId`, `buildEndUserAgentActor` and
`openEndUserAgentMcpClient` accept one, and the conversation handler passes it to `openMcp`
alongside `endUserId` and `channelType`. A caller outside a conversation, such as a delegated
token, is not checked.

**Delegated tokens.** `POST /v1/tokens/delegated` now binds the request's `email` to the end user
and records it on the token as `metadata.attestedEmail` (returned as `attestedEmail`), so the
address on file is the one the minting backend's login checked. The attestation has to agree with
the record: a different email already on the end user is `delegated_email_mismatch` (400), and an
email held by another end user is `delegated_email_conflict` (409) instead of the unique-index 500
it used to be. A mint naming only `email` now reuses the end user holding that address.

**Limits.** A `From:` domain that publishes no DMARC record can still be forged; so can a caller
id. The topmost header is trusted without checking its authserv-id, so a mail path whose receiving
server adds no `Authentication-Results` of its own leaves a sender-written one on top. A spoofed
`From:` still reads order and booking history, held in check by reply addressing alone.
