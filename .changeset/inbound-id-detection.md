---
'@getmunin/backend-core': minor
'@getmunin/db': minor
---

Detect national identity numbers on every inbound conversation message.

All three ingest paths — email, the generic channel webhook, and the widget — now run inbound text through the detectors before the first write. Detection is unconditional; redaction is not. Until an org configures a policy nothing is rewritten, and the only visible effect is a `detectedNationalIds` summary on the message (kinds and counts, never values) plus a `data_protection` alert pointing at the setting.

That ordering is deliberate. A destructive default that silently rewrites customer data on upgrade is not shippable, and a setting nobody finds helps nobody — so an org that receives these numbers is told so, and opts in on purpose.

Detection also runs for detectors an org has *not* enabled, which is how a Norwegian tenant discovers it is receiving Danish CPR numbers too.

The redaction pass covers every persisted copy, not just the body: `bodyHtml`, the conversation subject, and the `preStripBody`, `signatureText`, `raw` and `quotedThread` entries in message metadata. Adds a `data_protection` alert source, which needs a check-constraint migration.
