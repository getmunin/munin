---
title: Playbook: Customer acquisition (CRM + Conv)
description: End-to-end flow from a fresh lead list to first conversation — bulk-import contacts, send a welcome email, log the touchpoint, hand off to a human if interest signals fire.
audiences: [admin]
---

# Customer acquisition (CRM + Conv)

Cross-module workflow: a marketing list of leads needs to land in the CRM and receive a personalized first email through a conversation channel — with the right activity log so the sales team can see what happened.

This is a **playbook** — it composes per-module skills rather than reproducing them. Read the linked skills before executing.

## TL;DR

1. Import the leads with `skill://crm/import-and-score-leads`.
2. Confirm the email channel exists (`skill://conv/setup-email-channel` if not).
3. Draft the first touch as an outreach proposal (`skill://outreach/draft-first-touch-email`) and let the operator approve it — approval is what opens the conversation and sends.
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

## Step 3 — draft the first touch, and let a human approve it

**There is no tool that opens a conversation.** Conversations exist because someone wrote to you, or because an approved outreach proposal created one. Cold outbound therefore runs through the outreach module, which is propose-only on purpose: a curator drafts, the operator approves, and the approval is what sends.

Point a segment at the leads you just imported and create the campaign:

```jsonc
{
  "name": "crm_create_segment",
  "arguments": {
    "name": "<campaign> leads",
    "filter": { "tagsAll": ["<your-import-tag>"] }
  }
}
```

```jsonc
{
  "name": "outreach_create_campaign",
  "arguments": {
    "name": "<campaign>",
    "brief": "One paragraph on who these people are and why we are writing — the curator personalises from this.",
    "segmentId": "<segmentId>",
    "channelId": "<emailChannelId>"
  }
}
```

New campaigns come back `enabled: false`, so nothing can go out while you are still editing the brief. Flip it on with `outreach_update_campaign` when the brief reads right.

Then draft, following `skill://outreach/draft-first-touch-email` end-to-end: it materialises the segment through `crm_list_contacts_in_segment` (which enforces the suppression and consent floor), dedupes per contact, grounds the copy in the KB, and files one `outreach_propose_first_touch` draft per contact. Stop there — drafting is the whole of the curator's job.

The operator reviews the queue per `skill://outreach/review-proposals` and approves each draft with `outreach_approve_proposal({ id, fingerprint })`. That call creates the outbound conversation, sends on the campaign's channel with the CTA and unsubscribe footer, and returns `conversationId` and `sentMessageId`. Use that `conversationId` in step 4 — it does not exist before the approval.

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

### A. Draft the reply for review

A conversation an approved proposal created is always set to `draft_only`, whatever the channel default says — a prospect never receives an unreviewed reply. So the agent drafts and the operator approves, same as the first touch: follow `skill://outreach/draft-reply-email`, which files the draft with `outreach_propose_reply` on the existing conversation. Update the AI summary on each meaningful exchange:

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
- **Don't log the activity before the proposal reports `status: "sent"`.** An approval with a future send time comes back `approved` with a `scheduledSendAt` and has not left the building yet; logging then claims an email was sent that wasn't.
- **Don't loop without checking compliance.** Re-confirm the source had explicit opt-in before sending bulk outbound. Trace it back to the source you imported from.
- **Don't try to reach a lead with `conv_send_message`.** It requires a `conversationId`, and nothing in the tool surface mints one for a person who hasn't written to you. A cold message that bypasses the proposal queue also bypasses the approval, the suppression re-check and the unsubscribe footer — that is the whole point of routing it through outreach.

## Related

- `skill://crm/import-and-score-leads` — the import side.
- `skill://conv/setup-email-channel` — channel prereq.
- `skill://conv/escalate-to-human` — when a human takes over.
- `skill://crm/progress-deal-through-pipeline` — once a reply is real intent.
- `skill://analytics/identify-visitors` — to see what a contact did on the site after your email, link their signed email to the tracker.
