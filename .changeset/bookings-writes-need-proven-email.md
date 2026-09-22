---
'@getmunin/backend-core': minor
'@getmunin/core': minor
'@getmunin/agent-runtime': minor
'@getmunin/agent-host': minor
'@getmunin/sdk': minor
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

**The verdict.** `Authentication-Results` was parsed at ingest and written into message
metadata, and nothing ever read it. `evaluateInboundEmailAuth` now reads the topmost header —
each hop prepends its own, so the first is the receiving MTA's — and returns `pass` only for a
single `dmarc=pass` result whose own `header.from` aligns with the `From:` domain. The header is
parsed by its RFC 8601 structure (results split on `;` outside quoted strings and comments,
method and result read only from the head of each result), not by searching for `dmarc=`
anywhere in it: the receiving MTA copies attacker-chosen values into the same header, and
`dmarc=pass@attacker.test` is a legal envelope sender. A header carrying two `dmarc` results is
`fail`, since one of them was injected. A forwarded sender never inherits the verdict, because
DMARC authenticated the forwarder and not the address recovered from the body.

**Where the proof lives.** The verdict is recorded on the inbound message
(`conv_messages.metadata.senderAuth`, with the proven address in `provenEmail` on a pass), not
on the `end_users` row. A per-person stamp was the
wrong unit: the gate would read whatever the most recent message from that address had said,
so a genuine message landing between a forgery and the agent's tool call lent its proof to the
forger's conversation, and every other channel bound to the same row — a caller whose number
matches the contact, for one — borrowed it too. It also overwrote a widget visitor's
`emailSource: 'visitor'` marker, which turned a typed-in address into a readable one the moment
mail arrived for it.

`ConnectorsService.requireProvenEndUserEmail()` backs the three write paths and accepts two
kinds of proof, both bound to the session making the request rather than to the person:

- **An email conversation.** The caller acts inside a specific conversation that belongs to it
  and arrived on the email channel, and every message in that conversation's latest customer
  turn passed DMARC with a `provenEmail` equal to the address the booking is filed under.
- **A delegated token the organization attested.** `POST /v1/tokens/delegated` now records the
  request's `email` on the token as `metadata.attestedEmail` and returns it as `attestedEmail`.
  The minting backend already holds an admin key — which can cancel any booking through the
  admin tools — so trusting the address it vouches for adds no capability. The attestation has
  to agree with the record: a different email already on the end user is `delegated_email_mismatch`
  (400), and an email held by another end user is `delegated_email_conflict` (409) instead of the
  unique-index 500 it used to be. A mint naming only `email` now reuses the end user holding that
  address. A token minted without `email` can still read but not write, because the row's email
  may have come from somewhere the backend never checked.

Anything else refuses with `connectors_unproven` before any vendor call: another conversation's
proof, one unverified message in the current turn, SMS, voice, and the chat widget (identity
verification signs the user's id, not the email they typed). `requireEndUserEmail()` is
untouched, so every read behaves exactly as before.

To know which conversation it is acting in, the end-user agent's actor now carries it:
`ActorIdentity` gains an optional trailing `conversationId`, `buildEndUserAgentActor` and
`openEndUserAgentMcpClient` accept one, and the conversation handler passes it to `openMcp`
alongside `endUserId` and `channelType`.

Messages ingested before this change carry no verdict and are unproven rather than grandfathered
in. Operators on a mail path that strips `Authentication-Results` will find self-service booking
writes refused; the fix is to keep the receiving MTA's header, not to widen the gate.
`skill://bookings/manage-bookings` tells the agent to offer a human handover on
`connectors_unproven` instead of retrying or reaching for an admin tool.

Two limits remain. The topmost header is trusted without checking its authserv-id, so a mail
path whose receiving server adds no `Authentication-Results` of its own leaves a sender-written
one on top. And DMARC proves the sending domain, not the mailbox: anyone who can legitimately
send from the same domain passes. A spoofed `From:` also still reads order and booking history,
held in check by reply addressing alone.
