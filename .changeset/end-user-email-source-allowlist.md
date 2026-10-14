---
"@getmunin/backend-core": patch
"@getmunin/db": patch
---

Trust an end user's email for personal lookups only when its source is known.

Self-service store-order, booking and own-contact lookups used to refuse an email only when it was marked as typed by a visitor (or the session was anonymous). Any email written by a path that forgot to mark itself was trusted by default. The check is now an allow-list on `end_users.metadata.emailSource`:

- `org-attested`: a delegated-token mint with `email`, a signed widget email, a signed analytics `identify` email, or `/v1/end-users`.
- `channel`: the sender of an inbound email or channel webhook.
- `legacy`: an email that predates this change. Migration `0114_end_user_email_source_backfill` stamps it, so no existing lookup changes outcome.

Anything else, including no source at all, is treated as self-reported. Every path that writes an email now stamps its source. The three org-attested paths share one rule for a conflict: an email held only by a self-reported end user is taken back from it rather than blocking the owner.

Signed analytics `identify` no longer adopts an anonymous widget identity just because the visitor typed the same address. It takes the address back and keeps the customer's identity separate. External MCP identity assertions report an email from an unknown source as `self_reported`.
