---
title: Customer acquisition (CRM + Conv)
description: End-to-end flow from a fresh lead list to first conversation — bulk-import contacts, send a welcome email, log the touchpoint, hand off to a human if interest signals fire.
audiences: [admin]
---

# Customer acquisition (CRM + Conv)

Cross-module workflow: a marketing list of leads needs to land in the CRM and receive a personalized first email through a conversation channel — with the right activity log so the sales team can see what happened.

This is a **playbook** — it composes per-module skills rather than reproducing them. Read the linked skills before executing.

## TL;DR

1. Import the leads with `skill://crm/import-and-score-leads`.
2. Confirm the email channel exists (`skill://conv/setup-email-channel` if not).
3. For each new contact: `conv_start_conversation` → `conv_send_message` with the welcome text.
4. Log the activity on the contact (`crm_log_activity`, type `email`).
5. If the contact replies, route per `skill://conv/escalate-to-human`.

## Prerequisites

Before this playbook works:
- A pipeline exists (`crm_list_pipelines` returns at least one).
- An email channel is set up and tested (`conv_list_channels` shows it `active: true`).

If either is missing, run the per-module skill first.

## Step 1 — import the lead list

Follow `skill://crm/import-and-score-leads` end-to-end. After it completes you have:
- N new contacts (some skipped as duplicates), each tagged with the import source.
- A deal per qualified lead, in the first stage of the chosen pipeline.
- AI summaries on contacts and deals.

Capture the list of **created** contact ids — you'll iterate over them in step 3. Note that `crm_bulk_create_contacts` returns counts only, not ids; pull the new ones via:

```jsonc
{ "name": "crm_list_contacts", "arguments": { "tag": "<your-import-tag>", "limit": 200 } }
```

## Step 2 — pick the email channel

```jsonc
{ "name": "conv_list_channels", "arguments": {} }
```

Pick the channel whose `fromAddress` matches the campaign (e.g. a sales-from address, not a support one). If it doesn't exist yet, follow `skill://conv/setup-email-channel`.

## Step 3 — open conversations + send

For each new contact:

```jsonc
{
  "name": "conv_start_conversation",
  "arguments": {
    "channelId": "<emailChannelId>",
    "contactId": "<contactId>",
    "subject": "Welcome to <campaign> — quick intro"
  }
}
```

Then send the welcome message:

```jsonc
{
  "name": "conv_send_message",
  "arguments": {
    "conversationId": "<convId>",
    "body": "Hi <name>,\n\nThanks for joining the spring webinar. ...\n\n— <sender>"
  }
}
```

Personalize using the contact's `data` (name, company, the topic they engaged with — read the AI summary from step 1).

`conv_send_message` enqueues outbound delivery; the email goes out within seconds via the `OutboundDeliveryWorker`. If the SMTP creds fail, the worker will retry with backoff and eventually mark the message `dead`. Watch for delivery failure webhooks (`conversation.message.delivery_failed`) on the customer's side.

## Step 4 — log the touchpoint on the contact

```jsonc
{
  "name": "crm_log_activity",
  "arguments": {
    "type": "email",
    "subject": "Welcome email — <campaign>",
    "body": "Sent personalized welcome referencing webinar attendance.",
    "contactId": "<contactId>",
    "metadata": { "conversationId": "<convId>", "campaign": "<campaign>" }
  }
}
```

Setting `contactId` bumps the contact's `lastContactedAt`. The conversation thread becomes discoverable from both the conversation timeline and the CRM activity timeline.

## Step 5 — handle replies

If a contact replies (inbound email), Munin posts an inbound message to the conversation. Two paths:

### A. Bot continues the conversation

If you have an AI bot replying autonomously, it can keep using `conv_send_message`. Update the AI summary on each meaningful exchange:

```jsonc
{
  "name": "crm_set_ai_summary",
  "arguments": {
    "entityType": "contact",
    "id": "<contactId>",
    "summary": "Replied to welcome email asking about pricing for 50 seats. High intent.",
    "nextAction": "Send pricing PDF + propose 30-min call."
  }
}
```

### B. Hand off to a human

When intent signals fire (specific keywords, sentiment, "talk to a human"), follow `skill://conv/escalate-to-human`. The bot subscribes to `conversation.message.sent` and yields when a Munin user replies. On handoff, also advance the deal stage via `skill://crm/progress-deal-through-pipeline`.

## What NOT to do

- **Don't blast the welcome from one fixed template.** Personalize via the AI summary — leads notice. The cheap shortcut here destroys campaign performance.
- **Don't log the activity *before* `conv_send_message` succeeds.** If sending fails, the activity row claims an email was sent that wasn't. Order matters.
- **Don't loop without checking compliance.** Re-confirm the source had explicit opt-in before sending bulk outbound. Trace it back to the source you imported from.
- **Don't skip the `conv_start_conversation` step and try to `conv_send_message` cold.** `conversationId` is required for sends; the start call is what gives you one.

## Related

- `skill://crm/import-and-score-leads` — the import side.
- `skill://conv/setup-email-channel` — channel prereq.
- `skill://conv/escalate-to-human` — when a human takes over.
- `skill://crm/progress-deal-through-pipeline` — once a reply is real intent.
