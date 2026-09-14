---
'@getmunin/backend-core': patch
---

Stop the inbound-email signature stripper from cutting the sender's identity claim.

`skill://conv/strip-email-signature` treated any trailing closing-plus-name block as
boilerplate. When a customer writes from someone else's mailbox — a spouse, a parent,
an assistant — and signs off with their own name, sometimes alongside a date of birth
or customer number, that block is the only record of who actually wrote and which
record the question is about. Cutting it left operators with nothing to search on, and
left the draft agent choosing between a sign-off it could no longer see and a contact
name derived from nothing more than the From header's display name.

The skill now separates boilerplate from content: a trailing block is a signature only
when it would arrive unchanged on every mail that person sends. A name paired with a
case identifier is kept, as is a bare closing-plus-name whose name doesn't match the
sending address. A full contact block stays strippable either way, so role and shared
mailboxes are unaffected.
