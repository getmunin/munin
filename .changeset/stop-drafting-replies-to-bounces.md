---
'@getmunin/backend-core': minor
'@getmunin/agent-runtime': minor
---

Stop spending agent tokens on bounces and auto-replies.

Inbound bounce and auto-reply detection already existed: `classifySender` stamps
`metadata.suppressed`, the ingest path skips curator work, the realtime trigger drops
events flagged `autoReply`, and `listConversationsAwaitingAgentReply` ignores conversations
whose latest non-suppressed message isn't from the customer. Three holes let mail through
anyway, and a DSN that gets through is expensive — the ones in the wild echo back forty
lines of base64 `X-HE-Meta` before the model has read a word of anything useful.

- **ESP bounce mailboxes were not detected.** `isBounce` matched only `mailer-daemon@` and
  `postmaster@`, so `bounces@amazonses.com`, `bounce@sendgrid.net` and Mailgun's
  `bounce+tag@` VERP addresses sailed past every gate and the agent drafted a
  customer-facing reply to a robot. The classifier already listed `bounce`/`bounces` in
  `ROLE_LOCAL_PARTS`, but `suppressionReason` reads only `isBounce` and `isAutoReply`, so
  recognizing them as role accounts changed nothing. There is now a `BOUNCE_LOCAL_PARTS`
  set folded into `isBounce`.
- **The two standard machine markers were not checked at all**: RFC 3464's
  `Content-Type: multipart/report; report-type=delivery-status` (quoted or bare) and
  Gmail's `X-Failed-Recipients`. Either one now marks a bounce whatever address it arrives
  from, which is what catches relays that sign DSNs as `noreply@`.
- **Suppression gated the trigger but never the context.** A bounce landing on a thread
  where the customer is still owed an answer left the conversation eligible — correctly,
  the customer's question still needs replying to — but the DSN went into the prompt along
  with it. `toRuntimeHistory` now drops suppressed messages, falling back to the unfiltered
  set rather than handing the model an empty history when a human explicitly requests a
  draft on a bounce-only thread.

Two things surfaced while fixing those. Inbound bodies were stored whole, so the base64
block was paid for by every downstream reader and stored twice — once as the body and
again as `metadata.preStripBody`. `clampInboundBody` collapses wrapped encoded blocks and
caps the body at 24k characters, applied once to `quoteStrippedText` so every derived copy
inherits it. And `in-process-rest-client.ts` had its own `toRuntimeHistory` that filtered
nothing — not internal notes, not empty voice turns, not suppressed mail — and did not
remap `user` to `staff`, so the in-process runner that `apps/backend` ships was quietly
feeding the model more than the REST runner did. Both now call one exported
`toRuntimeHistory`.

`skill://conv/recover-failed-deliveries` gains a section stating the rule plainly: the DSN
is not a customer, act on the original message instead.
