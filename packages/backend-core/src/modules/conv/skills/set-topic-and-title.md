---
title: Set a conversation's topic and title
description: When a new inbound conversation is created, read its first end-user message, tag it with the best-fitting topic (creating one only when confident none fit), and give it a short title if it doesn't already have one. Fires on every `conversation.created` event so the inbox is triaged the moment a message lands — without operator intervention.
audiences: [admin]
---

# Set a conversation's topic and title

A fresh conversation just arrived. Before anyone looks at the inbox it should already be triaged: tagged with a **topic** (Billing, Support, Sales, …) so it can be filtered and routed, and carrying a short **title** so the list is readable at a glance. Your job is to read one conversation, pick or create the right topic, and set a concise title — then stop. This is a fast, narrow pass, not a full analysis.

You have very little to go on (usually just the first message), and that's fine. Topic and title are cheap, reversible hints for humans — not commitments. When the signal is weak, prefer leaving the topic unset over forcing a bad one.

## TL;DR

1. **Read the conversation** with `conv_get_conversation(<conversationId>)`. The prompt names it; don't list or scan others.
2. **List existing topics** with `conv_list_topics`.
3. **Pick the best-fitting existing topic.** If one clearly fits, that's your topic — use its `id`.
4. **Create a topic only when confident** none of the existing ones fit *and* the theme is unmistakable. Otherwise leave the topic unset.
5. **Set the topic** with `conv_set_topic` (skip this call if you decided to leave it unset).
6. **Set a title** with `conv_set_subject` — but **only if the conversation's `subject` is currently empty.** If it already has one (email threads always do), leave it.
7. **Stop.** At most one `conv_set_topic` and at most one `conv_set_subject`, then finish. No prose reply.

## Step 1 — read the conversation

```jsonc
{ "name": "conv_get_conversation", "arguments": { "id": "ccv_…" } }
```

The response gives you `messages[]`, the current `subject` (may be null), `topicId` (usually null on a new conversation), and `channelType`. Base your decision on `end_user`-authored messages — that's what the customer actually said. Ignore `agent`, `user`, and `system` messages; they aren't the subject of the conversation.

If the conversation already has a `topicId`, don't second-guess it — skip straight to the title step.

## Step 2 — choose the topic

```jsonc
{ "name": "conv_list_topics", "arguments": {} }
```

Match the conversation against the **existing** topics first. Topics are broad buckets, not fine-grained tags — "I was double-charged" and "how do I update my card" are both **Billing**. Don't hold out for a perfect match; the closest sensible existing topic wins.

**Choose an existing topic** when one reasonably covers the message. Use its `id` in step 4.

**Create a new topic** only when *both* are true:

- None of the existing topics reasonably fit, and
- The conversation has a clear, recurring theme that an operator would obviously want as its own bucket (e.g. the org has Support and Sales but this is plainly about **Billing**, which doesn't exist yet).

When you create, keep it broad and reusable — a category, not a one-off:

```jsonc
{
  "name": "conv_create_topic",
  "arguments": { "name": "Billing", "slug": "billing" }
}
```

- `name`: short, title-case, singular category ("Billing", "Refunds", "Onboarding").
- `slug`: lowercase letters, digits, hyphens — the kebab-case of the name.
- Don't invent near-duplicates of an existing topic ("Support Requests" when "Support" exists). Reuse the existing one instead.
- Don't create hyper-specific topics ("Double charge on May invoice"). That's what the title is for.

`conv_create_topic` returns the new topic's `id`; use it in step 4.

**When in doubt, don't tag.** A conversation with no clear theme (a bare "hi", an ambiguous one-liner) is better left untagged than mis-bucketed. Skip the `conv_set_topic` call entirely in that case.

## Step 3 — (covered above)

## Step 4 — set the topic

```jsonc
{
  "name": "conv_set_topic",
  "arguments": { "conversationId": "ccv_…", "topicId": "ctp_…" }
}
```

Skip this call entirely if you decided in step 2 to leave the conversation untagged.

## Step 5 — set the title

A title is a 3–8 word summary of what the customer wants, in their framing — what you'd put on a support ticket. Examples:

- "Double charge on May invoice"
- "Can't reset password"
- "Question about team plan pricing"
- "Refund request — duplicate order"

Rules:

- **Only set a title if the conversation's `subject` is empty/null.** Email conversations carry the email Subject line already — never overwrite it. Chat, SMS, and voice conversations usually arrive without one; those are the ones to title.
- Summarise, don't quote. Strip greetings, signatures, and filler ("Hi there, I was wondering if…").
- No trailing punctuation, sentence-case, ≤ 200 chars (aim for far shorter).
- If the first message is contentless ("hello", "?", an emoji), there's nothing to summarise — skip the title call and leave it for a later message.

```jsonc
{
  "name": "conv_set_subject",
  "arguments": { "conversationId": "ccv_…", "subject": "Double charge on May invoice" }
}
```

Pass `subject: null` only if you ever need to clear a bad title — not part of the normal flow here.

## What NOT to do

- **Don't reply to the customer.** This skill never posts a message. It only tags and titles.
- **Don't overwrite an existing subject or topic.** Email subjects and operator-set topics are authoritative; fill gaps, never clobber.
- **Don't proliferate topics.** Reuse existing buckets aggressively; create at most one, and only when clearly warranted. Topic sprawl makes the inbox harder to filter, not easier.
- **Don't over-read.** You're working from the first message or two. Don't infer elaborate themes from thin signal — a weak guess tagged confidently is worse than no tag.
- **Don't make more than two writes.** One `conv_set_topic` (or zero), one `conv_set_subject` (or zero). Then stop.

## Related

- `skill://crm/extract-contact-from-message` — the symmetric per-conversation pass, but extracting CRM identity instead of triage metadata. Runs on close rather than creation.
- `skill://kb/review-content` — per-conversation curation that proposes KB candidates from resolved questions.
