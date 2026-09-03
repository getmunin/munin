---
'@getmunin/backend-core': patch
---

A widget session credential alone no longer mutates an identity-verified visitor's conversation.

Three widget endpoints gated their ownership check on the caller's own claim:

```ts
if (identity.mode === 'verified') {
  // …compare contact.metadata.externalId against identity.externalId
}
```

Present no identity headers and the branch never runs. On a channel where `requireVerifiedIdentity` is `false` — the default, and the only configuration where verified and anonymous sessions coexist — `verifyIdentity` returns `{ mode: 'anonymous' }` rather than throwing, so a caller holding nothing but a `sessionId` skipped the check entirely and was treated as the session's owner. `PATCH /v1/widget/visitor` would then rewrite the `conv_contacts` row of an identity-verified person, and `end_users.email` with it; the two voice paths would start a call and post call events on their conversation.

The session id is a bearer credential by design, but it is a weaker one than the identity HMAC, and it was buying identity-owner authority.

The check is now driven by the state of the row being written rather than by what the caller volunteered: a contact claimed by a real `externalId` (anything that is not an `anon:…` placeholder) requires a matching verified identity, and an unclaimed contact stays open to the anonymous session that owns it. `assertContactIdentityOwnership` is shared by all three sites so they cannot drift apart again. The verified-caller branch is unchanged — only the previously unguarded anonymous path is refused, with each endpoint keeping the error code it already returned (`session_not_owned`, `conversation_identity_mismatch`).

The bundled widget is unaffected: `setVisitorEmail` and `voiceStart` already attach `verifiedExternalId` + `userHash` from a live `getIdentity()` closure, which is populated both from the server-rendered embed attributes and after a runtime `window.mn.widget.identify()`. A custom server-to-server integration that patches a verified session without replaying the identity pair will now get a 403 and must send it.
