---
'@getmunin/db': patch
'@getmunin/backend-core': patch
'@getmunin/agent-host': patch
---

Remember a junk sender, so their next thread costs nothing.

A spammer does not send one message — they send eight, each in its own thread with its own subject. `mark_spam` (the runtime audit action) and an operator's own mark both wrote `conv_conversations.status` and nothing else, so the judgment died with the thread: the same sender was re-judged eight times, each at the cost of a knowledge-base search, a drafted reply and an audit pass, and each of those drafts then sat in the review queue waiting for a human to delete it. `resolveDelivery` only ever checked the status of the conversation in front of it.

Marking a conversation spam now stamps its contact (`conv_contacts.spam_marked_at` / `spam_marked_by`). Inbound from a stamped contact is settled during ingest — the conversation is created `spam`, no handover is raised, no curator job is enqueued, and the realtime event carries the suppression so the runner returns before it fetches anything. No model runs at all. An existing open thread from a flagged sender is settled the same way when their next message lands.

The flag comes off through ordinary operator actions rather than a special tool: reopening any of that sender's conversations clears it, and so does a teammate posting a public reply on one — a person choosing to answer someone is proof they are not junk. A mistaken mark repairs itself the moment anyone engages.

`conv_conversations.suppressed_reason` is new alongside it: `auto_reply`, `bounce`, `no_reply_address` or `spam_sender` when ingest settled a conversation on its own, `null` when a person opened it (including when an operator marked it spam by hand — the status already records that judgment). The same fact was already on the first inbound message's metadata, but JSONB is not something the inbox can index, and an operator auditing what got suppressed needs exactly this column. `conv_list_conversations` and `GET /v1/conversations{,/queue}` take `suppressedReason` (a reason, `any`, or `none`) and `channelType` filters, and `since` now reaches the control plane too.

Migration `0094_conv_spam_sender_memory` backfills all three: existing suppressed conversations get their reason lifted off the message metadata, contacts who already own a spam-marked conversation are stamped, and their unanswered open threads are settled — a thread a teammate has already replied to keeps its status whatever the sender's reputation.

`skill://conv/stop-junk-senders` documents the whole lifecycle, including when *not* to mark spam: a terse message, an empty body with the detail in an attachment, or a real question in broken English are all normal shapes for genuine mail.
