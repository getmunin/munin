---
'@getmunin/backend-core': patch
---

A widget visitor's name and email now reach the identity and contact rows instead of being dropped.

On a verified widget session, `ingest` and `startConversation` both call `claimAnonymousIdentityInTx` *before* `findOrCreateEndUser`. The claim mints the end-user row through `findOrCreateVerifiedEndUser`, which stores an `externalId` and nothing else — so the `findOrCreateEndUser` call that follows always took its "existing row" branch, which only ever refreshed `metadata.locale`. The result: for an identity-verified visitor, `visitor.name` and `visitor.email` were silently discarded on every ingest, and `end_users.name` stayed null for the life of the identity. Only `PATCH /v1/widget/visitor` ever wrote them, which is why a live identity could carry an email (the visitor typed it into the email-capture card) but never a name.

Three write paths now fill a blank field instead of ignoring it:

- `findOrCreateEndUser` backfills `name` and `email` onto an existing identity from `input.visitor`, tagging `metadata.emailSource: 'visitor'` alongside the email the same way the insert path does.
- `claimAnonymousIdentityInTx` copies `name` and `email` from the verified identity onto the contact row it claims, so a session that started anonymous stops being nameless the moment it is claimed.
- The anonymous session-matched branch of `findOrCreateContact` accepts a name or email that arrives mid-session, which previously only updated `endUserId`.

Every one of these fills nulls only — a value already on the row always wins, so nothing a human typed gets overwritten by a page-supplied claim.

`end_users_org_email_uq` is unique on `(org_id, lower(email))`, so every path that writes an identity email now checks for another identity holding that address first and skips rather than throwing: two people sharing an inbox must not fail an ingest.

That check also fixes a live crash in `setVisitor`. The widget's email-capture card posts `PATCH /v1/widget/visitor`, which wrote `end_users.email` unguarded — so a visitor typing an address another identity already held hit the unique index, poisoned the request transaction, and got a bare `500` at commit, past any in-handler catch. The contact row still takes the address either way (`conv_contacts.email` has no unique constraint), so the operator can always reply; only the identity write is skipped. Silently, and deliberately: letting an anonymous visitor's self-reported address overwrite a verified identity's would be an identity-takeover primitive, and failing the call would break the legitimate shared-inbox case.
