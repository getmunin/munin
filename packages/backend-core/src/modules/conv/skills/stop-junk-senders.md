---
title: Stop a junk sender
description: Marking a conversation spam remembers the sender, so their next thread is settled at ingest instead of costing another agent pass. How the flag is set, what it changes, and how it comes off.
audiences: [admin]
---

# Stop a junk sender

A spammer does not send one message. They send eight, each in its own thread, each with its own subject. Judging each one separately is the expensive mistake: every new conversation costs a knowledge-base search, a drafted reply, and an audit pass, and then sits in the review queue waiting for a human who will delete it.

Marking a conversation spam therefore does two things — it settles the thread, and it remembers the sender.

## What marking spam does

`conv_change_status` with `status: "spam"` on any conversation:

1. Sets the conversation's status to `spam`. It leaves the live inbox immediately.
2. Clears `needs_human_attention` and stamps `handover_resolved_at`, so it stops counting toward the operator's "needs you" badge.
3. Releases the runner lease and the operator claim.
4. **Stamps the conversation's contact** with `spam_marked_at`.

Step 4 is the one that matters. From that moment, inbound mail from that contact is settled during ingest: the conversation is created with `status: "spam"` and `suppressed_reason: "spam_sender"`, no handover is raised, and no curator job is enqueued. No model runs at all — not the drafting pass, not the titling pass, not the audit.

## When to mark spam

Be conservative, and understand that the verdict now outlives the thread. Good reasons:

- Unsolicited commercial mail — link farms, SEO offers, cold outreach to a support address.
- Automated junk that got past the header classifier (which already handles bounces, out-of-office replies and `no-reply@` senders on its own — you do not need to mark those).
- A sender who has opened several threads carrying no answerable question.

Not reasons:

- A real question in broken English, or in a language you do not read.
- A terse message, or one whose detail is in an attachment rather than the body. A subject like "Callback request" with an empty body is a normal shape for a real enquiry.
- Anger, rudeness, or a complaint you would rather not answer. That is a conversation to escalate (`skill://conv/escalate-to-human`), not junk.

When you are unsure, close the conversation instead. Closing settles the thread and leaves the sender's reputation alone.

## How the flag comes off

Two things clear it, and both are ordinary operator actions rather than a special tool:

- **Reopening any of that sender's conversations** (`conv_change_status` with `status: "open"`). This also clears the conversation's own `suppressed_reason`.
- **A human replying to them.** Any public message from a teammate on a conversation belonging to that contact clears the flag — a person choosing to answer someone is proof they are not junk.

So a mistaken mark repairs itself the moment anyone engages with the sender. There is no separate unflag step to remember.

## Reading what was suppressed

`ConversationSummary.suppressedReason` says why a conversation was settled without an agent pass:

| Value | Meaning |
|---|---|
| `auto_reply` | An out-of-office or vacation responder. |
| `bounce` | A delivery-status report from a mail daemon. |
| `no_reply_address` | Sent from an address that takes no replies. |
| `spam_sender` | The sender carries a spam flag. |
| `null` | A person opened this conversation. |

A conversation an operator marked spam by hand keeps `suppressed_reason: null` — the status already records the judgment, and the column is reserved for what ingest decided on its own. `conv_list_conversations` takes `status` and `suppressedReason` filters, which is how you audit what was settled automatically.

## Related

- `skill://conv/escalate-to-human` — the opposite move: a real conversation that needs a person.
- `skill://conv/set-topic-and-title` — the triage pass that runs on conversations junk filtering lets through.
